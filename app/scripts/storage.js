'use strict';
/* Persistence boundary. UI windows contain summaries; complete cards are read on demand. */
(() => {
  const clone = value => structuredClone(value);
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const clean = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')));
  const meta = row => Object.fromEntries(Object.entries(clean(row)).filter(([key]) => !['lists', 'cards', 'cardCount', 'listCount', 'wipCount'].includes(key)));
  const spaced = (items, step = 1024) => {
    let previous = -step;
    const following = new Array(items.length);
    let nextPosition;
    for (let i = items.length - 1; i >= 0; i--) {
      following[i] = nextPosition;
      if (Number.isFinite(items[i]._pos)) nextPosition = items[i]._pos;
    }
    return items.map((item, index) => {
      const next = following[index];
      let position = item._pos;
      if (!Number.isFinite(position) || position <= previous || (next !== undefined && position >= next)) {
        position = next !== undefined && next > previous ? (previous + next) / 2 : previous + step;
      }
      previous = position;
      item._pos = position;
      return position;
    });
  };
  class Store {
    constructor(name = 'kanbaya') {
      this.db = new Dexie(name);
      this.db.version(1).stores({
        boards: 'id, position',
        lists: '[boardId+id], boardId, [boardId+position]',
        cards: '[boardId+id], boardId, [boardId+listId+position], [boardId+listId+archivedKey+position], [boardId+archivedKey+due]',
        cardDetails: '[boardId+id], boardId',
        templates: 'id, position',
        settings: 'key'
      });
      this.db.version(2).stores({
        images: 'id, boardId, [boardId+cardId], created'
      });
      this.pendingImages = new Map();
      this.revision = 0;
      this.baseline = new Map();
      this.rebalances = [];
      this.db.on('blocked', () => this.onblocked?.());
      this.db.on('versionchange', () => { this.db.close(); this.onversionchange?.(); });
    }
    tables() { return this.db.tables; }
    flatten(state) {
      const rows = new Map();
      const add = (table, key, value) => rows.set(table + ':' + JSON.stringify(key), { table, key, value: clone(value) });
      add('settings', 'theme', { key: 'theme', value: state.theme });
      state.templates.forEach((t, position) => add('templates', t.id, { ...clean(t), position }));
      state.boards.forEach((b, position) => {
        add('boards', b.id, { ...meta(b), position });
        const listPositions = spaced(b.lists);
        b.lists.forEach((l, li) => {
          add('lists', [b.id, l.id], { ...meta(l), boardId: b.id, position: listPositions[li] });
          const positions = spaced(l.cards);
          l.cards.forEach((c, ci) => {
            const full = !c._summary;
            const detail = full ? { boardId: b.id, id: c.id, desc: c.desc, checklist: clone(c.checklist), comments: clone(c.comments) } : null;
            const row = {
              boardId: b.id, listId: l.id, id: c.id, position: positions[ci],
              title: c.title, labels: clone(c.labels), due: c.due, dueDone: c.dueDone, priority: c.priority,
              ...(c.startDate ? { startDate: c.startDate } : {}),
              completed: c.completed, recurrence: c.recurrence, theme: c.theme,
              ...(c.imageIds ? { imageIds: clone(c.imageIds), coverImageId: c.coverImageId || null } : {}),
              archived: c.archived, archivedKey: Number(c.archived), created: c.created,
              hasDesc: full ? !!c.desc.trim() : c._hasDesc,
              searchPrefix: full ? `${c.title} ${c.desc}`.toLowerCase() : c._searchPrefix,
              searchSuffix: full ? `${c.checklist.map(x => x.text).join(' ')} ${c.comments.map(x => x.text).join(' ')}`.toLowerCase() : c._searchSuffix,
              checkCount: full ? c.checklist.length : c._checkCount,
              checkDone: full ? c.checklist.filter(x => x.done).length : c._checkDone,
              commentCount: full ? c.comments.length : c._commentCount
            };
            add('cards', [b.id, c.id], row);
            if (detail) add('cardDetails', [b.id, c.id], detail);
          });
        });
      });
      return rows;
    }
    adopt(state) { this.baseline = this.flatten(state); }
    async positionBefore(boardId, listId, beforeId, excludeId) {
      const rows = this.db.cards.where('[boardId+listId+position]');
      const before = beforeId ? await this.db.cards.get([boardId, beforeId]) : null;
      const upper = before?.position ?? Dexie.maxKey;
      const previous = await rows.between([boardId, listId, Dexie.minKey], [boardId, listId, upper], true, false).reverse().filter(c => c.id !== excludeId).first();
      const position = before ? ((previous?.position ?? before.position - 2048) + before.position) / 2 : (previous?.position ?? -1024) + 1024;
      if (position === previous?.position || position === before?.position) this.rebalances.push({ boardId, listId, beforeId, id: excludeId });
      return position;
    }
    async preparePositions(state) {
      for (const b of state.boards) for (const l of b.lists) {
        let tail;
        for (const c of l.cards) {
          if (c._positioned) { c.listId = l.id; delete c._positioned; continue; }
          if (Number.isFinite(c._pos) && (!c.listId || c.listId === l.id)) continue;
          if (tail === undefined) tail = await this.positionBefore(b.id, l.id, null);
          c._pos = tail; tail += 1024; c.listId = l.id;
        }
      }
    }
    async initialize(seed) {
      await this.db.open();
      if (!await this.db.settings.get('initialized')) {
        const state = seed();
        const rows = this.flatten(state);
        const ids = new Set();
        const unique = (kind, id) => {
          const key = JSON.stringify([kind, ...id]);
          if (ids.has(key)) throw new Error('The initial data contains duplicate identifiers: ' + kind);
          ids.add(key);
        };
        state.boards.forEach(b => {
          unique('board', [b.id]);
          b.labels.forEach(l => unique('label', [b.id, l.id]));
          b.lists.forEach(l => {
            unique('list', [b.id, l.id]);
            l.cards.forEach(c => {
              unique('card', [b.id, c.id]);
              if (c.labels.some(id => !b.labels.some(label => label.id === id))) throw new Error('A card references a label that does not exist.');
            });
          });
        });
        state.templates.forEach(t => unique('template', [t.id]));
        await this.db.transaction('rw', this.tables(), async () => {
          if (await this.db.settings.get('initialized')) return;
          for (const table of this.tables()) {
            const values = [...rows.values()].filter(row => row.table === table.name).map(row => row.value);
            if (values.length) await table.bulkAdd(values);
          }
          if (await this.db.cards.count() !== state.boards.reduce((n, b) => n + b.lists.reduce((m, l) => m + l.cards.length, 0), 0)) throw new Error('The initial card count does not match.');
          await this.recount(state.boards.map(b => b.id));
          await this.db.settings.bulkPut([{ key: 'initialized', value: true }, { key: 'revision', value: 0 }]);
        });
      }
      return this.readState();
    }
    async readState() {
      return this.db.transaction('r', this.tables(), async () => {
        this.revision = (await this.db.settings.get('revision'))?.value || 0;
        const boards = await this.db.boards.orderBy('position').toArray();
        for (const b of boards) {
          const lists = await this.db.lists.where('[boardId+position]').between([b.id, Dexie.minKey], [b.id, Dexie.maxKey]).toArray();
          b.lists = lists.map(l => ({ ...l, _pos: l.position, cards: [] }));
        }
        const state = { version: 2, theme: (await this.db.settings.get('theme'))?.value || 'auto', boards, templates: await this.db.templates.orderBy('position').toArray() };
        this.adopt(state);
        return state;
      });
    }
    async updateOpenBoards({ add, remove } = {}) {
      return this.db.transaction('rw', this.db.settings, this.db.boards, async () => {
        const saved = (await this.db.settings.get('openBoards'))?.value;
        if (saved !== undefined && (!Array.isArray(saved) || saved.some(id => typeof id !== 'string'))) {
          throw new Error('The saved open boards are invalid.');
        }
        const available = new Set((await this.db.boards.toArray()).map(board => board.id));
        const ids = [...new Set(saved || [])].filter(id => available.has(id) && id !== remove);
        if (add && available.has(add) && !ids.includes(add)) ids.push(add);
        if (JSON.stringify(saved) !== JSON.stringify(ids)) {
          await this.db.settings.put({ key: 'openBoards', value: ids });
        }
        return ids;
      });
    }
    summary(row) {
      return {
        ...row, _pos: row.position, _summary: true,
        _searchPrefix: row.searchPrefix, _searchSuffix: row.searchSuffix,
        _hasDesc: row.hasDesc, _checkCount: row.checkCount, _checkDone: row.checkDone, _commentCount: row.commentCount,
        desc: '', checklist: [], comments: []
      };
    }
    async applyWelcomePriorities(boardName, priorities) {
      const marker = 'welcome-priorities-v1';
      const changed = await this.db.transaction('rw', this.db.settings, this.db.boards, this.db.cards, async () => {
        if (await this.db.settings.get(marker)) return false;
        const board = (await this.db.boards.toArray()).find(item => item.name === boardName);
        let updated = false;
        if (board) {
          const cards = await this.db.cards.where('boardId').equals(board.id).toArray();
          const titles = Object.keys(priorities);
          if (titles.every(title => cards.some(card => card.title === title))) {
            for (const title of titles) {
              const card = cards.find(item => item.title === title);
              if (!card.priority) {
                await this.db.cards.update([board.id, card.id], { priority: priorities[title] });
                updated = true;
              }
            }
          }
        }
        if (updated) {
          const revision = await this.db.settings.get('revision');
          await this.db.settings.put({ key: 'revision', value: (revision?.value || 0) + 1 });
        }
        await this.db.settings.put({ key: marker, value: true });
        return updated;
      });
      if (changed) this.revision++;
    }
    async applyWelcomeDates(boardName, titles, makeDates) {
      const marker = 'welcome-dates-v1';
      const changed = await this.db.transaction('rw', this.db.settings, this.db.boards, this.db.cards, async () => {
        if (await this.db.settings.get(marker)) return false;
        const board = (await this.db.boards.toArray()).find(item => item.name === boardName);
        let updated = false;
        if (board) {
          const cards = await this.db.cards.where('boardId').equals(board.id).toArray();
          if (titles.every(title => cards.filter(card => card.title === title).length === 1)) {
            const undated = cards.filter(card => titles.includes(card.title) && !card.startDate && !card.due);
            const dates = undated.length ? makeDates(board.created) : null;
            for (const card of undated) {
              await this.db.cards.update([board.id, card.id], { ...dates[card.title], dueDone: !!card.completed });
              updated = true;
            }
          }
        }
        if (updated) {
          const revision = await this.db.settings.get('revision');
          await this.db.settings.put({ key: 'revision', value: (revision?.value || 0) + 1 });
        }
        await this.db.settings.put({ key: marker, value: true });
        return updated;
      });
      if (changed) this.revision++;
    }
    async statistics(board) {
      return this.db.transaction('r', this.db.cards, async () => {
        const cards = (await this.db.cards.where('boardId').equals(board.id).toArray()).filter(card => !card.archived);
        const listCounts = new Map(board.lists.map(list => [list.id, 0]));
        const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical', '': 'No priority' };
        const priorityCounts = new Map(Object.keys(priorityLabels).map(priority => [priority, 0]));
        const today = new Date();
        const todayKey = dateKey(today), nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekKey = dateKey(nextWeek);
        const dueCounts = { completed: 0, overdue: 0, today: 0, soon: 0, later: 0, none: 0 };
        const labelCounts = new Map(board.labels.map(label => [label.id, 0]));
        let noLabel = 0;
        let overdue = 0, withDue = 0, completed = 0, checkCount = 0, checkDone = 0;
        for (const card of cards) {
          listCounts.set(card.listId, (listCounts.get(card.listId) || 0) + 1);
          if (card.due) { withDue++; if (!card.completed && card.due < todayKey) overdue++; }
          if (card.completed) completed++;
          const dueCategory = card.completed ? 'completed' : !card.due ? 'none' :
            card.due < todayKey ? 'overdue' : card.due === todayKey ? 'today' : card.due <= nextWeekKey ? 'soon' : 'later';
          dueCounts[dueCategory]++;
          if (!card.labels.length) noLabel++;
          for (const id of new Set(card.labels)) {
            if (labelCounts.has(id)) labelCounts.set(id, labelCounts.get(id) + 1);
          }
          if (priorityCounts.has(card.priority)) priorityCounts.set(card.priority, priorityCounts.get(card.priority) + 1);
          checkCount += card.checkCount || 0;
          checkDone += card.checkDone || 0;
        }
        return {
          cards: cards.length, overdue, withDue, completed,
          checklists: checkCount ? Math.round(checkDone / checkCount * 100) : 0,
          lists: board.lists.map(list => ({ label: list.name, count: listCounts.get(list.id) || 0 })),
          priorities: [...priorityCounts].map(([priority, count]) => ({ label: priorityLabels[priority], priority, count })),
          labels: [...board.labels.map(label => ({ label: label.name || 'Unnamed label', color: label.color, count: labelCounts.get(label.id) })), { label: 'No label', count: noLabel }],
          due: [
            { label: 'Completed', count: dueCounts.completed },
            { label: 'Overdue', count: dueCounts.overdue },
            { label: 'Due today', count: dueCounts.today },
            { label: 'Next 7 days', count: dueCounts.soon },
            { label: 'Later', count: dueCounts.later },
            { label: 'No due date', count: dueCounts.none }
          ]
        };
      });
    }
    async archivedCount(boardId) {
      return this.db.cards.where('[boardId+archivedKey+due]')
        .between([boardId, 1, Dexie.minKey], [boardId, 1, Dexie.maxKey], true, true).count();
    }
    async card(boardId, id) {
      return this.db.transaction('r', this.db.cards, this.db.cardDetails, async () => {
        const row = await this.db.cards.get([boardId, id]);
        if (!row) throw new Error('The card no longer exists. Refresh the view.');
        const detail = await this.db.cardDetails.get([boardId, id]);
        if (!detail) throw new Error('The card details are missing.');
        return { ...this.summary(row), ...detail, _summary: false };
      });
    }
    async hydrate(board) {
      return this.db.transaction('r', this.db.cards, this.db.cardDetails, async () => {
        const cards = await this.db.cards.where('boardId').equals(board.id).toArray();
        const details = new Map((await this.db.cardDetails.where('boardId').equals(board.id).toArray()).map(x => [x.id, x]));
        board.lists.forEach(l => {
          l.cards = cards.filter(c => c.listId === l.id).sort((a, b) => a.position - b.position).map(c => {
            if (!details.has(c.id)) throw new Error('Details for a card are missing.');
            return { ...this.summary(c), ...details.get(c.id), _summary: false };
          });
        });
      });
    }
    async exportState(boardIds) {
      return this.db.transaction('r', this.tables(), async () => {
        const state = await this.readExportState();
        if (boardIds) state.boards = state.boards.filter(b => boardIds.includes(b.id));
        for (const b of state.boards) await this.hydrate(b);
        return {
          version: 2, theme: state.theme,
          boards: state.boards.map(b => ({
            ...Object.fromEntries(Object.entries(meta(b)).filter(([k]) => k !== 'position')), lists: b.lists.map(l => ({
              ...Object.fromEntries(Object.entries(meta(l)).filter(([k]) => !['boardId', 'position'].includes(k))),
              cards: l.cards.map(c => Object.fromEntries(Object.entries(clean(c)).filter(([k]) => !['boardId', 'listId', 'position', 'archivedKey', 'searchPrefix', 'searchSuffix', 'hasDesc', 'checkCount', 'checkDone', 'commentCount'].includes(k))))
            }))
          })),
          templates: state.templates.map(t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'position')))
        };
      });
    }
    stageImage(image) { this.pendingImages.set(image.id, image); }
    static remapDescription(text, ids) {
      return text.replace(/\battachment:([\w-]+)/g, (match, id) =>
        ids.has(id) ? `attachment:${ids.get(id)}` : match);
    }
    static async attachmentBlob(attachment) {
      if (attachment.compression !== 'gzip') return attachment.blob;
      const blob = await new Response(attachment.blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
      if (blob.size !== attachment.originalSize) throw new Error('The saved attachment is damaged.');
      return new Blob([blob], { type: attachment.mime });
    }
    async copyImages(source, target, boardId) {
      if (!source.imageIds) return;
      const ids = new Map();
      const copies = [];
      for (const id of source.imageIds) {
        const image = this.pendingImages.get(id) || await this.db.images.get(id);
        if (!image) throw new Error('An attachment is missing.');
        const nextId = crypto.randomUUID();
        ids.set(id, nextId);
        copies.push({ ...image, id: nextId, boardId, cardId: target.id });
      }
      copies.forEach(image => this.stageImage(image));
      target.imageIds = [...ids.values()];
      target.coverImageId = ids.get(source.coverImageId) || null;
      target.desc = Store.remapDescription(target.desc, ids);
    }
    async imageUsage() {
      let size = 0;
      await this.db.images.each(image => { size += image.size; });
      return size;
    }
    async exportBackup(boardIds, includeTemplates = true) {
      const { state, images } = await this.db.transaction('r', this.tables(), async () => ({
        state: await this.exportState(boardIds),
        images: boardIds ? await this.db.images.where('boardId').anyOf(boardIds).toArray() : await this.db.images.toArray()
      }));
      if (!includeTemplates) delete state.templates;
      const data = { app: 'kanbaya', ...state, exportedAt: new Date().toISOString() };
      // Binary envelope: magic, little-endian JSON header length, header, then stored blobs.
      const header = new TextEncoder().encode(JSON.stringify({
        ...data, version: 4, images: images.map(({ blob, ...metadata }) => metadata)
      }));
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, header.length, true);
      return { extension: 'kanbaya', blob: new Blob(['KANBAYA4', length, header, ...images.map(image => image.blob)], { type: 'application/octet-stream' }) };
    }
    async parseBackup(file) {
      const magic = await file.slice(0, 8).text();
      if (magic !== 'KANBAYA4') return { data: JSON.parse(await file.text()), images: [] };
      if (file.size < 12) throw new Error('The attachment backup is truncated.');
      const headerSize = new DataView(await file.slice(8, 12).arrayBuffer()).getUint32(0, true);
      let offset = 12 + headerSize;
      if (offset > file.size) throw new Error('The attachment backup header is truncated.');
      const data = JSON.parse(await file.slice(12, offset).text());
      if (data.version !== 4 || !Array.isArray(data.images)) throw new Error('Invalid attachment backup format.');
      const ids = new Set(), images = [];
      for (const image of data.images) {
        const isFile = data.version === 4 && image?.kind === 'file';
        const validContent = isFile
          ? image.compression === 'gzip' && typeof image.mime === 'string' &&
            /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(image.mime) &&
            Number.isSafeInteger(image.originalSize) && image.originalSize >= 0
          : image && (!image.kind || image.kind === 'image') && !image.compression &&
            ['image/webp', 'image/png', 'image/jpeg'].includes(image.mime) &&
            Number.isInteger(image.width) && image.width > 0 && image.width <= 1600 &&
            Number.isInteger(image.height) && image.height > 0 && image.height <= 1600;
        if (!image || typeof image.id !== 'string' || ids.has(image.id) ||
            typeof image.boardId !== 'string' || typeof image.cardId !== 'string' ||
            !validContent ||
            !Number.isSafeInteger(image.size) || image.size <= 0 ||
            offset + image.size > file.size) throw new Error('Invalid attachment record in backup.');
        ids.add(image.id);
        images.push({ ...image, blob: file.slice(offset, offset + image.size, isFile ? 'application/gzip' : image.mime) });
        offset += image.size;
      }
      if (offset !== file.size) throw new Error('Unexpected attachment backup content.');
      return { data, images };
    }
    async readExportState() {
      return this.db.transaction('r', this.tables(), async () => {
        const boards = await this.db.boards.orderBy('position').toArray();
        for (const b of boards) b.lists = (await this.db.lists.where('boardId').equals(b.id).sortBy('position')).map(l => ({ ...l, cards: [] }));
        return { boards, templates: await this.db.templates.orderBy('position').toArray(), theme: (await this.db.settings.get('theme'))?.value || 'auto' };
      });
    }
    async recount(boardIds) {
      for (const id of new Set(boardIds)) {
        const lists = await this.db.lists.where('boardId').equals(id).toArray();
        let cardCount = 0;
        for (const l of lists) {
          const count = await this.db.cards.where('[boardId+listId+archivedKey+position]').between([id, l.id, 0, Dexie.minKey], [id, l.id, 0, Dexie.maxKey]).count();
          cardCount += count;
          const wipCount = l.wipLimit ? await this.wipCount(id, l.id) : undefined;
          if (l.cardCount !== count || l.wipCount !== wipCount) {
            await this.db.lists.update([id, l.id], { cardCount: count, wipCount });
          }
        }
        const board = await this.db.boards.get(id);
        if (board && (board.cardCount !== cardCount || board.listCount !== lists.length)) await this.db.boards.update(id, { cardCount, listCount: lists.length });
      }
    }
    async wipCount(boardId, listId) {
      return this.db.cards.where('[boardId+listId+archivedKey+position]')
        .between([boardId, listId, 0, Dexie.minKey], [boardId, listId, 0, Dexie.maxKey])
        .filter(card => !card.completed).count();
    }
    async wipSnapshot(boardIds, changes) {
      const lists = await this.db.lists.where('boardId').anyOf(boardIds).toArray();
      const future = changes.filter(entry => entry.table === 'lists' && entry.value?.wipLimit).map(entry => entry.value);
      const counts = new Map();
      for (const list of [...lists.filter(list => list.wipLimit), ...future]) {
        const key = JSON.stringify([list.boardId, list.id]);
        if (!counts.has(key)) counts.set(key, await this.wipCount(list.boardId, list.id));
      }
      return counts;
    }
    async validateWip(boardIds, before) {
      for (const list of await this.db.lists.where('boardId').anyOf(boardIds).filter(list => !!list.wipLimit).toArray()) {
        const count = await this.wipCount(list.boardId, list.id);
        if (count > list.wipLimit && count > (before.get(JSON.stringify([list.boardId, list.id])) || 0)) {
          const error = new Error(`WIP limit reached for "${list.name}" (${list.wipLimit}). No cards were added or moved. Complete, archive or move cards out first.`);
          error.name = 'WipLimitError';
          throw error;
        }
      }
    }
    async commit(state) {
      const next = this.flatten(state), changes = [];
      for (const [id, entry] of next) {
        const old = this.baseline.get(id);
        if (!old || JSON.stringify(old.value) !== JSON.stringify(entry.value)) changes.push({ ...entry, old: old?.value });
      }
      for (const [id, entry] of this.baseline) if (!next.has(id)) changes.push({ ...entry, old: entry.value, value: undefined });
      if (!changes.length && !this.pendingImages.size) return null;
      const expected = this.revision;
      const undo = [];
      const positions = new Map();
      await this.db.transaction('rw', this.tables(), async () => {
        const actual = (await this.db.settings.get('revision'))?.value || 0;
        if (actual !== expected) throw new Error('Another tab has modified the data. Export your draft and reload before continuing.');
        const affected = [...new Set(changes.map(c => c.table === 'boards' ? c.key : (c.value || c.old)?.boardId).filter(Boolean))];
        const wipBefore = await this.wipSnapshot(affected, changes);
        for (const change of changes.filter(entry => entry.table === 'lists' && entry.value)) {
          const limit = change.value.wipLimit;
          if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('WIP limits must be non-negative integers.');
        }
        const remember = async (table, key, value) => {
          const old = await this.db.table(table).get(key);
          undo.push({ table, key, value: old });
          if (value === undefined) await this.db.table(table).delete(key);
          else await this.db.table(table).put(value);
        };
        const removedBoards = changes.filter(x => x.table === 'boards' && !x.value).map(x => x.key);
        const removedLists = changes.filter(x => x.table === 'lists' && !x.value).map(x => x.key);
        for (const table of ['lists', 'cards', 'cardDetails']) {
          for (const boardId of removedBoards) {
            for (const row of await this.db.table(table).where('boardId').equals(boardId).toArray()) await remember(table, [boardId, row.id], undefined);
          }
        }
        for (const [boardId, listId] of removedLists) {
          for (const c of await this.db.cards.where('[boardId+listId+position]').between([boardId, listId, Dexie.minKey], [boardId, listId, Dexie.maxKey]).toArray()) {
            await remember('cards', [boardId, c.id], undefined);
            await remember('cardDetails', [boardId, c.id], undefined);
          }
        }
        for (const c of changes) {
          await remember(c.table, c.key, c.value);
          if (c.table === 'cards' && !c.value) await remember('cardDetails', c.key, undefined);
        }
        const removedCards = undo.filter(entry => entry.table === 'cards' && entry.value?.imageIds?.length);
        for (const entry of removedCards) {
          if (await this.db.cards.get(entry.key)) continue;
          for (const image of await this.db.images.where('[boardId+cardId]').equals(entry.key).toArray()) {
            await remember('images', image.id, undefined);
          }
        }
        for (const image of this.pendingImages.values()) {
          const card = await this.db.cards.get([image.boardId, image.cardId]);
          if (!card?.imageIds?.includes(image.id)) throw new Error('The attachment has no associated card.');
          await remember('images', image.id, image);
        }
        for (const change of changes.filter(entry => entry.table === 'cards' && entry.value)) {
          const card = change.value;
          if (!card.imageIds && !change.old?.imageIds) continue;
          const ids = card.imageIds || [];
          if (new Set(ids).size !== ids.length || (card.coverImageId && !ids.includes(card.coverImageId))) throw new Error('Invalid card attachment references.');
          if (card.coverImageId) {
            const cover = await this.db.images.get(card.coverImageId);
            if (!cover || cover.kind === 'file' || cover.boardId !== card.boardId || cover.cardId !== card.id) throw new Error('Only an attached image can be a cover.');
          }
          const previousIds = change.old?.imageIds;
          if (previousIds && ids.length === previousIds.length && ids.every((id, i) => id === previousIds[i])) continue;
          for (const image of await this.db.images.where('[boardId+cardId]').equals(change.key).toArray()) {
            if (!ids.includes(image.id)) await remember('images', image.id, undefined);
          }
          for (const id of ids) {
            const image = await this.db.images.get(id);
            if (!image || image.boardId !== card.boardId || image.cardId !== card.id) throw new Error('An attachment is missing or belongs to another card.');
          }
        }
        for (const request of this.rebalances) {
          const rows = await this.db.cards.where('[boardId+listId+position]').between([request.boardId, request.listId, Dexie.minKey], [request.boardId, request.listId, Dexie.maxKey]).toArray();
          const moving = rows.find(c => c.id === request.id);
          if (!moving) throw new Error('Could not reorder the card.');
          const ordered = rows.filter(c => c.id !== request.id);
          const before = request.beforeId ? ordered.findIndex(c => c.id === request.beforeId) : ordered.length;
          if (before < 0) throw new Error('The target position no longer exists.');
          ordered.splice(before, 0, moving);
          for (let i = 0; i < ordered.length; i++) {
            const row = ordered[i], position = i * 1024;
            if (row.position !== position) await remember('cards', [row.boardId, row.id], { ...row, position });
            positions.set(JSON.stringify([row.boardId, row.id]), position);
          }
        }
        await this.validateWip(affected, wipBefore);
        await this.recount(affected);
        await this.db.settings.put({ key: 'revision', value: actual + 1 });
      });
      this.revision++;
      this.pendingImages.clear();
      this.rebalances = [];
      for (const b of state.boards) for (const l of b.lists) for (const c of l.cards) {
        const position = positions.get(JSON.stringify([b.id, c.id]));
        if (position !== undefined) {
          c._pos = position;
          const entry = next.get('cards:' + JSON.stringify([b.id, c.id]));
          if (entry) entry.value.position = position;
        }
      }
      this.baseline = next;
      this.oncommit?.();
      return { entries: undo, revision: this.revision };
    }
    async undo(change) {
      await this.db.transaction('rw', this.tables(), async () => {
        if ((await this.db.settings.get('revision'))?.value !== change.revision) throw new Error('Cannot undo: later changes exist.');
        const affected = (await this.db.boards.toArray()).map(board => board.id);
        const wipBefore = await this.wipSnapshot(affected, change.entries);
        for (const entry of [...change.entries].reverse()) {
          if (entry.value === undefined) await this.db.table(entry.table).delete(entry.key);
          else await this.db.table(entry.table).put(entry.value);
        }
        const boards = (await this.db.boards.toArray()).map(b => b.id);
        await this.validateWip(boards, wipBefore);
        await this.recount(boards);
        await this.db.settings.put({ key: 'revision', value: change.revision + 1 });
      });
      this.revision = change.revision + 1;
      this.oncommit?.();
    }
    async listKeys(board, list, filters, q, archived = false, range = null) {
      const labels = new Map(board.labels.map(l => [l.id, l.name]));
      const today = new Date();
      const now = dateKey(today), days = n => { const d = new Date(today); d.setDate(d.getDate() + n); return dateKey(d); };
      const matches = c => {
        if (q && !`${c.searchPrefix} ${c.labels.map(id => labels.get(id) || '').join(' ')} ${c.searchSuffix}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (filters.status.length && !filters.status.some(s => s === 'completed' ? c.completed : !c.completed)) return false;
        if (filters.labels.length && !filters.labels.some(id => id === 'none' ? !c.labels.length : c.labels.includes(id))) return false;
        if (filters.due.length && !filters.due.some(s => {
          if (s === 'none') return !c.due;
          if (!c.due || c.completed) return false;
          if (s === 'overdue') return c.due < now;
          if (s === 'tomorrow') return c.due === days(1);
          return c.due > now && c.due <= days(s === 'week' ? 7 : 30);
        })) return false;
        return true;
      };
      const collection = range
        ? this.db.cards.where('[boardId+archivedKey+due]').between([board.id, 0, range[0]], [board.id, 0, range[1]], true, true)
        : this.db.cards.where('[boardId+listId+archivedKey+position]').between([board.id, list.id, Number(archived), Dexie.minKey], [board.id, list.id, Number(archived), Dexie.maxKey]);
      const keys = [];
      await collection.each(c => { if (matches(c)) keys.push({ id: c.id, boardId: c.boardId, listId: c.listId, position: c.position, due: c.due, ...(c.startDate ? { startDate: c.startDate } : {}) }); });
      if (range) {
        const order = new Map(board.lists.map((l, i) => [l.id, i]));
        keys.sort((a, b) => order.get(a.listId) - order.get(b.listId) || a.position - b.position);
      }
      return keys;
    }
    async summaries(keys) {
      const rows = await this.db.cards.bulkGet(keys.map(k => [k.boardId, k.id]));
      return rows.filter(Boolean).map(row => this.summary(row));
    }
  }
  window.KanbayaStore = Store;
})();
