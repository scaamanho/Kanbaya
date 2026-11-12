'use strict';
/* Kanbaya PWA. Persistencia transaccional local con Dexie. */
(() => {
  const PRODUCT_VERSION = '1.1.0';
  const PALETTE = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#579dff', '#6cc3e0', '#94c748', '#e774bb', '#8c9bab'];
  const PRIORITIES = [{ value: '', label: 'No priority' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }];
  const WELCOME_PRIORITIES = {
    '👋 Welcome: drag this card to another list': 'low',
    'Click a card to view its details': 'medium',
    'Create your own board with "＋ Create"': 'high',
    'Your data is saved only in this browser': 'critical',
    'Install the app (browser menu → Install)': 'low'
  };
  const EMOJIS = ['😀', '😊', '😍', '👍', '🙌', '✅', '⭐', '🔥', '🎯', '🚀', '💡', '📌', '📅', '⏰', '🎉', '🌴', '☀️', '🌱', '💪', '❤️', '📝', '📚', '💻', '🏠', '🛒', '🎨'];
  const CUSTOM_COLORS = ['#ffffff', '#d9ebff', '#d7f5e8', '#ffe8c2', '#ffdce5', '#e9ddff', '#e8e8e8', '#343a40'];
  const BOARD_SHORTCUTS = [
    { key: 'n', action: 'add-card', label: 'New card in the focused list, or the first list' },
    { key: 'l', action: 'add-list', label: 'New list' },
    { key: '/', action: 'search-cards', label: 'Search cards' },
    { key: 'f', action: 'toggle-filters', label: 'Show / hide filters' },
    { key: 'v', action: 'toggle-view', label: 'Switch board / calendar' },
    { key: 'm', action: 'board-menu', label: 'Open board menu' }
  ];
  const BACKGROUNDS = [
    'linear-gradient(135deg,#0c66e4,#5e4db2)',
    'linear-gradient(135deg,#1f845a,#0c66e4)',
    'linear-gradient(135deg,#c25100,#ae2e24)',
    'linear-gradient(135deg,#943d73,#5e4db2)',
    'linear-gradient(135deg,#206a83,#1f845a)',
    'linear-gradient(135deg,#505f79,#172b4d)',
    '#0c66e4', '#1f845a', '#ae2e24', '#5e4db2', '#37474f'
  ];
  const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="kanbaya-k" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d7ff70"/><stop offset=".52" stop-color="#48db9a"/><stop offset="1" stop-color="#00a98f"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="#073b2a"/><path d="M14 10h11v18L43 10h14L35 30l23 24H43L25 36v18H14z" fill="url(#kanbaya-k)"/></svg>';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const contrastText = hex => {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? '#172b4d' : '#ffffff';
  };
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }); };
  function advanceDate(s, recurrence) {
    const [y, m, d] = s.split('-').map(Number);
    if (recurrence === 'daily') return new Date(y, m - 1, d + 1);
    if (recurrence === 'weekly') return new Date(y, m - 1, d + 7);
    return new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()));
  }
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* ---------------- Modelo ---------------- */
  const mkLabels = () => PALETTE.slice(0, 6).map(color => ({ id: uid(), name: '', color }));
  const mkList = name => ({ id: uid(), name, theme: '', cards: [] });
  const mkCard = title => ({ id: uid(), title, desc: '', labels: [], due: '', dueDone: false, priority: '', completed: false, recurrence: '', theme: '', checklist: [], comments: [], archived: false, created: Date.now() });
  const mkBoard = (name, bg = 0, withLists = true) => ({
    id: uid(), name, bg, bgColor: '', created: Date.now(), favorite: false, labels: mkLabels(),
    lists: withLists ? ['To do', 'In progress', 'Done'].map(mkList) : []
  });

  function normBoard(b) {
    if (!b || typeof b !== 'object') return null;
    const arr = x => (Array.isArray(x) ? x : []);
    if (arr(b.lists).some(list => list?.wipLimit !== undefined && (!Number.isSafeInteger(list.wipLimit) || list.wipLimit < 0))) {
      throw new Error('WIP limits must be non-negative integers.');
    }
    const labels = arr(b.labels).map(l => ({
      id: String(l?.id || uid()), name: String(l?.name || '').slice(0, 60),
      color: /^#[0-9a-f]{6}$/i.test(l?.color) ? l.color : PALETTE[5]
    }));
    const lists = arr(b.lists).map(l => ({
      id: String(l?.id || uid()), name: String(l?.name || 'List').slice(0, 100), theme: /^#[0-9a-f]{6}$/i.test(l?.theme) ? l.theme : '',
      ...(l?.collapsed ? { collapsed: true } : {}),
      ...(l?.wipLimit !== undefined ? { wipLimit: l.wipLimit } : {}),
      cards: arr(l?.cards).map(c => ({
        id: String(c?.id || uid()), title: String(c?.title || 'Untitled').slice(0, 500), desc: String(c?.desc || ''),
        labels: arr(c?.labels).map(String),
        due: /^\d{4}-\d{2}-\d{2}$/.test(c?.due) ? c.due : '', dueDone: !!c?.dueDone,
        priority: PRIORITIES.some(p => p.value === c?.priority) ? c.priority : '', completed: !!c?.completed,
        checklist: arr(c?.checklist).map(i => ({ id: String(i?.id || uid()), text: String(i?.text || ''), done: !!i?.done })),
        comments: arr(c?.comments).map(x => ({ id: String(x?.id || uid()), text: String(x?.text || '').slice(0, 2000), created: Number(x?.created) || Date.now() })),
        recurrence: ['daily', 'weekly', 'monthly'].includes(c?.recurrence) ? c.recurrence : '',
        theme: /^#[0-9a-f]{6}$/i.test(c?.theme) ? c.theme : '',
        ...(Array.isArray(c?.imageIds) ? { imageIds: c.imageIds.map(String), coverImageId: c.imageIds.includes(c.coverImageId) ? c.coverImageId : null } : {}),
        archived: !!c?.archived, created: Number(c?.created) || Date.now()
      }))
    }));
    return {
      id: String(b.id || uid()), name: String(b.name || 'Board').slice(0, 100),
      bg: Number.isInteger(b.bg) && BACKGROUNDS[b.bg] ? b.bg : 0, bgColor: /^#[0-9a-f]{6}$/i.test(b.bgColor) ? b.bgColor : '', created: Number(b.created) || Date.now(), favorite: !!b.favorite, labels, lists
    };
  }

  // Devuelve una copia con todos los ids nuevos.
  function reid(b) {
    const c = JSON.parse(JSON.stringify(b));
    const map = {};
    c.id = uid();
    c.labels.forEach(l => { const n = uid(); map[l.id] = n; l.id = n; });
    c.lists.forEach(l => {
      l.id = uid();
      l.cards.forEach(card => {
        card.id = uid();
        card.labels = card.labels.map(id => map[id]).filter(Boolean);
        card.checklist.forEach(i => { i.id = uid(); });
        (card.comments || []).forEach(x => { x.id = uid(); });
      });
    });
    return c;
  }

  function seed() {
    const b = mkBoard('My first board', 0, true);
    const [todo, doing, done] = b.lists;
    b.labels[0].name = 'Easy'; b.labels[3].name = 'Urgent'; b.labels[5].name = 'Idea';
    const c1 = mkCard('👋 Welcome: drag this card to another list');
    c1.priority = WELCOME_PRIORITIES[c1.title];
    c1.labels = [b.labels[5].id];
    c1.desc = 'You can drag cards between lists and reorder lists by dragging their headers.\nOn mobile, press and hold briefly before dragging.';
    const c2 = mkCard('Click a card to view its details');
    c2.priority = WELCOME_PRIORITIES[c2.title];
    c2.checklist = [{ id: uid(), text: 'Add a label', done: true }, { id: uid(), text: 'Set a due date', done: false }, { id: uid(), text: 'Write a description', done: false }];
    const c3 = mkCard('Create your own board with "＋ Create"');
    c3.priority = WELCOME_PRIORITIES[c3.title];
    c3.labels = [b.labels[0].id];
    const c4 = mkCard('Your data is saved only in this browser');
    c4.priority = WELCOME_PRIORITIES[c4.title];
    c4.desc = 'Use the ⋯ menu in the top corner to export a backup.';
    c4.labels = [b.labels[3].id];
    const c5 = mkCard('Install the app (browser menu → Install)');
    c5.priority = WELCOME_PRIORITIES[c5.title];
    todo.cards.push(c1, c2, c3); doing.cards.push(c4); done.cards.push(c5);
    return { version: 2, theme: 'auto', boards: [b], templates: [] };
  }

  const store = new KanbayaStore();
  let state = { version: 2, theme: 'auto', boards: [], templates: [] };
  const ui = { q: '', boardQuery: '', filters: { status: [], due: [], labels: [] }, filterOpen: false, emojiOpen: false, emojiTarget: null, view: 'board', month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), composer: null, addingList: false, modal: null, focus: null, scrollBottom: null, scrollRight: false };
  let descriptionDraft = null;
  const hasDescriptionChanges = () => descriptionDraft && descriptionDraft.text !== descriptionDraft.original;
  let saveT = null, toastT = null, drag = null, suppressClick = 0, renderCount = 0, menuEl = null, lastBoardId = null;
  let storageUsage = null;

  let ready = false, failed = false, dirty = false, running = false, renderPending = false;
  let work = Promise.resolve(), queued = 0, undoRequest = null;
  let windows = [], viewGeneration = 0;
  const notices = [];
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('kanbaya:commits') : null;
  function storageError(error) {
    console.error('Kanbaya: storage', error);
    failed = true;
    $('#app').inert = true;
    $('#modal-root').inert = true;
    let panel = $('.storage-error');
    if (!panel) { panel = document.createElement('section'); panel.className = 'storage-error'; panel.setAttribute('role', 'alert'); document.body.append(panel); }
    panel.innerHTML = `<p>Could not save to or read from IndexedDB. Writes are blocked to protect your data.</p><p>${esc(error.message || error)}</p><button class="btn" data-recovery="export">Export recovery data</button><button class="btn" data-recovery="reload">Retry / reload</button>`;
    $('[data-recovery="export"]', panel).onclick = async () => {
      try {
        const persisted = await store.exportBackup();
        download(`kanbaya-recovery-${todayStr()}.${persisted.extension}`, persisted.blob);
        download(`kanbaya-partial-draft-${todayStr()}.json`, JSON.stringify({ warning: 'Contains only loaded records and pending changes; this is not a complete backup.', state, descriptionDraft }));
      } catch (recoveryError) {
        console.error('Kanbaya: recovery', recoveryError);
        download('kanbaya-partial-draft.json', JSON.stringify({ warning: 'IndexedDB unavailable; partial draft, not a complete backup.', state, descriptionDraft }));
        toast('Only the partial draft could be recovered.');
      }
    };
    $('[data-recovery="reload"]', panel).onclick = async () => {
      if ((!dirty && !saveT && !hasDescriptionChanges()) || await confirmAction('Export your draft first if you have unsaved changes. Reload?', 'Reload')) location.reload();
    };
  }
  function save() { clearTimeout(saveT); saveT = null; dirty = true; }
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => run(() => save()), 300); };
  async function flush() {
    if (saveT) save();
    if (!dirty) return;
    await store.preparePositions(state);
    const change = await store.commit(state);
    dirty = false;
    if (undoRequest && change) undoRequest.change = change;
    undoRequest = null;
    const metadata = await store.readExportState();
    for (const b of state.boards) {
      const saved = metadata.boards.find(x => x.id === b.id);
      if (saved) {
        b.cardCount = saved.cardCount; b.listCount = saved.listCount;
        b.lists.forEach(l => {
          const row = saved.lists.find(x => x.id === l.id);
          l.cardCount = row?.cardCount || 0; l.wipCount = row?.wipCount || 0;
        });
      }
    }
    await refreshStorageUsage();
  }
  function run(fn) {
    if (!ready || failed) return Promise.resolve();
    queued++;
    work = work.then(async () => {
      if (failed) { queued--; return; }
      running = true;
      try {
        await flush();
        await fn();
        await flush();
        running = false;
        if (renderPending) { renderPending = false; render(); }
        for (const notice of notices.splice(0)) toast(...notice);
      } catch (error) {
        notices.length = 0;
        if (error.name === 'WipLimitError') {
          console.warn('Kanbaya: WIP limit', error);
          try {
            clearTimeout(saveT); saveT = null; dirty = false; undoRequest = null;
            store.pendingImages.clear(); store.rebalances = [];
            state = await store.readState();
            if (ui.modal?.type === 'card' && cur()) {
              const exists = await store.db.cards.get([cur().id, ui.modal.id]);
              if (exists) {
                const card = await store.card(cur().id, ui.modal.id);
                cur().lists.find(list => list.id === card.listId)?.cards.push(card);
                store.adopt(state);
              } else { ui.modal = null; descriptionDraft = null; }
            }
            running = false; renderPending = false; render(); toast(error.message);
          } catch (reloadError) { storageError(reloadError); }
        } else storageError(error);
      }
      finally { running = false; queued--; }
    });
    return work;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) run(() => {}); });
  addEventListener('beforeunload', e => {
    if (saveT || dirty || queued || hasDescriptionChanges()) { e.preventDefault(); e.returnValue = ''; }
  });
  store.oncommit = () => channel?.postMessage({ revision: store.revision });
  store.onblocked = () => storageError(new Error('Close other Kanbaya tabs to upgrade the database.'));
  store.onversionchange = () => storageError(new Error('A new version of the database is available. Reload this tab.'));

  const boardById = id => state.boards.find(b => b.id === id);
  const route = () => { const m = location.hash.match(/^#\/b\/([\w-]+)/); return { board: (m && boardById(m[1])) || null }; };
  const cur = () => route().board;
  const findCard = (b, id) => { for (const l of b.lists) { const c = l.cards.find(c => c.id === id); if (c) return { list: l, card: c }; } return null; };
  const ctxCard = () => { const b = cur(); const f = b && ui.modal?.type === 'card' ? findCard(b, ui.modal.id) : null; return f ? { b, ...f } : null; };
  const isImage = attachment => !!attachment && attachment.kind !== 'file' && attachment.mime?.startsWith('image/');
  const descriptionImagePattern = /!\[([^\]\n]*)\]\(attachment:([\w-]+)\)/g;
  function descriptionHTML(card, attachments, text = card.desc) {
    const renderer = new marked.Renderer();
    renderer.html = token => esc(token.text);
    renderer.image = ({ href, text, title }) => {
      if (href.startsWith('attachment:')) {
        const id = href.slice('attachment:'.length);
        const image = attachments?.find(item => item.id === id);
        return card.imageIds?.includes(id) && isImage(image)
          ? `<img data-image-id="${esc(id)}" alt="${esc(text)}" class="description-image">`
          : `<span class="muted">[Image unavailable: ${esc(text)}]</span>`;
      }
      if (!/^https?:\/\//i.test(href)) return esc(text);
      return `<img src="${esc(href)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} class="description-image" loading="lazy" referrerpolicy="no-referrer">`;
    };
    renderer.link = function ({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      let url;
      try { url = new URL(href, location.href); }
      catch { return label; }
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return label;
      return `<a href="${esc(url.href)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`;
    };
    return DOMPurify.sanitize(marked.parse(text, { renderer, gfm: true, breaks: false }), {
      USE_PROFILES: { html: true }, ADD_ATTR: ['data-image-id', 'target', 'referrerpolicy']
    });
  }
  function updateDescriptionPreview() {
    const context = ctxCard(), preview = $('.description-preview');
    if (context && preview && descriptionDraft) preview.innerHTML = descriptionHTML(context.card, ui.modal.images, descriptionDraft.text);
  }
  async function discardDescription() {
    if (hasDescriptionChanges() && !await confirmAction('Discard unsaved description changes?', 'Discard')) return false;
    descriptionDraft = null;
    return true;
  }

  async function prepareImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose a valid image file.');
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error('This image format is not supported or the file is damaged.'); }
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is not available in this browser.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.75));
      if (!blob) throw new Error('Could not compress the image.');
      return { kind: 'image', blob, mime: blob.type, size: blob.size, width: canvas.width, height: canvas.height };
    } finally { bitmap.close(); }
  }

  async function prepareAttachment(file) {
    if (file.type.startsWith('image/')) return prepareImage(file);
    const blob = await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return {
      kind: 'file', compression: 'gzip', originalSize: file.size,
      blob, mime: file.type.split(';')[0].trim() || 'application/octet-stream', size: blob.size
    };
  }
  async function addAttachments(files, context) {
    if (!context || !files.length) return;
    const status = $('.image-status');
    if (status) status.textContent = 'Processing attachments...';
    try {
      const images = [];
      for (const file of files) images.push({
        ...await prepareAttachment(file), id: uid(), boardId: context.b.id, cardId: context.card.id,
        name: String(file.name || 'Attachment').slice(0, 200), created: Date.now()
      });
      mutate(() => {
        const c = context.card;
        const first = !(ui.modal.images || []).some(isImage);
        c.imageIds = [...(c.imageIds || []), ...images.map(image => image.id)];
        if (first) c.coverImageId = images.find(isImage)?.id || c.coverImageId || null;
        images.forEach(image => store.stageImage(image));
        if (ui.modal?.id === c.id) ui.modal.images = [...(ui.modal.images || []), ...images.map(({ blob, ...metadata }) => metadata)];
      }, `${images.length} attachment(s) added`);
    } catch (error) {
      console.error('Kanbaya: attachment upload', error);
      toast(`Could not add attachments: ${error.message}`);
    } finally { if (status?.isConnected) status.textContent = ''; }
  }

  async function copyBoardImages(source, target) {
    for (let li = 0; li < source.lists.length; li++) {
      for (let ci = 0; ci < source.lists[li].cards.length; ci++) {
        await store.copyImages(source.lists[li].cards[ci], target.lists[li].cards[ci], target.id);
      }
    }
  }

  async function duplicateCard(source, boardId) {
    const copy = structuredClone(source);
    copy.id = uid(); copy.created = Date.now();
    copy.checklist.forEach(item => { item.id = uid(); });
    copy.comments.forEach(item => { item.id = uid(); });
    await store.copyImages(source, copy, boardId);
    return copy;
  }

  const imageElements = new Map();
  function imagePreviewError(el, error) {
    if (!el.isConnected) return;
    console.error('Kanbaya: image preview', error);
    el.alt = 'Image unavailable';
    toast(`Could not display image: ${error.message}`);
  }
  const imageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target, record = imageElements.get(el);
      imageObserver.unobserve(el);
      if (!record) continue;
      store.db.images.get(el.dataset.imageId).then(image => {
        if (!el.isConnected || imageElements.get(el) !== record) return;
        if (!isImage(image)) throw new Error('An attached image is missing.');
        record.url = URL.createObjectURL(image.blob);
        el.onerror = () => {
          if (record.url) URL.revokeObjectURL(record.url);
          record.url = null;
          imagePreviewError(el, new Error('The saved image cannot be decoded.'));
        };
        el.src = record.url;
      }).catch(error => imagePreviewError(el, error));
    }
  }, { rootMargin: '100px' });
  function syncImages() {
    for (const [el, record] of imageElements) {
      if (el.isConnected) continue;
      imageObserver.unobserve(el);
      if (record.url) URL.revokeObjectURL(record.url);
      imageElements.delete(el);
    }
    for (const el of $$('img[data-image-id]')) {
      if (imageElements.has(el)) continue;
      imageElements.set(el, { url: null });
      imageObserver.observe(el);
    }
  }
  new MutationObserver(syncImages).observe($('#app'), { childList: true, subtree: true });
  new MutationObserver(syncImages).observe($('#modal-root'), { childList: true, subtree: true });

  function rememberEmojiTarget(el) {
    if (!el || !ui.modal || ui.modal.type !== 'card') return;
    let target;
    if (el.matches('.m-title')) target = { kind: 'title' };
    else if (el.matches('[data-f="desc"]')) target = { kind: 'desc' };
    else if (el.matches('.ci-text')) target = { kind: 'check-text', id: el.dataset.iid };
    else if (el.matches('.add-check input')) target = { kind: 'new-check' };
    else if (el.matches('.add-comment textarea')) target = { kind: 'new-comment' };
    if (!target) return;
    target.start = Number.isInteger(el.selectionStart) ? el.selectionStart : el.value.length;
    target.end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : target.start;
    ui.emojiTarget = target;
    if (target.kind === 'desc' && descriptionDraft) descriptionDraft.selection = { start: target.start, end: target.end };
  }

  function emojiTargetElement() {
    const target = ui.emojiTarget || { kind: 'title' };
    if (target.kind === 'title') return $('.m-title');
    if (target.kind === 'desc') return $('[data-f="desc"]');
    if (target.kind === 'check-text') return $$('.ci-text').find(el => el.dataset.iid === target.id);
    if (target.kind === 'new-check') return $('.add-check input');
    if (target.kind === 'new-comment') return $('.add-comment textarea');
    return null;
  }

  function insertEmoji(emoji) {
    const el = emojiTargetElement();
    if (!el) return;
    const target = ui.emojiTarget || { start: el.value.length, end: el.value.length };
    const start = Math.min(target.start ?? el.value.length, el.value.length);
    const end = Math.min(target.end ?? start, el.value.length);
    el.value = el.value.slice(0, start) + emoji + el.value.slice(end);
    const caret = start + emoji.length;
    el.focus();
    el.setSelectionRange?.(caret, caret);
    rememberEmojiTarget(el);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    ui.emojiOpen = false;
    $('.emoji-picker')?.setAttribute('hidden', '');
    $('.emoji-trigger')?.setAttribute('aria-expanded', 'false');
  }

  function mutate(fn, msg) {
    fn(); save(); render();
    if (msg) {
      const request = {}; undoRequest = request;
      toast(msg, () => run(async () => {
        if (!await discardDescription()) return;
        if (!request.change) throw new Error('There is no committed operation to undo.');
        await store.undo(request.change);
        state = await store.readState(); render();
      }));
    }
  }

  function toast(msg, undo) {
    if (running) { notices.push([msg, undo]); return; }
    const root = $('#toast-root');
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
    t.append(document.createTextNode(msg));
    if (undo) { const b = document.createElement('button'); b.textContent = 'Undo'; b.onclick = () => { undo(); t.remove(); }; t.append(b); }
    root.replaceChildren(t);
    clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 6500);
  }

  /* ---------------- Vistas ---------------- */
  const themeIcon = () => ({ auto: '◐', light: '☀', dark: '☾' }[state.theme]);
  const themeName = () => ({ auto: 'automatic', light: 'light', dark: 'dark' }[state.theme]);

  function topbarHTML() {
    const usage = storageUsage && storageUsage.quota > 0 ? Math.min(100, Math.round(storageUsage.usage / storageUsage.quota * 100)) : null;
    const details = usage === null ? '' : `${formatStorageBytes(storageUsage.usage)} used of ${formatStorageBytes(storageUsage.quota)}`;
    return `<header class="topbar">
      <a class="brand" href="#/" aria-label="Home">${LOGO}<span>Kanbaya</span></a>
      <button class="btn ghost" data-act="boards-menu">Boards ▾</button>
      <button class="btn primary sm" data-act="new-board">＋ Create</button>
      <span class="spacer"></span>
      <div class="storage-meter" role="group" aria-label="Browser storage">
        <div class="storage-meter-head"><span>Storage</span><span class="storage-value">${usage === null ? 'Checking…' : `${usage}%`}</span></div>
        <div class="storage-track" role="progressbar" aria-label="Storage used" aria-valuemin="0" aria-valuemax="100"${usage === null ? '' : ` aria-valuenow="${usage}" aria-valuetext="${details} (${usage}%)" title="${details} (${usage}%)"`}><span style="width:${usage ?? 0}%"></span></div>
      </div>
      ${window.kanbayaInstallAvailable ? '<button class="btn ghost sm" type="button" data-install-trigger>⬇ Install</button>' : ''}
      <button class="icon-btn" data-act="theme" title="Theme: ${themeName()}" aria-label="Change theme (current: ${themeName()})">${themeIcon()}</button>
      <button class="icon-btn" data-act="data-menu" title="Data" aria-label="Data menu">⋯</button>
    </header>`;
  }

  function formatStorageBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }

  async function refreshStorageUsage() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      storageUsage = Number.isFinite(estimate?.usage) && Number.isFinite(estimate?.quota) && estimate.quota > 0
        ? { usage: estimate.usage, quota: estimate.quota }
        : null;
    } catch { storageUsage = null; }
    const meter = $('.storage-meter');
    if (!meter) return;
    const value = $('.storage-value', meter), track = $('.storage-track', meter), fill = $('span', track);
    const usage = storageUsage ? Math.min(100, Math.round(storageUsage.usage / storageUsage.quota * 100)) : null;
    const details = usage === null ? '' : `${formatStorageBytes(storageUsage.usage)} used of ${formatStorageBytes(storageUsage.quota)}`;
    value.textContent = usage === null ? 'Unavailable' : `${usage}%`;
    fill.style.width = `${usage ?? 0}%`;
    if (usage === null) {
      track.removeAttribute('aria-valuenow'); track.removeAttribute('aria-valuetext'); track.removeAttribute('title');
    } else {
      track.setAttribute('aria-valuenow', usage); track.setAttribute('aria-valuetext', `${details} (${usage}%)`); track.title = `${details} (${usage}%)`;
    }
  }

  function homeHTML() {
    const query = ui.boardQuery.trim().toLocaleLowerCase();
    const boards = state.boards.filter(b => b.name.toLocaleLowerCase().includes(query));
    const favorites = boards.filter(b => b.favorite);
    const emptyMessage = state.boards.length ? 'No boards match your search.' : 'You have no boards yet. Create your first one!';
    const tiles = list => list.map(b => {
      const lists = b.lists.length, cards = b.cardCount || 0;
      const favoriteLabel = b.favorite ? `Remove ${esc(b.name)} from favorites` : `Add ${esc(b.name)} to favorites`;
      return `<div class="board-tile-wrap"><a class="board-tile" href="#/b/${b.id}" style="background:${BACKGROUNDS[b.bg]}"><span>${esc(b.name)}</span><small>${lists} lists · ${cards} cards</small></a><button class="board-favorite-toggle" data-act="toggle-favorite" data-id="${b.id}" aria-label="${favoriteLabel}" aria-pressed="${!!b.favorite}" title="${favoriteLabel}">${b.favorite ? '★' : '☆'}</button></div>`;
    }).join('');
    return `<main class="home">
      <div class="home-heading"><h1>Your boards</h1><input class="home-board-search" type="search" placeholder="Search boards…" aria-label="Search boards" value="${esc(ui.boardQuery)}"></div>
      ${favorites.length ? `<section class="home-section" data-section="favorites"><h2>★ Favorites</h2><div class="board-grid">${tiles(favorites)}</div></section>` : ''}
      <section class="home-section" data-section="all-boards"><h2>All boards</h2><div class="board-grid">${tiles(boards)}<button class="board-tile new" data-act="new-board">＋ Create board</button></div>
      ${!boards.length ? `<p class="empty">${emptyMessage}</p>` : ''}</section>
      </main>`;
  }

  const activeFilterCount = () => (ui.q ? 1 : 0) + ui.filters.status.length + ui.filters.due.length + ui.filters.labels.length;
  function updateFilterToggle() {
    const button = $('.filter-toggle'); if (!button) return;
    const count = activeFilterCount();
    button.classList.toggle('has-filters', count > 0);
    button.innerHTML = `☷ Filter${count ? `<span class="filter-count">${count}</span>` : ''}`;
  }
  const themeStyle = (color, surface, text) => color ? `style="--${surface}:${color};--${text}:${contrastText(color)}"` : '';

  function cardHTML(b, c) {
    const labs = c.labels.map(id => b.labels.find(l => l.id === id)).filter(Boolean);
    const priority = PRIORITIES.find(p => p.value === c.priority);
    const priorityBadge = priority?.value ? `<span class="badge priority-badge priority-${priority.value}" title="Priority: ${priority.label}">▲ ${priority.label}</span>` : '';
    const n = c._summary ? c._checkDone : c.checklist.filter(i => i.done).length;
    const checks = c._summary ? c._checkCount : c.checklist.length;
    const comments = c._summary ? c._commentCount : c.comments.length;
    const hasDesc = c._summary ? c._hasDesc : !!c.desc.trim();
    let due = '';
    if (c.due) {
      const cls = c.completed ? 'ok' : c.due < todayStr() ? 'overdue' : c.due === todayStr() ? 'soon' : '';
      due = `<span class="badge ${cls}" title="Due date">⏰ ${fmtDate(c.due)}</span>`;
    }
    return `<article class="card ${c.completed ? 'is-completed' : ''}" ${themeStyle(c.theme, 'card-theme', 'card-theme-text')} data-act="open-card" data-id="${c.id}" data-virtual-id="${c.id}" tabindex="0" role="button">
      ${c.coverImageId ? `<img class="card-cover" data-image-id="${esc(c.coverImageId)}" alt="Card cover" draggable="false">` : ''}
      ${labs.length ? `<div class="card-labels">${labs.map(l => `<span class="lbl ${l.name ? 'named' : ''}" style="background:${l.color}" title="${esc(l.name)}">${esc(l.name)}</span>`).join('')}</div>` : ''}
      <div class="card-title">${esc(c.title)}</div>
      ${(priorityBadge || due || hasDesc || checks || comments || c.imageIds?.length) ? `<div class="card-badges">${priorityBadge}${due}${hasDesc ? '<span class="badge" title="Has description">≡</span>' : ''}${checks ? `<span class="badge ${n === checks ? 'ok' : ''}" title="Checklist">☑ ${n}/${checks}</span>` : ''}${comments ? `<span class="badge" title="Comments">▤ ${comments}</span>` : ''}${c.imageIds?.length ? `<span class="badge" title="Attachments">▧ ${c.imageIds.length}</span>` : ''}</div>` : ''}
    </article>`;
  }

  function listHTML(b, l) {
    const composer = ui.composer === l.id
      ? `<div class="composer"><textarea rows="3" maxlength="500" placeholder="Enter a title for this card…" aria-label="Card title"></textarea>
         <div class="row"><button class="btn primary sm" data-act="save-card">Add card</button><button class="icon-btn" data-act="cancel-card" aria-label="Cancel">✕</button></div></div>`
      : '<button class="add-card" data-act="add-card">＋ Add a card</button>';
    return `<section class="list ${l.collapsed ? 'is-collapsed' : ''}" ${themeStyle(l.theme, 'lane-theme', 'lane-theme-text')} data-id="${l.id}">
      <div class="list-header"><h3 class="list-title" data-act="edit-list-title" title="Click to rename">${esc(l.name)}</h3>
        <span class="count">${l.cardCount || 0}</span>
        ${l.wipLimit ? `<span class="wip-count ${(l.wipCount || 0) >= l.wipLimit ? 'at-limit' : ''}" title="WIP: non-archived, incomplete cards" aria-label="WIP ${l.wipCount || 0} of ${l.wipLimit}">${l.wipCount || 0}/${l.wipLimit}</span>` : ''}
        <button class="icon-btn" data-act="list-menu" aria-label="List actions">⋯</button></div>
      ${l.collapsed ? `<button class="expand-list" data-act="expand-list" data-id="${l.id}" aria-label="Expand ${esc(l.name)}">Expand list</button>` : `<div class="list-cards" data-virtual-list="${l.id}"></div>
      <div class="list-footer">${composer}</div>`}</section>`;
  }

  function addListHTML() {
    return ui.addingList
      ? `<div class="add-list open"><input maxlength="80" placeholder="List name…" aria-label="List name">
         <div class="row"><button class="btn primary sm" data-act="save-list">Add list</button><button class="icon-btn" data-act="cancel-list" aria-label="Cancel">✕</button></div></div>`
      : '<div class="add-list"><button data-act="add-list">＋ Add another list</button></div>';
  }
  const listsHTML = b => b.lists.map(l => listHTML(b, l)).join('') + addListHTML();

  function boardHTML(b) {
    const activeFilters = activeFilterCount();
    return `<main class="board" style="background:${b.bgColor || BACKGROUNDS[b.bg]}">
      <div class="board-bar">
        <textarea class="board-title" rows="1" maxlength="100" aria-label="Board name">${esc(b.name)}</textarea>
        <button class="icon-btn board-favorite-toggle" data-act="toggle-favorite" aria-label="${b.favorite ? `Remove ${esc(b.name)} from favorites` : `Add ${esc(b.name)} to favorites`}" aria-pressed="${!!b.favorite}" title="${b.favorite ? 'Remove from favorites' : 'Add to favorites'}">${b.favorite ? '★' : '☆'}</button>
        <span class="spacer"></span>
        <button class="btn sm filter-toggle ${activeFilters ? 'has-filters' : ''}" data-act="toggle-filters" aria-expanded="${ui.filterOpen}" aria-controls="filter-panel">☷ Filter${activeFilters ? `<span class="filter-count">${activeFilters}</span>` : ''}</button>
        <button class="btn sm" data-act="toggle-view">${ui.view === 'calendar' ? '☷ Board' : '▦ Calendar'}</button>
        <button class="btn sm" data-act="board-menu">☰ Menu</button>
        ${ui.filterOpen ? filterPanelHTML(b) : ''}
      </div>
      ${ui.view === 'calendar' ? calendarHTML(b) : `<div class="board-scroll"><div class="lists">${listsHTML(b)}</div></div>`}</main>`;
  }

  function filterPanelHTML(b) {
    const selected = (group, value) => ui.filters[group].includes(value) ? 'checked' : '';
    const option = (group, value, title, icon = '') => `<label class="filter-option"><input type="checkbox" data-filter-group="${group}" value="${value}" ${selected(group, value)}><span class="filter-option-icon">${icon}</span><span>${title}</span></label>`;
    return `<aside class="filter-panel" id="filter-panel" aria-label="Filter cards">
      <header class="filter-panel-head"><strong>Filter</strong><button class="icon-btn" data-act="close-filters" aria-label="Close filters">×</button></header>
      <div class="filter-panel-body">
        <section class="filter-section"><h4>Keyword</h4><input class="filter-keyword" type="search" placeholder="Enter a keyword…" value="${esc(ui.q)}" aria-label="Keyword"><small>Search cards, labels, descriptions, and comments.</small></section>
        <section class="filter-section"><h4>Card status</h4>${option('status', 'completed', 'Marked as complete', '✓')}${option('status', 'incomplete', 'Not marked as complete', '○')}</section>
        <section class="filter-section"><h4>Due date</h4>${option('due', 'none', 'No due date', '▣')}${option('due', 'overdue', 'Overdue', '◉')}${option('due', 'tomorrow', 'Due the next day', '◷')}${option('due', 'week', 'Due in the next week', '◷')}${option('due', 'month', 'Due in the next month', '◷')}</section>
        <section class="filter-section"><h4>Labels</h4>${option('labels', 'none', 'No labels', '◇')}${b.labels.map(label => `<label class="filter-option filter-label-option"><input type="checkbox" data-filter-group="labels" value="${label.id}" ${selected('labels', label.id)}><span class="filter-label-chip" style="background:${label.color}">${esc(label.name || 'Unnamed')}</span></label>`).join('')}</section>
        <div class="filter-panel-actions"><button class="btn sm" data-act="clear-filters">Clear filters</button><button class="btn sm primary" data-act="close-filters">Done</button></div>
      </div>
    </aside>`;
  }

  function calendarHTML(b) {
    const month = ui.month, y = month.getFullYear(), m = month.getMonth();
    const first = new Date(y, m, 1), offset = (first.getDay() + 6) % 7;
    const start = new Date(y, m, 1 - offset);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = dateKey(d);
      return `<div class="cal-day ${d.getMonth() !== m ? 'outside' : ''} ${key === todayStr() ? 'today' : ''}"><span class="cal-num">${d.getDate()}</span><div class="cal-events" data-virtual-day="${key}"></div></div>`;
    }).join('');
    return `<section class="calendar"><div class="calendar-head"><button class="btn" data-act="month-prev" aria-label="Previous month">‹</button><h2>${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2><button class="btn" data-act="month-next" aria-label="Next month">›</button><button class="btn sm" data-act="month-today">Today</button></div><div class="calendar-grid"><div class="cal-week">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<strong>${x}</strong>`).join('')}</div><div class="cal-cells">${cells}</div></div></section>`;
  }

  function captureScroll() {
    const sc = $('.board-scroll'); if (!sc) return null;
    const lists = {}; $$('.list').forEach(l => { lists[l.dataset.id] = $('.list-cards', l)?.scrollTop || 0; });
    return { board: lastBoardId, x: sc.scrollLeft, lists };
  }
  function restoreScroll(s, boardId) {
    const sc = $('.board-scroll'); if (!sc || !s || s.board !== boardId) return;
    sc.scrollLeft = s.x;
    $$('.list').forEach(l => { const t = s.lists[l.dataset.id], cards = $('.list-cards', l); if (t != null && cards) cards.scrollTop = t; });
  }

  function sizeBoardTitle() {
    const title = $('.board-title');
    if (!title) return;
    const style = getComputedStyle(title);
    const measure = document.createElement('span');
    measure.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;pointer-events:none';
    measure.style.font = style.font;
    measure.style.letterSpacing = style.letterSpacing;
    measure.textContent = title.value || 'Board';
    document.body.append(measure);
    title.style.width = Math.ceil(measure.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + 2) + 'px';
    measure.remove();
    title.style.height = 'auto';
    title.style.height = title.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) + 'px';
  }
  addEventListener('resize', sizeBoardTitle);

  function render() {
    if (!ready || failed) return;
    if (running) { renderPending = true; return; }
    if (drag?.active) return;
    windows.forEach(w => w.destroy()); windows = [];
    viewGeneration++;
    renderCount++;
    document.documentElement.dataset.theme = state.theme === 'auto' ? '' : state.theme;
    const b = cur();
    if (!dirty && !saveT) {
      state.boards.filter(board => board !== b).forEach(board => board.lists.forEach(list => { list.cards = []; }));
      store.adopt(state);
    }
    const scrollBottom = ui.scrollBottom;
    const s = captureScroll();
    const search = document.activeElement?.matches('.home-board-search') ? document.activeElement : null;
    const searchSelection = search ? { start: search.selectionStart, end: search.selectionEnd, direction: search.selectionDirection } : null;
    document.title = b ? `${b.name} · Kanbaya` : 'Kanbaya';
    $('#app').innerHTML = topbarHTML() + (b ? boardHTML(b) : homeHTML()) + `<footer class="app-footer">
      <span class="product-version">Kanbaya v${PRODUCT_VERSION}</span>
      ${b ? '' : '<a class="support-link" href="https://www.buymeacoffee.com/scaamanho" target="_blank" rel="noopener noreferrer" aria-label="Buy Me a Coffee"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="100" height="30"></a>'}
    </footer>`;
    sizeBoardTitle();
    restoreScroll(s, b?.id);
    lastBoardId = b?.id ?? null;
    if (b && ui.scrollRight) { const sc = $('.board-scroll'); sc.scrollLeft = sc.scrollWidth; }
    if (b && ui.scrollBottom) { const w = $(`.list[data-id="${ui.scrollBottom}"] .list-cards`); if (w) w.scrollTop = w.scrollHeight; }
    ui.scrollRight = false; ui.scrollBottom = null;
    renderModal();
    mountViews(viewGeneration, scrollBottom).catch(storageError);
    if (searchSelection && !b && !ui.modal && !ui.focus) {
      const input = $('.home-board-search');
      input.focus({ preventScroll: true });
      input.setSelectionRange(searchSelection.start, searchSelection.end, searchSelection.direction);
    }
    if (ui.focus) {
      const el = $(ui.focus);
      if (el) { el.focus(); if (el.setSelectionRange && el.value) { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* tipo sin selección */ } } }
      ui.focus = null;
    }
  }

  async function mountViews(generation, scrollBottom) {
    const b = cur(); if (!b) return;
    const filters = structuredClone(ui.filters), query = ui.q;
    const valid = () => generation === viewGeneration && !failed && !running && !dirty && !saveT;
    const attach = rows => {
      if (!valid()) return;
      for (const l of b.lists) {
        const detail = l.cards.find(c => !c._summary && c.id === ui.modal?.id);
        l.cards = rows.filter(c => c.listId === l.id);
        if (detail) {
          l.cards = l.cards.filter(c => c.id !== detail.id); l.cards.push(detail);
        }
        if (drag?.card && drag.card.listId === l.id && !l.cards.some(c => c.id === drag.card.id)) l.cards.push(drag.card);
        l.cards.sort((a, b) => a._pos - b._pos);
      }
      store.adopt(state);
    };
    const rowsByHost = new Map();
    const make = async (host, keys, key, html, estimate) => {
      if (!valid() || !host.isConnected) return;
      const window = new KanbayaVirtual(host, keys, {
        key: `${b.id}:${key}:${query}:${JSON.stringify(filters)}`,
        revision: store.revision, html, estimate,
        label: host.closest('.list')?.querySelector('.list-title')?.textContent || 'Cards',
        read: keys => store.summaries(keys),
        loaded: rows => {
          rowsByHost.set(host, rows); attach([...rowsByHost.values()].flat());
          if (drag?.active && drag.card) $$('[data-act="open-card"]', host).filter(el => el.dataset.id === drag.card.id).forEach(el => el.classList.add('drag-hidden'));
        },
        paused: () => !valid(),
        afterLayout: () => { if (drag?.active) reorder(); },
        error: storageError
      });
      windows.push(window);
      if (host.dataset.virtualList === scrollBottom) host.scrollTop = host.scrollHeight;
      await window.draw();
    };
    const listHosts = $$('[data-virtual-list]');
    await Promise.all(listHosts.map(async host => {
      const list = b.lists.find(l => l.id === host.dataset.virtualList);
      const keys = await store.listKeys(b, list, filters, query);
      if (!valid()) return;
      $('.count', host.closest('.list')).textContent = activeFilterCount() ? `${keys.length}/${list.cardCount || 0}` : keys.length;
      await make(host, keys, 'list:' + list.id, c => cardHTML(b, c), 110);
    }));
    const days = $$('[data-virtual-day]');
    if (days.length) {
      const keys = await store.listKeys(b, null, filters, query, false, [days[0].dataset.virtualDay, days.at(-1).dataset.virtualDay]);
      await Promise.all(days.map(host => make(host, keys.filter(k => k.due === host.dataset.virtualDay), 'day:' + host.dataset.virtualDay,
        c => `<button class="cal-event ${c.completed ? 'done' : ''}" data-act="open-card" data-id="${c.id}" data-virtual-id="${c.id}" title="${esc(b.lists.find(l => l.id === c.listId)?.name)}">${esc(c.title)}</button>`, 32)));
    }
    const archive = $('.archive-window:not(.templates-window)');
    if (archive) {
      const groups = await Promise.all(b.lists.map(l => store.listKeys(b, l, { status: [], due: [], labels: [] }, '', true)));
      if (!groups.some(keys => keys.length) && valid()) archive.textContent = 'There are no archived cards.';
      if (!groups.some(keys => keys.length)) return;
      await make(archive, groups.flat(), 'archive', c => `<div class="arch-row" data-virtual-id="${c.id}" tabindex="0"><div class="t">${esc(c.title)}<small>from "${esc(b.lists.find(l => l.id === c.listId)?.name)}"</small></div><button class="btn sm" data-act="restore-card" data-id="${c.id}">Restore</button><button class="btn sm danger" data-act="purge-card" data-id="${c.id}">Delete</button></div>`, 72);
    }
    const templates = $('.templates-window');
    if (templates && valid()) {
      const virtual = new KanbayaVirtual(templates, state.templates, {
        key: 'templates', revision: store.revision, estimate: 100,
        read: async rows => rows, html: templateHTML,
        paused: () => !valid(), error: storageError
      });
      windows.push(virtual); await virtual.draw();
    }
  }

  /* ---------------- Modales ---------------- */
  function swatches(selected, name = 'bg') {
    return `<div class="swatches" role="radiogroup" aria-label="Background">${BACKGROUNDS.map((bg, i) =>
      `<label class="swatch" style="background:${bg}"><input type="radio" name="${name}" value="${i}" data-f="bg" ${i === selected ? 'checked' : ''} aria-label="Background ${i + 1}"><span>✓</span></label>`).join('')}</div>`;
  }
  function themeEditor(color, field, id, resetAction) {
    return `<div class="theme-editor"><div class="theme-swatches" aria-label="Suggested colors">${CUSTOM_COLORS.map((value, i) => `<label class="theme-swatch" style="--swatch:${value}" title="Color ${i + 1}"><input type="radio" name="${field}-${id}" value="${value}" data-f="${field}" data-id="${id}" ${value === color ? 'checked' : ''} aria-label="Color ${i + 1}"><span>✓</span></label>`).join('')}</div><label class="custom-color">Custom color<input type="color" value="${color || '#48c996'}" data-f="${field}" data-id="${id}"></label><button class="btn sm" data-act="${resetAction}" data-id="${id}">Use default</button></div>`;
  }
  const wrapModal = (inner, cls = '', overlayCls = '') =>
    `<div class="overlay ${overlayCls}" data-act="close-modal"><div class="modal ${cls}" role="dialog" aria-modal="true">${inner}</div></div>`;

  function newBoardModal() {
    return wrapModal(`<h3>Create board</h3>
      <div class="form-row"><label class="t" for="nb-name">Name</label><input id="nb-name" class="nb-name field" type="text" maxlength="100" placeholder="e.g. Web project"></div>
      <div class="form-row"><label class="t">Background</label>${swatches(0)}</div>
      <label class="check"><input type="checkbox" class="nb-lists" checked> Start with "To do", "In progress", and "Done" lists</label>
      <div class="actions"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="create-board">Create board</button></div>`, 'narrow');
  }

  function descriptionEditor(card, attachments) {
    const draft = descriptionDraft;
    const tools = [
      ['heading', 'Heading', 'M4 4v12M14 4v12M4 10h10'],
      ['bold', 'Bold', 'M6 4h5a3 3 0 0 1 0 6H6V4Zm0 6h6a3 3 0 0 1 0 6H6v-6Z'],
      ['italic', 'Italic', 'M9 4h6M5 16h6M12 4 8 16'],
      ['strike', 'Strikethrough', 'M14 5c-1-2-8-2-8 1 0 2 3 3 4 4M6 15c2 2 8 2 8-1M3 10h14'],
      ['ul', 'Bullet list', 'M8 5h9M8 10h9M8 15h9M3 5h1M3 10h1M3 15h1'],
      ['ol', 'Numbered list', 'M8 5h9M8 10h9M8 15h9M3 3h1v5M2 11c0-2 3-2 3 0 0 1-3 3-3 4h3'],
      ['task', 'Task list', 'M8 5h9M8 14h9M2 4l2 2 3-4M2 11h4v5H2z'],
      ['quote', 'Quote', 'M4 5h5v5H4zM4 10c0 3 1 4 3 5M12 5h5v5h-5zM12 10c0 3 1 4 3 5'],
      ['code', 'Inline code', 'm6 6-4 4 4 4m8-8 4 4-4 4M12 4 8 16'],
      ['codeblock', 'Code block', 'M7 3H5v5l-2 2 2 2v5h2M13 3h2v5l2 2-2 2v5h-2'],
      ['link', 'Insert link', 'm8 6 2-2a4 4 0 0 1 6 6l-2 2M6 8l-2 2a4 4 0 0 0 6 6l2-2M7 13l6-6'],
      ['image', 'Insert attached image', 'M3 3h14v14H3zM3 14l4-4 3 3 3-5 4 6M7 6h.01'],
      ['table', 'Insert table', 'M3 3h14v14H3zM3 8h14M8 3v14M3 12h14M12 8v9'],
      ['rule', 'Horizontal rule', 'M3 10h14']
    ];
    return `<div class="description-editor">
      <div class="description-toolbar" role="toolbar" aria-label="Markdown formatting">${tools.map(([format, label, path], index) => `${[4, 8, 10].includes(index) ? '<span class="editor-separator" aria-hidden="true"></span>' : ''}<button type="button" class="editor-tool" data-act="${format === 'image' ? 'toggle-description-images' : 'format-description'}" ${format === 'image' ? `aria-expanded="${!!draft.imagePicker}" aria-controls="description-image-picker"` : `data-format="${format}"`} aria-label="${label}" title="${label}" ${draft.preview ? 'disabled' : ''}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg></button>`).join('')}
        <button class="editor-tool editor-preview" data-act="preview-description" aria-pressed="${draft.preview}">${draft.preview ? 'Write' : 'Preview'}</button>
      <div id="description-image-picker" class="description-picker" role="region" aria-label="Attached images" ${!draft.imagePicker || draft.preview ? 'hidden' : ''}>
        <div class="description-picker-heading"><span>Insert attached image</span><button type="button" class="editor-tool" data-act="toggle-description-images" aria-label="Close image picker">&times;</button></div>
        <div class="description-image-options">${(attachments || []).filter(isImage).map(image => `<button class="btn" data-act="insert-description-image" data-image-id="${esc(image.id)}"><img data-image-id="${esc(image.id)}" alt="" draggable="false"><span>${esc(image.name)}</span></button>`).join('') || '<p class="muted">Upload an image in Attachments first.</p>'}</div>
      </div></div>
      <textarea data-f="desc" placeholder="Write a description using Markdown..." aria-label="Description" ${draft.preview ? 'hidden' : ''}>${esc(draft.text)}</textarea>
      ${draft.preview ? `<div class="description-preview markdown-body" data-act="preview-description" aria-label="Description preview">${descriptionHTML(card, attachments, draft.text)}</div>` : ''}
    </div>
    <div class="description-actions"><button class="btn primary" data-act="save-description">Save description</button><button class="btn" data-act="cancel-description">Cancel</button>
      <details class="markdown-help"><summary>Formatting guide</summary><p>Markdown supports headings, paragraphs, **bold**, *italic*, ~~strikethrough~~, links, images, lists, task lists, quotes, tables, horizontal rules and fenced code blocks.</p><pre># Heading
**bold** and *italic*
[Link](https://example.com)
- Item
- [ ] Task
&gt; Quote
\`inline code\`
\`\`\`js
const answer = 42;
\`\`\`
| Column | Value |
| --- | --- |
| Item | Text |</pre><p>Use Preview to see the result. HTML is displayed as text, not executed. Ctrl+Enter (or Cmd+Enter) saves; Escape cancels editing.</p></details>
    </div>`;
  }

  function cardModal(b, m) {
    const f = findCard(b, m.id); if (!f) return '';
    const { list, card: c } = f;
    const n = c.checklist.filter(i => i.done).length, pct = c.checklist.length ? Math.round(n / c.checklist.length * 100) : 0;
    return wrapModal(`
      <button class="icon-btn close" data-act="close-modal" aria-label="Close">✕</button>
      ${c.coverImageId ? `<img class="modal-cover" data-image-id="${esc(c.coverImageId)}" alt="Card cover" draggable="false">` : ''}
      ${c.archived ? `<div class="banner">This card is archived. <button class="link" data-act="restore-card">Restore</button></div>` : ''}
      <div class="m-title-row"><input class="m-title" data-f="title" value="${esc(c.title)}" maxlength="500" aria-label="Card title">
        <div class="emoji-tools"><button class="btn sm emoji-trigger" data-act="toggle-emoji" aria-label="Add emoji" aria-expanded="${ui.emojiOpen}" title="Add emoji">😀</button>
          <div class="emoji-picker" ${ui.emojiOpen ? '' : 'hidden'} aria-label="Select emoji">${EMOJIS.map(emoji => `<button type="button" class="emoji-choice" data-act="insert-emoji" data-emoji="${emoji}" aria-label="Insert ${emoji}">${emoji}</button>`).join('')}</div>
        </div>
      </div>
      <p class="muted">In list <strong>${esc(list.name)}</strong></p>
      <div class="m-grid">
        <div class="m-main">
          <details class="modal-section appearance-section">
            <summary>Card appearance</summary>
            ${themeEditor(c.theme, 'card-theme', c.id, 'reset-card-theme')}
            <label>Cover image<select data-f="cover-image" aria-label="Cover image"><option value="">No cover</option>${(m.images || []).filter(isImage).map(image => `<option value="${esc(image.id)}" ${c.coverImageId === image.id ? 'selected' : ''}>${esc(image.name)}</option>`).join('')}</select></label>
          </details>
          <h4>Labels</h4>
          <div class="chips">${b.labels.map(l => `<button class="chip ${c.labels.includes(l.id) ? 'on' : ''}" style="--c:${l.color}" data-act="toggle-label" data-lid="${l.id}" aria-pressed="${c.labels.includes(l.id)}">${esc(l.name) || '&nbsp;'}</button>`).join('')}
            <button class="chip add" data-act="edit-labels">✎ Edit</button></div>
          <!-- Repeat task is temporarily unavailable; existing recurrence settings remain unchanged.
          <label class="recurrence-row">Repeat task<select data-f="recurrence"><option value="" ${!c.recurrence ? 'selected' : ''}>Does not repeat</option><option value="daily" ${c.recurrence === 'daily' ? 'selected' : ''}>Every day</option><option value="weekly" ${c.recurrence === 'weekly' ? 'selected' : ''}>Every week</option><option value="monthly" ${c.recurrence === 'monthly' ? 'selected' : ''}>Every month</option></select></label> -->
          <section class="description-section" aria-label="Card description">
            <div class="description-heading"><h4>Description</h4>${descriptionDraft?.cardId === c.id && descriptionDraft.boardId === b.id ? '' : '<button class="btn sm" data-act="edit-description">Edit description</button>'}</div>
            ${descriptionDraft?.cardId === c.id && descriptionDraft.boardId === b.id ? descriptionEditor(c, m.images) : `<div class="description-view markdown-body" data-act="edit-description" aria-label="Description">${c.desc ? descriptionHTML(c, m.images) : '<p class="muted">Add a more detailed description...</p>'}</div>`}
          </section>
          <section class="card-images" aria-label="Attachments">
            <h4>Attachments</h4>
            <div class="image-source-actions">
              <button type="button" class="btn" data-act="choose-attachments">Add from device</button>
              <button type="button" class="btn" data-act="add-image-url">Add from web</button>
              <input type="file" class="image-files" multiple aria-label="Add attachments from device">
            </div>
            <p class="muted image-source-note">Attachments are saved in this browser. Images are optimized; other files keep their original format.</p>
            <p class="image-status" role="status"></p>
            <div class="image-attachments">${(c.imageIds || []).map((id, i) => {
              const image = m.images?.find(image => image.id === id);
              return `<article class="image-attachment">
                ${isImage(image) ? `<img data-image-id="${esc(id)}" alt="${esc(image.name)}" draggable="false">` : '<span class="file-thumbnail" aria-hidden="true">FILE</span>'}
                <div><strong>${esc(image?.name || `Attachment ${i + 1}`)}</strong>${image ? `<small>${isImage(image) ? `${image.width} × ${image.height} · ` : 'gzip · '}${Math.ceil(image.size / 1024)} KB stored${image.kind === 'file' ? ` · ${Math.ceil(image.originalSize / 1024)} KB original` : ''}</small>` : ''}
                ${isImage(image) ? c.coverImageId === id ? '<span class="badge">Cover</span>' : `<button class="link" data-act="set-cover" data-image-id="${esc(id)}">Make cover</button>` : ''}
                <button class="icon-btn" data-act="image-menu" data-image-id="${esc(id)}" aria-label="Attachment options for ${esc(image?.name || `Attachment ${i + 1}`)}">⋯</button></div>
              </article>`;
            }).join('')}</div>
          </section>
          <h4>Checklist ${c.checklist.length ? `<span>· ${pct}%</span>` : ''}</h4>
          ${c.checklist.length ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
          <ul class="checklist">${c.checklist.map(i => `<li>
            <input type="checkbox" data-f="check-done" data-iid="${i.id}" ${i.done ? 'checked' : ''} aria-label="Done">
            <input class="ci-text ${i.done ? 'done' : ''}" data-f="check-text" data-iid="${i.id}" value="${esc(i.text)}" aria-label="Item">
            <button class="icon-btn" data-act="del-check" data-iid="${i.id}" aria-label="Delete item">✕</button></li>`).join('')}</ul>
          <div class="add-check"><input type="text" class="field" placeholder="Add an item…" maxlength="200" aria-label="New item"><button class="btn" data-act="add-check">Add</button></div>
          <h4>Personal comments · ${c.comments.length}</h4>
          <div class="comments">${c.comments.map(x => `<article class="comment"><div>${esc(x.text)}</div><small>${new Date(x.created).toLocaleString('en-US')}</small><button class="link" data-act="del-comment" data-cid="${x.id}">Delete</button></article>`).join('') || '<p class="muted">No comments yet.</p>'}</div>
          <div class="add-comment"><textarea class="field" maxlength="2000" rows="2" placeholder="Write a note or comment…" aria-label="New comment"></textarea><button class="btn primary" data-act="add-comment">Add comment</button></div>
        </div>
        <aside class="m-side">
          <label class="card-priority">Priority<select data-f="priority" aria-label="Priority">${PRIORITIES.map(p => `<option value="${p.value}" ${c.priority === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
          <details class="modal-section due-date-section" ${m.dueOpen ? 'open' : ''}>
            <summary>Status &amp; due date${c.completed ? '<span class="completion-status">Completed</span>' : ''}</summary>
            <label class="check card-completion"><input type="checkbox" data-f="completed" ${c.completed ? 'checked' : ''}> Mark as complete</label>
            <label class="due-date-label" for="card-due-date">Due date (optional)</label>
            <input id="card-due-date" type="date" data-f="due" value="${c.due}" aria-label="Due date">
            ${c.due ? '<div class="due-date-actions"><button class="btn sm" data-act="clear-due">Remove</button></div>' : ''}
          </details>
          <h4>Move to</h4>
          <select data-f="move" aria-label="Move to list">${b.lists.map(l => `<option value="${l.id}" ${l.id === list.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
          <h4>Actions</h4>
          <button class="btn block" data-act="dup-card">⎘ Duplicate</button>
          <button class="btn block" data-act="save-template">☆ Save as template</button>
          ${c.archived ? '' : '<button class="btn block" data-act="archive-card">🗄 Archive</button>'}
          <button class="btn block danger" data-act="del-card">🗑 Delete</button>
        </aside>
      </div>`);
  }

  function labelsModal(b) {
    return wrapModal(`<h3>Board labels</h3>
      ${b.labels.map(l => `<div class="label-row">
        <input type="color" value="${l.color}" data-f="label-color" data-lid="${l.id}" aria-label="Color">
        <input type="text" value="${esc(l.name)}" placeholder="Name (optional)" maxlength="60" data-f="label-name" data-lid="${l.id}" aria-label="Label name">
        <button class="icon-btn" data-act="del-label" data-lid="${l.id}" aria-label="Delete label">🗑</button></div>`).join('')}
      <button class="btn" data-act="add-label">＋ New label</button>
      <div class="actions"><button class="btn primary" data-act="close-modal">Done</button></div>`, 'narrow');
  }

  function archiveModal(b) {
    return wrapModal(`<h3>Archived cards</h3><div class="archive-window"></div>
      <div class="actions"><button class="btn primary" data-act="close-modal">Close</button></div>`, 'narrow');
  }

  function statisticsModal(b, m) {
    const stats = m.stats;
    const metrics = [
      ['Cards', 'cards', stats.cards], ['Overdue', 'overdue', stats.overdue],
      ['With due date', 'with-due', stats.withDue], ['Completed', 'completed', stats.completed],
      ['Checklists', 'checklists', `${stats.checklists}%`]
    ];
    const rows = (items, type) => {
      const max = items.reduce((largest, item) => Math.max(largest, item.count), 1);
      return items.map(item => {
        const color = /^#[\da-f]{6}$/i.test(item.color) ? item.color : '';
        return `<div class="stats-row" data-stat-row="${type}"><span>${color ? `<i class="stats-label-color" style="background:${color}" aria-hidden="true"></i>` : ''}${esc(item.label)}</span><div class="stats-track" aria-hidden="true"><i class="${item.priority ? `priority-${item.priority}` : ''}" style="width:${item.count / max * 100}%;${color ? `background:${color}` : ''}"></i></div><strong>${item.count}</strong></div>`;
      }).join('');
    };
    return wrapModal(`<button class="icon-btn close" data-act="close-modal" aria-label="Close">✕</button>
      <h3>Statistics · ${esc(b.name)}</h3>
      <p class="stats-intro">A snapshot of active cards on this board. Archived cards are not included.</p>
      <div class="stats-summary">${metrics.map(([label, key, value]) => `<div class="stats-metric"><strong data-stat="${key}">${value}</strong><span>${label}</span></div>`).join('')}</div>
      <div class="stats-grid">
        <section class="stats-section"><h4>Cards by list</h4>${stats.lists.length ? rows(stats.lists, 'list') : '<p class="muted">No lists yet.</p>'}</section>
        <section class="stats-section"><h4>By due date</h4><p>Completed cards are counted separately.</p>${rows(stats.due, 'due')}</section>
        <section class="stats-section"><h4>By label</h4><p>Cards with multiple labels are counted for each label.</p>${rows(stats.labels, 'label')}</section>
        <section class="stats-section"><h4>By priority</h4>${rows(stats.priorities, 'priority')}</section>
      </div>
      <div class="actions"><button class="btn primary" data-act="close-modal">Close</button></div>`, 'statistics-modal');
  }

  function boardMenuModal(b, m) {
    return wrapModal(`<button class="icon-btn close" data-act="close-modal" aria-label="Close">✕</button>
      <h3>Board menu</h3>
      <h4>Background</h4>${swatches(b.bg)}
      <div class="board-custom-bg"><label class="custom-color">Custom color<input type="color" data-f="board-bg" value="${b.bgColor || '#16875d'}"></label><button class="btn sm" data-act="clear-board-bg">Use default background</button></div>
      <h4>Board</h4>
      <button class="btn block" data-act="open-statistics">▥ Statistics</button>
      <button class="btn block" data-act="open-labels">🏷 Labels (${b.labels.length})</button>
      <button class="btn block" data-act="open-archive">🗄 Archived cards (${m.archivedCount})</button>
      <button class="btn block" data-act="open-templates">☆ Personal templates (${state.templates.length})</button>
      <button class="btn block" data-act="dup-board">⎘ Duplicate board</button>
      <button class="btn block" data-act="export-board">⬇ Export this board</button>
      <button class="btn block" data-act="drive-export-board">Save this board to Google Drive…</button>
      <button class="btn block danger" data-act="del-board">🗑 Delete board</button>
      <section class="keyboard-shortcuts" aria-labelledby="shortcuts-heading">
        <h4 id="shortcuts-heading">Keyboard shortcuts</h4>
        <p class="muted">Single-key shortcuts work on the board, outside text fields and dialogs. Card and list creation are available in board view.</p>
        <dl>${BOARD_SHORTCUTS.map(shortcut => `<div><dt><kbd>${esc(shortcut.key.toUpperCase())}</kbd></dt><dd>${esc(shortcut.label)}</dd></div>`).join('')}
          <div><dt><kbd>Enter</kbd></dt><dd>Open a focused card / submit a new card or list</dd></div>
          <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Focus the previous / next card in a list</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Cancel editing / close the active panel</dd></div>
          <div><dt><kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd></dt><dd>Save the description</dd></div>
          <div><dt><kbd>Ctrl/Cmd</kbd> + <kbd>B / I / K</kbd></dt><dd>Bold / italic / link in the description editor</dd></div>
        </dl>
      </section>`, '', 'drawer');
  }

  function listThemeModal(b, m) {
    const l = b.lists.find(x => x.id === m.id); if (!l) return '';
    return wrapModal(`<button class="icon-btn close" data-act="close-modal" aria-label="Close">✕</button><h3>Lane appearance</h3><p class="muted">"${esc(l.name)}"</p>${themeEditor(l.theme, 'lane-theme', l.id, 'reset-lane-theme')}<div class="actions"><button class="btn primary" data-act="close-modal">Done</button></div>`, 'narrow');
  }

  function templateHTML(t) {
    return `<div class="template-row" data-virtual-id="${t.id}" tabindex="0"><div><strong>${esc(t.title)}</strong><small>${esc(t.desc || 'No description')} · ${t.checklist.length} items</small></div><select data-template-list="${t.id}" aria-label="Destination list">${(cur()?.lists || []).map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><button class="btn sm primary" data-act="use-template" data-id="${t.id}">Add</button><button class="icon-btn" data-act="del-template" data-id="${t.id}" aria-label="Delete template">🗑</button></div>`;
  }
  function templatesModal() {
    return wrapModal(`<h3>Personal templates</h3>${state.templates.length ? '<div class="templates-window archive-window"></div>' : '<p class="muted">Save a card as a template from its details.</p>'}<div class="actions"><button class="btn primary" data-act="close-modal">Done</button></div>`, 'narrow');
  }

  function laneWipModal(board, modal) {
    const list = board.lists.find(list => list.id === modal.id);
    if (!list) return '';
    return wrapModal(`<h3>Set WIP limit</h3><p>${esc(list.name)}</p>
      <label for="lane-wip-limit">Maximum work in progress</label>
      <input id="lane-wip-limit" class="field" type="number" min="0" step="1" value="${list.wipLimit || 0}">
      <p class="muted">0 = unlimited. Only non-archived, incomplete cards count. Existing cards are kept if you lower the limit.</p>
      <div class="actions"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="save-lane-wip">Save WIP limit</button></div>`, 'narrow');
  }
  function moveLaneModal(board, modal) {
    const list = board.lists.find(list => list.id === modal.id);
    if (!list) return '';
    return wrapModal(`<h3>Move all cards</h3><p>Move non-archived cards from <strong>${esc(list.name)}</strong>, keeping their order. Archived cards stay in this list.</p>
      <label for="lane-move-target">Destination list</label>
      <select id="lane-move-target">${board.lists.filter(target => target !== list).map(target => `<option value="${esc(target.id)}">${esc(target.name)}</option>`).join('')}</select>
      <p class="muted">If the destination WIP limit is exceeded, no cards are moved.</p>
      <div class="actions"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" data-act="move-lane-cards">Move cards</button></div>`, 'narrow');
  }

  $('#modal-root').addEventListener('toggle', e => {
    if (e.target.isConnected && e.target.matches('.due-date-section') && ui.modal?.type === 'card') {
      ui.modal.dueOpen = e.target.open;
    }
  }, true);

  function renderModal() {
    const root = $('#modal-root');
    const prevScroll = $('.overlay', root)?.scrollTop || 0;
    const m = ui.modal, b = cur();
    let html = '';
    if (m) {
      if (m.type === 'newboard') html = newBoardModal();
      else if (b) html = ({ card: cardModal, labels: labelsModal, archive: archiveModal, statistics: statisticsModal, boardmenu: boardMenuModal, templates: templatesModal, listtheme: listThemeModal, lanewip: laneWipModal, movelane: moveLaneModal }[m.type])?.(b, m) || '';
    }
    if (!html) ui.modal = null;
    root.innerHTML = html;
    document.body.classList.toggle('modal-open', !!html);
    $('#app').inert = !!html;
    const ov = $('.overlay', root); if (ov) ov.scrollTop = prevScroll;
  }

  async function closeModal() {
    if (ui.modal?.type === 'card' && !await discardDescription()) return;
    if (saveT) save();
    const c = ctxCard();
    if (c && !c.card.title.trim()) { c.card.title = 'Untitled'; save(); }
    ui.modal = ui.modal?.prev || null;
    if (ui.modal?.type === 'boardmenu') ui.modal.archivedCount = await store.archivedCount(cur().id);
    render();
  }

  function appDialog(message, { confirmLabel = 'Confirm', value, maxLength, validate } = {}) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'modal narrow app-dialog';
      dialog.setAttribute('aria-labelledby', 'app-dialog-title');
      dialog.innerHTML = `<form method="dialog">
        <h3 id="app-dialog-title">${value === undefined ? 'Confirm action' : esc(message)}</h3>
        ${value === undefined ? `<p>${esc(message)}</p>` : `<label for="app-dialog-input">${esc(message)}</label><input id="app-dialog-input" type="text" maxlength="${maxLength}" value="${esc(value)}">`}
        <div class="actions"><button type="button" class="btn" value="cancel">Cancel</button><button class="btn primary" value="confirm">${esc(confirmLabel)}</button></div>
      </form>`;
      $('button[value="cancel"]', dialog).addEventListener('click', () => dialog.close());
      if (validate) {
        const input = $('#app-dialog-input', dialog);
        input.addEventListener('input', () => input.setCustomValidity(''));
        $('form', dialog).addEventListener('submit', event => {
          input.setCustomValidity(validate(input.value));
          if (!input.reportValidity()) event.preventDefault();
        });
      }
      dialog.addEventListener('click', event => event.stopPropagation());
      dialog.addEventListener('keydown', event => event.stopPropagation());
      dialog.addEventListener('close', () => {
        const result = dialog.returnValue === 'confirm' ? (value === undefined ? true : $('#app-dialog-input', dialog).value) : (value === undefined ? false : null);
        dialog.remove();
        if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
        resolve(result);
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
      const focus = value === undefined ? $('button[value="cancel"]', dialog) : $('#app-dialog-input', dialog);
      focus.focus();
      if (value !== undefined) focus.select();
    });
  }
  const confirmAction = (message, label = 'Delete') => appDialog(message, { confirmLabel: label });
  const promptAction = (message, value, maxLength) => appDialog(message, { confirmLabel: 'Save', value, maxLength });

  function attachmentURLDialog() {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'modal narrow app-dialog attachment-url-dialog';
      dialog.setAttribute('aria-labelledby', 'attachment-url-title');
      dialog.innerHTML = `<form method="dialog">
        <h3 id="attachment-url-title">Add attachment from web</h3>
        <label for="attachment-url-input">Attachment URL</label>
        <input id="attachment-url-input" class="field" type="text" inputmode="url" autocomplete="url" placeholder="https://..." aria-label="Attachment URL">
        <p class="muted image-url-note">The server must allow cross-origin requests (CORS). The file will be saved in this browser.</p>
        <div class="actions"><button type="button" class="btn" value="cancel">Cancel</button><button class="btn primary" value="confirm">Add attachment</button></div>
      </form>`;
      $('button[value="cancel"]', dialog).addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => event.stopPropagation());
      dialog.addEventListener('keydown', event => event.stopPropagation());
      dialog.addEventListener('close', () => {
        const result = dialog.returnValue === 'confirm' ? $('#attachment-url-input', dialog).value : null;
        dialog.remove();
        if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
        resolve(result);
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
      $('#attachment-url-input', dialog).focus();
    });
  }

  /* ---------------- Menús emergentes ---------------- */
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function openMenu(anchor, items) {
    closeMenu();
    const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
    items.forEach(it => {
      if (it.sep) { m.append(document.createElement('hr')); return; }
      const n = document.createElement(it.href ? 'a' : 'button');
      n.className = 'menu-item' + (it.danger ? ' danger' : ''); n.setAttribute('role', 'menuitem');
      if (it.href) n.href = it.href;
      n.textContent = it.label;
      n.addEventListener('click', e => { e.stopPropagation(); closeMenu(); if (it.fn) run(it.fn); });
      m.append(n);
    });
    document.body.append(m);
    const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    const left = Math.min(Math.max(8, r.left), innerWidth - mw - 8);
    let top = r.bottom + 4; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    menuEl = m;
    $('.menu-item', m)?.focus();
  }
  document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

  /* ---------------- Datos: exportar / importar ---------------- */
  function download(name, text) {
    const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function backupFilenameError(value) {
    const name = value.trim(), base = name.replace(/\.kanbaya$/i, '');
    if (!base || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      return 'Enter a valid filename without path separators or reserved characters.';
    }
    return '';
  }
  function backupFilename(value, extension) {
    const name = value.trim();
    return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
  }
  async function exportBoards(boards, name, includeTemplates = false) {
    const filename = await appDialog('Backup filename', {
      confirmLabel: 'Export', value: `${name || 'kanbaya'}-${todayStr()}.kanbaya`,
      maxLength: 200, validate: backupFilenameError
    });
    if (filename === null) return;
    await flush();
    const backup = await store.exportBackup(boards.map(b => b.id), includeTemplates);
    download(backupFilename(filename, backup.extension), backup.blob);
  }
  function mergeConflictDialog(board, conflicts) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'modal narrow app-dialog merge-conflict-dialog';
      dialog.setAttribute('aria-labelledby', 'merge-conflict-title');
      dialog.innerHTML = `<form method="dialog">
        <h3 id="merge-conflict-title">Conflicts in ${esc(board.name)}</h3>
        <p>Both versions contain different changes to this board. Choose which version takes precedence for conflicting board settings, lists and whole cards, including their attachments and lane positions. Items present in only one version are kept.</p>
        <ul class="merge-conflicts">${conflicts.slice(0, 30).map(conflict => `<li>${esc(conflict)}</li>`).join('')}</ul>
        ${conflicts.length > 30 ? `<p>And ${conflicts.length - 30} more conflicts.</p>` : ''}
        <div class="actions"><button value="cancel" class="btn">Cancel import</button><button value="local" class="btn">Keep local version</button><button value="backup" class="btn primary">Use backup version</button></div>
      </form>`;
      dialog.addEventListener('click', event => event.stopPropagation());
      dialog.addEventListener('keydown', event => event.stopPropagation());
      dialog.addEventListener('close', () => {
        const result = ['local', 'backup'].includes(dialog.returnValue) ? dialog.returnValue : null;
        dialog.remove();
        if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
        resolve(result);
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
      $('button[value="cancel"]', dialog).focus();
    });
  }
  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const without = (value, ...keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const differentFields = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => !sameValue(a[key], b[key]));
  function matchingOrder(a, b) {
    const aIds = new Set(a.map(item => item.id)), bIds = new Set(b.map(item => item.id));
    return sameValue(a.filter(item => bIds.has(item.id)).map(item => item.id), b.filter(item => aIds.has(item.id)).map(item => item.id));
  }
  function boardConflicts(local, backup) {
    const conflicts = [];
    const fields = differentFields(without(local, 'lists', 'labels'), without(backup, 'lists', 'labels'));
    if (fields.length) conflicts.push(`Board settings: ${fields.join(', ')}.`);
    if (!matchingOrder(local.labels, backup.labels)) conflicts.push('Label order differs.');
    if (!matchingOrder(local.lists, backup.lists)) conflicts.push('Lane order differs.');
    const labels = new Map(local.labels.map(label => [label.id, label]));
    for (const label of backup.labels) {
      if (labels.has(label.id) && !sameValue(labels.get(label.id), label)) conflicts.push(`Label "${labels.get(label.id).name}" / "${label.name}" differs.`);
    }
    const lists = new Map(local.lists.map(list => [list.id, list]));
    const cards = new Map(local.lists.flatMap(list => list.cards.map(card => [card.id, { card, list }])));
    for (const list of backup.lists) {
      const other = lists.get(list.id);
      if (other) {
        const changed = differentFields(without(other, 'cards'), without(list, 'cards'));
        if (changed.length) conflicts.push(`Lane "${other.name}" / "${list.name}": ${changed.join(', ')}.`);
        if (!matchingOrder(other.cards, list.cards)) conflicts.push(`Card order in lane "${list.name}" differs.`);
      }
      for (const card of list.cards) {
        const found = cards.get(card.id);
        if (!found) continue;
        const changed = differentFields(found.card, card);
        if (found.list.id !== list.id) changed.push(`lane: "${found.list.name}" → "${list.name}"`);
        if (changed.length) conflicts.push(`Card "${found.card.title}" / "${card.title}": ${changed.join(', ')}.`);
      }
    }
    return conflicts;
  }
  function mergeBoard(preferred, other) {
    const merged = structuredClone(preferred);
    const labels = new Set(merged.labels.map(label => label.id));
    merged.labels.push(...other.labels.filter(label => !labels.has(label.id)));
    const lists = new Map(merged.lists.map(list => [list.id, list]));
    const cards = new Set(merged.lists.flatMap(list => list.cards.map(card => card.id)));
    for (const list of other.lists) {
      let target = lists.get(list.id);
      if (!target) {
        target = { ...structuredClone(list), cards: [] };
        merged.lists.push(target); lists.set(target.id, target);
      }
      for (const card of list.cards) {
        if (!cards.has(card.id)) { target.cards.push(structuredClone(card)); cards.add(card.id); }
      }
    }
    return merged;
  }
  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const apply = await prepareBackupImport(file);
      await run(async () => { await apply(); });
    } catch (error) { console.error('Kanbaya: import', error); toast('⚠ The file is not a valid Kanbaya backup'); }
  });
  async function prepareBackupImport(file) {
    const { data, images } = await store.parseBackup(file);
    const source = (Array.isArray(data?.boards) ? data.boards : data?.lists ? [data] : []).map(normBoard).filter(Boolean);
    const used = new Set(), boardIds = new Set();
    const imageMap = new Map(images.map(image => [image.id, image]));
    for (const board of source) {
      if (boardIds.has(board.id)) throw new Error('Duplicate board ID in backup.');
      boardIds.add(board.id);
      const listIds = new Set(), cardIds = new Set(), labelIds = new Set();
      for (const label of board.labels) {
        if (labelIds.has(label.id)) throw new Error('Duplicate label ID in backup.');
        labelIds.add(label.id);
      }
      for (const list of board.lists) {
        if (listIds.has(list.id)) throw new Error('Duplicate list ID in backup.');
        listIds.add(list.id);
        for (const card of list.cards) {
          if (cardIds.has(card.id)) throw new Error('Duplicate card ID in backup.');
          cardIds.add(card.id);
          for (const id of card.imageIds || []) {
            const image = imageMap.get(id);
            if (!image || used.has(id) || image.boardId !== board.id || image.cardId !== card.id) throw new Error('Invalid attachment reference in backup.');
            used.add(id);
          }
          if (card.coverImageId && !isImage(imageMap.get(card.coverImageId))) throw new Error('Invalid cover in backup.');
        }
      }
    }
    if (used.size !== images.length) throw new Error('The backup contains orphaned attachments.');
    if (!source.length) throw new Error('empty');
    return async () => {
      const localState = await store.exportState(source.map(board => board.id));
      const localBoards = new Map(localState.boards.map(board => [board.id, normBoard(board)]));
      const choices = new Map();
      for (const board of source) {
        const local = localBoards.get(board.id);
        const conflicts = local ? boardConflicts(local, board) : [];
        if (conflicts.length) {
          const choice = await mergeConflictDialog(board, conflicts);
          if (!choice) return false;
          choices.set(board.id, choice);
        }
      }
      if (!await discardDescription()) return false;
      for (const board of source) {
        const existing = boardById(board.id);
        if (existing) await store.hydrate(existing);
      }
      store.adopt(state);
      const staged = [];
      const result = [];
      for (const board of source) {
        const local = localBoards.get(board.id), useBackup = choices.get(board.id) === 'backup';
        const merged = local ? mergeBoard(useBackup ? board : local, useBackup ? local : board) : structuredClone(board);
        const localCards = new Set((local?.lists || []).flatMap(list => list.cards.map(card => card.id)));
        for (const list of merged.lists) for (const card of list.cards) {
          if (local && !useBackup && localCards.has(card.id)) continue;
          const ids = new Map();
          for (const id of card.imageIds || []) {
            const image = imageMap.get(id);
            if (!image || image.boardId !== board.id || image.cardId !== card.id) continue;
            const existing = await store.db.images.get(id);
            const nextId = existing && (existing.boardId !== board.id || existing.cardId !== card.id) ? crypto.randomUUID() : id;
            ids.set(id, nextId);
            staged.push({ ...image, id: nextId });
          }
          if (ids.size) {
            card.imageIds = card.imageIds.map(id => ids.get(id) || id);
            card.coverImageId = ids.get(card.coverImageId) || card.coverImageId;
            card.desc = KanbayaStore.remapDescription(card.desc, ids);
          }
        }
        result.push(merged);
      }
      ui.modal = null;
      mutate(() => {
        staged.forEach(image => store.stageImage(image));
        for (const board of result) {
          const index = state.boards.findIndex(existing => existing.id === board.id);
          if (index < 0) state.boards.push(board); else state.boards[index] = board;
        }
        if (Array.isArray(data.templates)) state.templates.push(...data.templates.map(t => ({ id: uid(), title: String(t.title || 'Template').slice(0, 100), desc: String(t.desc || ''), checklist: Array.isArray(t.checklist) ? t.checklist.map(x => String(x).slice(0, 200)) : [] })));
      }, `${result.length} board(s) imported`);
      return true;
    };
  }

  function driveBackupDialog(mode, board = null) {
    const drive = window.KanbayaDrive;
    const focusSelector = board ? '[data-act="board-menu"]' : '[data-act="data-menu"]';
    const previousFocus = $(focusSelector);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultName = `kanbaya-${board ? board.name.replace(/[^\w-]+/g, '_') + '-' : ''}${stamp}.kanbaya`;
    const dialog = document.createElement('dialog');
    dialog.className = 'modal narrow app-dialog drive-dialog';
    dialog.setAttribute('aria-labelledby', 'drive-title');
    dialog.innerHTML = `<h3 id="drive-title">${mode === 'save' ? (board ? 'Save this board to Google Drive' : 'Save backup to Google Drive') : 'Import backup from Google Drive'}</h3>
      <p class="muted">Manual backups only. Google receives a copy when you save; your local boards are not synchronized.</p>
      <button type="button" class="btn" data-drive="connect">Load Google sign-in</button>
      ${mode === 'save' ? `<p>${board ? `Save only the board <strong>${esc(board.name)}</strong> and its attachments. Other boards and personal templates are not included.` : 'Save all boards, templates and attachments.'} Each save creates a new backup in the Kanbaya Backups folder.</p><label for="drive-filename">Backup filename</label><input id="drive-filename" type="text" maxlength="200" value="${esc(defaultName)}"><div class="drive-actions"><button type="button" class="btn primary" data-drive="save" disabled>Save backup</button></div>`
        : '<p>Only backups created by Kanbaya through this integration are listed. Import merges boards with matching IDs and asks how to resolve conflicts.</p><label for="drive-backup">Backup</label><select id="drive-backup" disabled><option value="">Connect to list backups</option></select><div class="drive-actions"><button type="button" class="btn" data-drive="refresh" disabled>Refresh</button><button type="button" class="btn primary" data-drive="import" disabled>Import backup</button></div>'}
      <p class="drive-status" role="status" aria-live="polite"></p>
      <div class="actions"><button type="button" class="btn" data-drive="close">Close</button></div>`;
    const connect = $('[data-drive="connect"]', dialog), select = $('select', dialog), close = $('[data-drive="close"]', dialog);
    const filename = $('#drive-filename', dialog);
    const status = $('.drive-status', dialog);
    let busy = false, identityLoaded = false;
    function updateControls() {
      connect.disabled = busy;
      connect.textContent = identityLoaded ? 'Connect / change Google account' : 'Load Google sign-in';
      close.disabled = busy;
      if (filename) filename.disabled = busy;
      $$('[data-drive="save"], [data-drive="refresh"]', dialog).forEach(button => { button.disabled = busy || !drive.connected(); });
      if (select) {
        select.disabled = busy || !drive.connected();
        $('[data-drive="import"]', dialog).disabled = busy || !drive.connected() || !select.value;
      }
    }
    function message(text, error = false) {
      status.textContent = text;
      status.setAttribute('role', error ? 'alert' : 'status');
    }
    async function perform(task, text) {
      busy = true; updateControls(); message(text);
      try { await task(); }
      catch (error) { console.error('Kanbaya: Google Drive', error); message(error.message, true); }
      finally { busy = false; updateControls(); }
    }
    async function refreshFiles() {
      const files = await drive.list();
      select.replaceChildren(new Option(files.length ? 'Select a backup' : 'No Kanbaya backups found', ''));
      files.forEach(file => select.add(new Option(file.name, file.id)));
      message(files.length ? 'Select a backup to import.' : 'No backups found. Save a backup with Kanbaya first.');
    }
    async function prepareSignIn() {
      await drive.prepare();
      identityLoaded = true;
      if (drive.connected() && select) await refreshFiles();
      else message(drive.connected() ? 'Connected. Ready to save a backup.' : 'Connect your Google account to continue.');
    }
    connect.onclick = () => perform(async () => {
      if (!identityLoaded) { await prepareSignIn(); return; }
      if (select) select.replaceChildren(new Option('Connect to list backups', ''));
      await drive.connect();
      if (select) await refreshFiles();
      else message('Connected. Ready to save a backup.');
    }, 'Connecting to Google Drive...');
    $('[data-drive="save"]', dialog)?.addEventListener('click', () => {
      const error = backupFilenameError(filename.value);
      if (error) { message(error, true); filename.focus(); return; }
      perform(async () => {
        if (hasDescriptionChanges()) throw new Error('Save or cancel the description before creating a backup.');
        if (board && !boardById(board.id)) throw new Error('This board is no longer available. Close this dialog and select another board.');
        let backup;
        await run(async () => { backup = await store.exportBackup(board ? [board.id] : state.boards.map(board => board.id), !board); });
        if (!backup) throw new Error('Could not read the backup. Check the application error notification.');
        const name = backupFilename(filename.value, backup.extension);
        await drive.upload(backup, name);
        message(`Backup saved in Google Drive: ${name}`);
      }, 'Saving backup to Google Drive...');
    });
    $('[data-drive="refresh"]', dialog)?.addEventListener('click', () => perform(refreshFiles, 'Loading backups...'));
    $('[data-drive="import"]', dialog)?.addEventListener('click', () => perform(async () => {
      const file = await drive.download(select.value);
      const apply = await prepareBackupImport(file);
      let committed = false, cancelled = false;
      await run(async () => { if (await apply()) { await flush(); committed = true; } else cancelled = true; });
      if (cancelled) { message('Import cancelled.'); return; }
      if (!committed) throw new Error('The backup could not be imported. Check the application error notification.');
      message('Backup imported and merged with your local boards.');
    }, 'Downloading and importing backup...'));
    select?.addEventListener('change', updateControls);
    close.onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('click', event => event.stopPropagation());
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('close', () => {
      dialog.remove();
      const focus = previousFocus?.isConnected ? previousFocus : $(focusSelector);
      if (focus && !focus.closest('[inert]')) focus.focus({ preventScroll: true });
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    perform(prepareSignIn, 'Loading Google sign-in...');
  }

  /* ---------------- Acciones ---------------- */
  const A = {
    theme() { const o = ['auto', 'light', 'dark']; state.theme = o[(o.indexOf(state.theme) + 1) % 3]; save(); render(); },
    'boards-menu'(el) {
      const favorites = state.boards.filter(b => b.favorite);
      const others = state.boards.filter(b => !b.favorite);
      openMenu(el, [
        ...favorites.map(b => ({ label: `★ ${b.name}`, href: '#/b/' + b.id })),
        ...(favorites.length && others.length ? [{ sep: true }] : []),
        ...others.map(b => ({ label: b.name, href: '#/b/' + b.id })),
        ...(state.boards.length ? [{ sep: true }] : []),
        { label: 'View all boards', href: '#/' }
      ]);
    },
    'data-menu'(el) {
      openMenu(el, [
        { label: 'Export all boards (backup)', fn: () => exportBoards(state.boards, 'kanbaya', true) },
        { label: 'Import from file…', fn: () => $('#import-file').click() },
        { sep: true },
        { label: 'Save backup to Google Drive…', fn: () => driveBackupDialog('save') },
        { label: 'Import backup from Google Drive…', fn: () => driveBackupDialog('import') },
        { sep: true },
        { label: 'Delete all data', danger: true, fn: async () => { if (await confirmAction('Delete ALL boards from this browser? This action cannot be undone (export a backup first).')) { state.boards = []; save(); location.hash = '#/'; render(); } } }
      ]);
    },
    'new-board'() { ui.modal = { type: 'newboard' }; ui.focus = '.nb-name'; render(); },
    'create-board'() {
      const b = mkBoard($('.nb-name').value.trim() || 'New board', +($('input[name=bg]:checked')?.value || 0), $('.nb-lists').checked);
      state.boards.push(b); save(); ui.modal = null; location.hash = '#/b/' + b.id; render();
    },
    'toggle-favorite'(el) {
      const b = el.dataset.id ? boardById(el.dataset.id) : cur();
      if (!b) return;
      b.favorite = !b.favorite; save(); render();
    },
    async 'board-menu'() {
      const archivedCount = await store.archivedCount(cur().id);
      ui.modal = { type: 'boardmenu', archivedCount }; render();
    },
    async 'open-statistics'() {
      const b = cur(); if (!b) return;
      const stats = await store.statistics(b);
      if (cur()?.id !== b.id) return;
      ui.modal = { type: 'statistics', stats }; render();
    },
    'open-labels'() { ui.modal = { type: 'labels', prev: ui.modal }; render(); },
    'open-archive'() { ui.modal = { type: 'archive', prev: ui.modal }; render(); },
    'open-templates'() { ui.modal = { type: 'templates', prev: ui.modal }; render(); },
    'toggle-view'() { ui.view = ui.view === 'board' ? 'calendar' : 'board'; render(); },
    'month-prev'() { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() - 1, 1); render(); },
    'month-next'() { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + 1, 1); render(); },
    'month-today'() { const d = new Date(); ui.month = new Date(d.getFullYear(), d.getMonth(), 1); render(); },
    'toggle-filters'() { ui.filterOpen = !ui.filterOpen; if (ui.filterOpen) ui.focus = '.filter-keyword'; render(); },
    'search-cards'() { ui.filterOpen = true; ui.focus = '.filter-keyword'; render(); },
    'close-filters'() { ui.filterOpen = false; render(); },
    'clear-filters'() { ui.q = ''; ui.filters = { status: [], due: [], labels: [] }; render(); },
    'clear-board-bg'() { cur().bgColor = ''; save(); render(); },
    'reset-card-theme'() { const c = ctxCard()?.card; if (c) { c.theme = ''; save(); render(); } },
    'reset-lane-theme'(el) { const l = cur()?.lists.find(x => x.id === el.dataset.id); if (l) { l.theme = ''; save(); render(); } },
    async 'dup-board'() {
      const b = cur(); const c = reid(b); c.name = b.name + ' (copy)';
      await copyBoardImages(b, c);
      state.boards.push(c); save(); ui.modal = null; location.hash = '#/b/' + c.id; render();
    },
    'export-board'() { const b = cur(); return exportBoards([b], b.name.replace(/[^\w-]+/g, '_')); },
    'drive-export-board'() {
      const b = cur();
      if (!b) { toast('This board is no longer available.'); return; }
      ui.modal = null; render(); driveBackupDialog('save', b);
    },
    async 'del-board'() {
      const b = cur();
      if (!await confirmAction(`Delete the board "${b.name}" and all its contents?`)) return;
      state.boards = state.boards.filter(x => x.id !== b.id); save(); ui.modal = null; location.hash = '#/'; render();
    },
    'close-modal'(el, e) { if (el.classList.contains('overlay') && e.target !== el) return; return closeModal(); },

    /* listas */
    'add-list'() { ui.addingList = true; ui.focus = '.add-list input'; render(); },
    'cancel-list'() { ui.addingList = false; render(); },
    'save-list'() {
      const inp = $('.add-list input'); const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      cur().lists.push(mkList(v)); save(); ui.focus = '.add-list input'; ui.scrollRight = true; render();
    },
    'edit-list-title'(el) {
      const list = cur().lists.find(l => l.id === el.closest('.list').dataset.id);
      const inp = document.createElement('input'); inp.className = 'list-title-input'; inp.value = list.name; inp.maxLength = 100;
      el.replaceWith(inp); inp.focus(); inp.select();
      inp.addEventListener('blur', () => run(() => {
        if (!inp.dataset.cancel) { const v = inp.value.trim(); if (v && v !== list.name) { list.name = v; save(); } }
        const h = document.createElement('h3'); h.className = 'list-title'; h.dataset.act = 'edit-list-title'; h.title = 'Click to rename'; h.textContent = list.name;
        inp.replaceWith(h);
      }), { once: true });
    },
    'expand-list'(el) {
      const list = cur()?.lists.find(list => list.id === el.dataset.id);
      if (list) mutate(() => { list.collapsed = false; }, 'List expanded');
    },
    'save-lane-wip'() {
      const list = cur()?.lists.find(list => list.id === ui.modal?.id);
      const input = $('#lane-wip-limit'), value = input?.value.trim();
      if (!list || value === undefined) return;
      const limit = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit)) {
        toast('Enter a non-negative whole number. Use 0 for unlimited.'); input.focus(); return;
      }
      ui.modal = null;
      mutate(() => { list.wipLimit = limit; }, 'WIP limit updated');
    },
    async 'move-lane-cards'() {
      const board = cur(), source = board?.lists.find(list => list.id === ui.modal?.id);
      const target = board?.lists.find(list => list.id === $('#lane-move-target')?.value);
      if (!source || !target || source === target) { toast('Choose another destination list.'); return; }
      await store.hydrate(board); store.adopt(state);
      const moving = source.cards.filter(card => !card.archived);
      if (!moving.length) { toast('This list has no non-archived cards to move.'); return; }
      let position = await store.positionBefore(board.id, target.id, null);
      ui.modal = null;
      mutate(() => {
        source.cards = source.cards.filter(card => card.archived);
        for (const card of moving) {
          card._pos = position; position += 1024;
          card.listId = target.id; card._positioned = true;
          target.cards.push(card);
        }
      }, `${moving.length} card(s) moved`);
    },
    'list-menu'(el) {
      const b = cur(), l = b.lists.find(x => x.id === el.closest('.list').dataset.id), i = b.lists.indexOf(l);
      const sortBy = (label, cmp) => ({ label, fn: async () => {
        await store.hydrate(b); store.adopt(state);
        mutate(() => {
        l.cards.sort(cmp); l.cards.forEach((c, i) => { c._pos = i * 1024; });
        });
      } });
      const byDue = (x, y) => (x.due || '9999') < (y.due || '9999') ? -1 : (x.due || '9999') > (y.due || '9999') ? 1 : 0;
      openMenu(el, [
        { label: 'Add card', fn: () => A['add-card'](el) },
        { label: l.collapsed ? 'Expand list' : 'Collapse list', fn: () => mutate(() => {
          l.collapsed = !l.collapsed; if (ui.composer === l.id) ui.composer = null;
        }, l.collapsed ? 'List expanded' : 'List collapsed') },
        { label: 'Set WIP limit...', fn: () => { ui.modal = { type: 'lanewip', id: l.id }; ui.focus = '#lane-wip-limit'; render(); } },
        { label: '🎨 Lane appearance', fn: () => { ui.modal = { type: 'listtheme', id: l.id }; render(); } },
        { sep: true },
        ...(i > 0 ? [{ label: '← Move left', fn: () => mutate(() => { b.lists.splice(i, 1); b.lists.splice(i - 1, 0, l); }) }] : []),
        ...(i < b.lists.length - 1 ? [{ label: 'Move right →', fn: () => mutate(() => { b.lists.splice(i, 1); b.lists.splice(i + 1, 0, l); }) }] : []),
        { label: 'Duplicate list', fn: async () => {
          await store.hydrate(b); store.adopt(state);
          const copy = { ...structuredClone(l), id: uid(), name: `${l.name} (copy)`.slice(0, 100), cards: [] };
          delete copy._pos; delete copy.position; delete copy.cardCount; delete copy.wipCount;
          for (const card of l.cards) {
            const duplicate = await duplicateCard(card, b.id);
            duplicate.listId = copy.id;
            copy.cards.push(duplicate);
          }
          mutate(() => { b.lists.splice(i + 1, 0, copy); }, 'List duplicated');
        } },
        { label: 'Move all cards to...', fn: () => {
          if (b.lists.length < 2) { toast('Create another list before moving cards.'); return; }
          ui.modal = { type: 'movelane', id: l.id }; render();
        } },
        { sep: true },
        sortBy('Sort by name (A→Z)', (x, y) => x.title.localeCompare(y.title, 'en')),
        sortBy('Sort by due date', byDue),
        sortBy('Sort by priority', (x, y) => PRIORITIES.findIndex(p => p.value === y.priority) - PRIORITIES.findIndex(p => p.value === x.priority)),
        sortBy('Sort by newest', (x, y) => y.created - x.created),
        { sep: true },
        { label: 'Archive all cards', fn: async () => {
          if (!l.cardCount) return;
          await store.hydrate(b); store.adopt(state);
          mutate(() => l.cards.forEach(c => { c.archived = true; }), 'Cards archived');
        } },
        { label: 'Delete list', danger: true, fn: async () => { if (await confirmAction(`Delete the list "${l.name}" and its cards?`)) mutate(() => { b.lists.splice(i, 1); }, `List "${l.name}" deleted`); } }
      ]);
    },

    /* tarjetas */
    'edit-description'() {
      const context = ctxCard();
      if (!context) return;
      descriptionDraft = { boardId: context.b.id, cardId: context.card.id, original: context.card.desc, text: context.card.desc, preview: false };
      ui.focus = '[data-f="desc"]';
      render();
    },
    'save-description'() {
      const context = ctxCard();
      if (!context || descriptionDraft?.cardId !== context.card.id || descriptionDraft.boardId !== context.b.id) return;
      const text = descriptionDraft.text;
      context.card.desc = text;
      save();
      descriptionDraft = null;
      ui.focus = '[data-act="edit-description"]';
      render();
    },
    async 'cancel-description'() {
      if (!await discardDescription()) return;
      ui.focus = '[data-act="edit-description"]';
      render();
    },
    'preview-description'() {
      if (!descriptionDraft) return;
      descriptionDraft.preview = !descriptionDraft.preview;
      descriptionDraft.imagePicker = false;
      if (!descriptionDraft.preview) ui.focus = '[data-f="desc"]';
      render();
    },
    'toggle-description-images'() {
      if (!descriptionDraft || descriptionDraft.preview) return;
      descriptionDraft.imagePicker = !descriptionDraft.imagePicker;
      ui.focus = descriptionDraft.imagePicker ? '.description-picker [data-act="insert-description-image"], .description-picker [data-act="toggle-description-images"]' : '[data-act="toggle-description-images"]';
      render();
    },
    'format-description'(el) {
      const textarea = $('[data-f="desc"]');
      if (!descriptionDraft || !textarea || descriptionDraft.preview) return;
      const { start = textarea.value.length, end = start } = descriptionDraft.selection || {};
      const selected = textarea.value.slice(start, end);
      const wrappers = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], code: ['`', '`'], link: ['[', '](https://example.com)'], codeblock: ['\n```\n', '\n```\n'] };
      const prefixes = { heading: '## ', ul: '- ', ol: '1. ', task: '- [ ] ', quote: '> ' };
      let text, offset = 0, length = 0;
      if (wrappers[el.dataset.format]) {
        const [before, after] = wrappers[el.dataset.format], content = selected || 'text';
        text = before + content + after; offset = before.length; length = content.length;
      } else if (prefixes[el.dataset.format]) {
        const prefix = prefixes[el.dataset.format];
        text = (start && textarea.value[start - 1] !== '\n' ? '\n' : '') + (selected || 'text').split('\n').map(line => prefix + line).join('\n');
        offset = text.length; length = 0;
      } else {
        text = el.dataset.format === 'table' ? '\n\n| Column | Value |\n| --- | --- |\n| Item | Text |\n\n' : '\n\n---\n\n';
        offset = text.length;
      }
      textarea.setRangeText(text, start, end, 'select');
      textarea.focus();
      textarea.setSelectionRange(start + offset, start + offset + length);
      descriptionDraft.text = textarea.value;
      rememberEmojiTarget(textarea);
    },
    'insert-description-image'(el) {
      const context = ctxCard(), id = el.dataset.imageId;
      const image = ui.modal?.images?.find(item => item.id === id);
      if (!context?.card.imageIds?.includes(id) || !isImage(image)) {
        toast('Choose an image attached to this card.'); return;
      }
      const textarea = $('[data-f="desc"]');
      if (!descriptionDraft || !textarea) return;
      const selection = descriptionDraft.selection || { start: textarea.value.length, end: textarea.value.length };
      const name = String(image.name || 'Image').replace(/[\[\]\r\n]/g, ' ');
      const token = `![${name}](attachment:${id})`;
      textarea.setRangeText(token, Math.min(selection.start, textarea.value.length), Math.min(selection.end, textarea.value.length), 'end');
      descriptionDraft.text = textarea.value;
      descriptionDraft.imagePicker = false;
      $('.description-picker').hidden = true;
      $('[aria-controls="description-image-picker"]').setAttribute('aria-expanded', 'false');
      updateDescriptionPreview();
      textarea.focus();
      rememberEmojiTarget(textarea);
    },
    'image-menu'(el) {
      const context = ctxCard(), id = el.dataset.imageId;
      if (!context?.card.imageIds?.includes(id)) return;
      const attachment = ui.modal.images?.find(item => item.id === id);
      openMenu(el, [
        { label: 'Edit name', fn: async () => {
          const image = await store.db.images.get(id);
          if (!image) throw new Error('The attachment no longer exists.');
          const name = await promptAction('Attachment name', image.name, 200);
          if (!name?.trim()) return;
          mutate(() => {
            const renamed = { ...image, name: name.trim().slice(0, 200) };
            store.stageImage(renamed);
            ui.modal.images = ui.modal.images.map(item => item.id === id ? { ...item, name: renamed.name } : item);
          }, 'Attachment renamed');
        } },
        { label: 'Download', fn: async () => {
          const image = await store.db.images.get(id);
          if (!image) throw new Error('The attachment no longer exists.');
          const extension = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[image.mime];
          try {
            const blob = await KanbayaStore.attachmentBlob(image);
            download(isImage(image) ? `${(image.name || 'Image').replace(/\.[^.]+$/, '')}.${extension}` : image.name || 'Attachment', blob);
          } catch (error) {
            console.error('Kanbaya: attachment download', error);
            toast(`Could not download attachment: ${error.message}`);
          }
        } },
        ...(isImage(attachment) ? [{ label: context.card.coverImageId === id ? 'Remove cover' : 'Make cover', fn: () => mutate(() => {
          context.card.coverImageId = context.card.coverImageId === id ? null : id;
        }, 'Cover changed') }] : []),
        { sep: true },
        { label: 'Delete attachment', danger: true, fn: () => A['delete-image'](el) }
      ]);
    },
    async 'add-image-url'() {
      const context = ctxCard();
      if (!context) return;
      const value = await attachmentURLDialog();
      if (value === null) return;
      try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS attachment URL.');
        const status = $('.image-status');
        if (status) status.textContent = 'Downloading attachment...';
        const response = await fetch(url.href, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`The attachment server returned HTTP ${response.status}.`);
        const blob = await response.blob();
        const name = decodeURIComponent(url.pathname.split('/').pop() || 'Attachment');
        await addAttachments([new File([blob], name, { type: blob.type })], context);
      } catch (error) {
        console.error('Kanbaya: image URL', error);
        toast(`Could not download attachment. Check the URL, connection and CORS permissions. ${error.message}`);
      } finally { const status = $('.image-status'); if (status) status.textContent = ''; }
    },
    'set-cover'(el) {
      const c = ctxCard()?.card;
      if (!c?.imageIds?.includes(el.dataset.imageId) || !isImage(ui.modal.images?.find(image => image.id === el.dataset.imageId))) return;
      mutate(() => { c.coverImageId = el.dataset.imageId; }, 'Cover changed');
    },
    async 'delete-image'(el) {
      const c = ctxCard()?.card, id = el.dataset.imageId;
      if (!c?.imageIds?.includes(id) || !await confirmAction('Delete this attachment? Images inserted in the description will also be removed.')) return;
      mutate(() => {
        c.imageIds = c.imageIds.filter(imageId => imageId !== id);
        if (c.coverImageId === id) c.coverImageId = ui.modal.images?.find(image => image.id !== id && isImage(image))?.id || null;
        c.desc = c.desc.replace(descriptionImagePattern, (match, name, imageId) => imageId === id ? '' : match);
        if (descriptionDraft?.cardId === c.id) {
          descriptionDraft.text = descriptionDraft.text.replace(descriptionImagePattern, (match, name, imageId) => imageId === id ? '' : match);
          descriptionDraft.original = c.desc;
        }
        ui.modal.images = ui.modal.images?.filter(image => image.id !== id);
      }, 'Attachment deleted');
    },
    'add-card'(el) {
      const list = cur()?.lists.find(list => list.id === el.closest('.list')?.dataset.id);
      if (!list) return;
      if (list.collapsed) { list.collapsed = false; save(); }
      ui.composer = list.id; ui.focus = '.composer textarea'; render();
    },
    'cancel-card'() { ui.composer = null; render(); },
    'save-card'() {
      const ta = $('.composer textarea'); if (!ta) return;
      const titles = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!titles.length) { ta.focus(); return; }
      const l = cur().lists.find(x => x.id === ui.composer); if (!l) return;
      titles.forEach(t => l.cards.push(mkCard(t.slice(0, 500))));
      save(); ui.focus = '.composer textarea'; ui.scrollBottom = l.id; render();
    },
    'open-card'(el) { ui.modal = { type: 'card', id: el.dataset.id }; ui.emojiOpen = false; ui.emojiTarget = null; render(); },
    'toggle-emoji'() {
      ui.emojiOpen = !ui.emojiOpen;
      $('.emoji-picker')?.toggleAttribute('hidden', !ui.emojiOpen);
      $('.emoji-trigger')?.setAttribute('aria-expanded', String(ui.emojiOpen));
    },
    'insert-emoji'(el) { insertEmoji(el.dataset.emoji); },
    'toggle-label'(el) {
      const c = ctxCard()?.card; if (!c) return; const id = el.dataset.lid;
      c.labels = c.labels.includes(id) ? c.labels.filter(x => x !== id) : [...c.labels, id]; save(); render();
    },
    'edit-labels'() { ui.modal = { type: 'labels', prev: ui.modal }; render(); },
    'clear-due'() { const c = ctxCard()?.card; if (!c) return; c.due = ''; c.dueDone = false; save(); render(); },
    'add-check'() {
      const inp = $('.add-check input'); const c = ctxCard()?.card; if (!c || !inp) return;
      const v = inp.value.trim(); if (!v) { inp.focus(); return; }
      c.checklist.push({ id: uid(), text: v, done: false }); save(); ui.focus = '.add-check input'; render();
    },
    'del-check'(el) { const c = ctxCard()?.card; if (!c) return; c.checklist = c.checklist.filter(i => i.id !== el.dataset.iid); save(); render(); },
    'add-comment'() {
      const input = $('.add-comment textarea'), c = ctxCard()?.card;
      if (!input || !c || !input.value.trim()) { input?.focus(); return; }
      c.comments.push({ id: uid(), text: input.value.trim().slice(0, 2000), created: Date.now() }); save(); render();
    },
    async 'del-comment'(el) {
      const c = ctxCard()?.card; if (!c) return;
      if (!await confirmAction('Delete this comment?')) return;
      c.comments = c.comments.filter(x => x.id !== el.dataset.cid); save(); render();
    },
    async 'save-template'() {
      const c = ctxCard()?.card; if (!c) return;
      const name = await promptAction('Template name', c.title, 100);
      if (!name?.trim()) return;
      state.templates.push({ id: uid(), title: name.trim().slice(0, 100), desc: c.desc.replace(descriptionImagePattern, (match, label) => label), checklist: c.checklist.map(i => i.text) });
      save(); toast(c.imageIds?.length ? 'Personal template saved (attachments are not included)' : 'Personal template saved');
    },
    'use-template'(el) {
      const t = state.templates.find(x => x.id === el.dataset.id), listId = $(`[data-template-list="${el.dataset.id}"]`)?.value;
      const list = cur()?.lists.find(x => x.id === listId); if (!t || !list) return;
      const c = mkCard(t.title); c.desc = t.desc; c.checklist = t.checklist.map(text => ({ id: uid(), text, done: false }));
      list.cards.push(c); save(); ui.modal = null; render(); toast('Card created from template');
    },
    async 'del-template'(el) {
      if (!await confirmAction('Delete this personal template?')) return;
      state.templates = state.templates.filter(x => x.id !== el.dataset.id); save(); render();
    },
    async 'dup-card'() {
      const x = ctxCard(); if (!x) return;
      const copy = await duplicateCard(x.card, x.b.id); copy.title += ' (copy)';
      const next = await store.db.cards.where('[boardId+listId+position]').between([x.b.id, x.list.id, x.card._pos], [x.b.id, x.list.id, Dexie.maxKey], false, true).first();
      copy._pos = await store.positionBefore(x.b.id, x.list.id, next?.id, copy.id);
      copy._positioned = true;
      x.list.cards.splice(x.list.cards.indexOf(x.card) + 1, 0, copy); save(); ui.modal = null; render(); toast('Card duplicated');
    },
    'archive-card'() { const x = ctxCard(); if (!x) return; ui.modal = null; mutate(() => { x.card.archived = true; }, 'Card archived'); },
    'restore-card'(el) {
      const b = cur(); const id = el.dataset.id || ui.modal?.id; const f = b && findCard(b, id); if (!f) return;
      f.card.archived = false; save(); render();
    },
    async 'purge-card'(el) { const b = cur(); const f = findCard(b, el.dataset.id); if (!f) return; if (!await confirmAction(`Permanently delete "${f.card.title}"?`)) return; mutate(() => { f.list.cards = f.list.cards.filter(c => c !== f.card); }, 'Card deleted'); },
    async 'del-card'() { const x = ctxCard(); if (!x || !await confirmAction(`Delete the card "${x.card.title}"?`)) return; ui.modal = null; mutate(() => { x.list.cards = x.list.cards.filter(c => c !== x.card); }, 'Card deleted'); },

    /* etiquetas */
    'add-label'() { cur().labels.push({ id: uid(), name: '', color: PALETTE[cur().labels.length % PALETTE.length] }); save(); render(); },
    async 'del-label'(el) {
      const b = cur(); const id = el.dataset.lid;
      const label = b.labels.find(l => l.id === id); if (!await confirmAction(`Delete the label "${label?.name || 'Unnamed'}"?`)) return;
      b.labels = b.labels.filter(l => l.id !== id); b.lists.forEach(l => l.cards.forEach(c => { c.labels = c.labels.filter(x => x !== id); })); save(); render();
    }
  };

  /* ---------------- Eventos ---------------- */
  async function dispatch(action, el, e) {
    if (['open-card', 'archive-card', 'del-card', 'dup-card'].includes(action) && !await discardDescription()) return;
    const b = cur();
    if (b && ['dup-board', 'del-label'].includes(action)) {
      await store.hydrate(b); store.adopt(state);
    }
    if (b && ['open-card', 'restore-card', 'purge-card'].includes(action)) {
      const id = el.dataset.id || ui.modal?.id;
      const c = await store.card(b.id, id);
      const l = b.lists.find(l => l.id === c.listId);
      l.cards = l.cards.filter(x => x.id !== id); l.cards.push(c);
      l.cards.sort((a, b) => a._pos - b._pos);
      store.adopt(state);
    }
    const result = await A[action]?.(el, e);
    if (action === 'open-card' && ui.modal?.type === 'card') {
      const images = await store.db.images.where('[boardId+cardId]').equals([b.id, ui.modal.id]).toArray();
      ui.modal.images = images.map(({ blob, ...metadata }) => metadata);
    }
    return result;
  }
  document.addEventListener('focusin', e => rememberEmojiTarget(e.target));
  document.addEventListener('pointerup', e => rememberEmojiTarget(e.target));
  document.addEventListener('keyup', e => rememberEmojiTarget(e.target));
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('.emoji-trigger')) rememberEmojiTarget(document.activeElement);
    else rememberEmojiTarget(e.target);
  });
  document.addEventListener('click', e => {
    if (Date.now() < suppressClick) return;
    const t = e.target;
    const closingEmoji = ui.emojiOpen && !t.closest('.emoji-picker') && !t.closest('.emoji-trigger');
    if (closingEmoji) {
      ui.emojiOpen = false;
      $('.emoji-picker')?.setAttribute('hidden', '');
      $('.emoji-trigger')?.setAttribute('aria-expanded', 'false');
    }
    const closingFilters = ui.filterOpen && !t.closest('.filter-panel') && !t.closest('[data-act="toggle-filters"]');
    if (closingFilters) ui.filterOpen = false;
    let changed = false;
    if (ui.composer && !t.closest('.composer')) { ui.composer = null; changed = true; }
    if (ui.addingList && !t.closest('.add-list')) { ui.addingList = false; changed = true; }
    let el = t.closest('[data-act]');
    if (el?.matches('.description-view, .description-preview') && t.closest('a, button, input, label, select, textarea, summary')) el = null;
    const fn = el && A[el.dataset.act];
    if (el?.dataset.act === 'choose-attachments') { $('.image-files')?.click(); return; }
    const before = renderCount;
    run(async () => {
      if (fn) await dispatch(el.dataset.act, el, e);
      if (changed && renderCount === before && el?.dataset.act !== 'edit-list-title') render();
      else if (closingFilters && renderCount === before) render();
    });
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('.home-board-search')) {
      ui.boardQuery = t.value;
      clearTimeout(searchT);
      searchT = setTimeout(() => run(() => render()), 150);
      return;
    }
    if (t.matches('.search, .filter-keyword')) {
      ui.q = t.value.trim();
      updateFilterToggle();
      clearTimeout(searchT);
      searchT = setTimeout(() => run(() => render()), 150);
      return;
    }
    if (t.matches('.board-title')) {
      const b = cur(); if (!b) return;
      if (/[\r\n]/.test(t.value)) t.value = t.value.replace(/[\r\n]+/g, ' ');
      if (t.value.trim()) { b.name = t.value.trim(); saveSoon(); }
      sizeBoardTitle(); return;
    }
    const f = t.dataset?.f; if (!f) return;
    const x = ctxCard();
    if (f === 'title' && x) { x.card.title = t.value; saveSoon(); }
    else if (f === 'desc' && x && descriptionDraft) { descriptionDraft.text = t.value; rememberEmojiTarget(t); updateDescriptionPreview(); }
    else if (f === 'check-text' && x) { const i = x.card.checklist.find(i => i.id === t.dataset.iid); if (i) { i.text = t.value; saveSoon(); } }
    else if (f === 'label-name' || f === 'label-color') {
      const l = cur()?.labels.find(l => l.id === t.dataset.lid); if (!l) return;
      if (f === 'label-name') l.name = t.value; else l.color = t.value; saveSoon();
    }
  });

  document.addEventListener('change', e => {
    const t = e.target, f = t.dataset?.f;
    if (t.id === 'import-file') return;
    if (t.matches('.image-files')) {
      const files = [...t.files], context = ctxCard();
      t.value = '';
      run(() => addAttachments(files, context));
      return;
    }
    run(() => {
    if (t.matches('[data-filter-group]')) {
      const { filterGroup: group } = t.dataset, value = t.value;
      if (ui.filters[group].includes(value)) ui.filters[group] = ui.filters[group].filter(x => x !== value);
      else ui.filters[group].push(value);
      render();
      return;
    }
    if (t.matches('.board-title')) { if (!t.value.trim()) { t.value = cur().name; } save(); render(); return; }
    if (!f) return;
    const x = ctxCard();
    if (f === 'bg' && ui.modal?.type === 'boardmenu') { cur().bg = +t.value; cur().bgColor = ''; save(); render(); }
    else if (f === 'board-bg' && ui.modal?.type === 'boardmenu') { cur().bgColor = t.value; save(); render(); }
    else if (f === 'lane-theme') { const l = cur()?.lists.find(x => x.id === t.dataset.id); if (l) { l.theme = t.value; save(); render(); } }
    else if (f === 'card-theme' && x) { x.card.theme = t.value; save(); render(); }
    else if (f === 'cover-image' && x) {
      if (t.value && (!x.card.imageIds?.includes(t.value) || !isImage(ui.modal.images?.find(image => image.id === t.value)))) return;
      mutate(() => { x.card.coverImageId = t.value || null; }, 'Cover changed');
    }
    else if (f === 'due' && x) { x.card.due = t.value; x.card.dueDone = !!t.value && x.card.completed; save(); render(); }
    else if (f === 'completed' && x) {
      if (t.checked && x.card.recurrence && x.card.due) {
        x.card.due = dateKey(advanceDate(x.card.due, x.card.recurrence));
        x.card.completed = false; x.card.dueDone = false;
        save(); render(); toast(`Next due date: ${fmtDate(x.card.due)}`);
      } else {
        x.card.completed = t.checked; x.card.dueDone = !!x.card.due && t.checked;
        save(); render();
      }
    }
    else if (f === 'priority' && x) { x.card.priority = t.value; save(); render(); }
    else if (f === 'recurrence' && x) { x.card.recurrence = t.value; save(); }
    else if (f === 'check-done' && x) { const i = x.card.checklist.find(i => i.id === t.dataset.iid); if (i) { i.done = t.checked; save(); render(); } }
    else if (f === 'move' && x) {
      const to = x.b.lists.find(l => l.id === t.value);
      if (to && to !== x.list) { x.list.cards = x.list.cards.filter(c => c !== x.card); to.cards.push(x.card); save(); render(); }
    }
    });
  });

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (ready && !failed && !queued && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
        cur() && !ui.modal && !menuEl && !drag && !ui.composer && !ui.addingList &&
        !t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) {
      const shortcut = BOARD_SHORTCUTS.find(shortcut => shortcut.key === e.key.toLowerCase());
      if (shortcut) {
        const creates = ['add-card', 'add-list'].includes(shortcut.action);
        if (creates && ui.view !== 'board') return;
        const list = t.closest('.list') || $('.list');
        if (shortcut.action === 'add-card' && !list) { e.preventDefault(); toast('Create a list before adding a card.'); return; }
        e.preventDefault();
        run(() => dispatch(shortcut.action, list || t, e));
        return;
      }
    }
    if (descriptionDraft && t.matches('[data-f="desc"]') && (e.ctrlKey || e.metaKey)) {
      if (e.key === 'Enter') { e.preventDefault(); run(() => A['save-description']()); return; }
      const format = { b: 'bold', i: 'italic', k: 'link' }[e.key.toLowerCase()];
      if (format) { e.preventDefault(); run(() => A['format-description']({ dataset: { format } })); return; }
    }
    if (e.key === 'Escape') {
      if (descriptionDraft?.imagePicker) { e.preventDefault(); run(() => A['toggle-description-images']()); return; }
      if (drag?.active) { endDrag(false); return; }
      if (menuEl) { closeMenu(); return; }
      if (ui.emojiOpen) { ui.emojiOpen = false; $('.emoji-picker')?.setAttribute('hidden', ''); $('.emoji-trigger')?.setAttribute('aria-expanded', 'false'); return; }
      if (ui.filterOpen) { ui.filterOpen = false; render(); return; }
      if (t.matches('.list-title-input')) { t.dataset.cancel = '1'; t.blur(); return; }
      if (ui.composer || ui.addingList) { ui.composer = null; ui.addingList = false; render(); return; }
      if (descriptionDraft && ui.modal?.type === 'card') { e.preventDefault(); run(() => A['cancel-description']()); return; }
      if (ui.modal) { e.preventDefault(); run(() => closeModal()); return; }
    } else if (e.key === 'Enter') {
      if (t.matches('.composer textarea') && !e.shiftKey) { e.preventDefault(); run(() => A['save-card']()); }
      else if (t.matches('.add-list input')) { e.preventDefault(); run(() => A['save-list']()); }
      else if (t.matches('.add-check input')) { e.preventDefault(); run(() => A['add-check']()); }
      else if (t.matches('.nb-name')) { e.preventDefault(); run(() => A['create-board']()); }
      else if (t.matches('#lane-wip-limit')) { e.preventDefault(); run(() => A['save-lane-wip']()); }
      else if (t.matches('.list-title-input, .board-title, .m-title, .ci-text')) { e.preventDefault(); t.blur(); }
      else if (t.matches('.card')) { e.preventDefault(); run(() => dispatch('open-card', t, e)); }
    }
  });

  addEventListener('hashchange', () => run(async () => {
    if (descriptionDraft && location.hash === `#/b/${descriptionDraft.boardId}`) return;
    if (!await discardDescription()) { location.replace(`#/b/${descriptionDraft.boardId}`); return; }
    ui.modal = null; ui.q = ''; ui.filters = { status: [], due: [], labels: [] }; ui.filterOpen = false; ui.emojiOpen = false; ui.emojiTarget = null; ui.composer = null; ui.addingList = false; closeMenu(); render();
  }));
  async function refreshExternal() {
    if (!ready || failed || running || saveT || dirty || drag || descriptionDraft) return;
    const revision = (await store.db.settings.get('revision'))?.value || 0;
    if (revision !== store.revision) {
      await run(async () => {
        state = await store.readState();
        if (ui.modal?.type === 'card' && cur()) {
          const exists = await store.db.cards.get([cur().id, ui.modal.id]);
          if (exists) {
            const c = await store.card(cur().id, ui.modal.id);
            cur().lists.find(l => l.id === c.listId)?.cards.push(c); store.adopt(state);
          } else ui.modal = null;
        }
        if (ui.modal?.type === 'boardmenu' && cur()) ui.modal.archivedCount = await store.archivedCount(cur().id);
        render();
      });
    }
  }
  if (channel) channel.onmessage = () => refreshExternal().catch(storageError);
  addEventListener('focus', () => refreshExternal().catch(storageError));
  addEventListener('kanbaya-install-change', () => run(() => render()));

  /* ---------------- Arrastrar y soltar (ratón + táctil) ---------------- */
  function onPointerDown(e) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('button,input,textarea,select,a,.composer')) return;
    const card = e.target.closest('.card');
    const head = !card && e.target.closest('.list-header');
    const el = card || (head && head.parentElement);
    if (!el || !el.closest('.lists')) return;
    drag = { el, type: card ? 'card' : 'list', x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', active: false };
    if (drag.touch) drag.timer = setTimeout(beginDrag, 260);
    addEventListener('pointermove', onPointerMove, { passive: false });
    addEventListener('pointerup', onPointerUp);
    addEventListener('pointercancel', onPointerCancel);
  }
  function stopListening() {
    removeEventListener('pointermove', onPointerMove);
    removeEventListener('pointerup', onPointerUp);
    removeEventListener('pointercancel', onPointerCancel);
  }
  const blockTouch = e => { if (e.cancelable) e.preventDefault(); };
  const blockMenu = e => e.preventDefault();

  function beginDrag() {
    const d = drag; if (!d || d.active) return;
    d.active = true;
    if (d.type === 'card') d.card = findCard(cur(), d.el.dataset.id)?.card;
    try { d.el.releasePointerCapture?.(d.id); } catch { /* sin captura */ }
    const r = d.el.getBoundingClientRect();
    d.offX = d.x - r.left; d.offY = d.y - r.top;
    const g = d.el.cloneNode(true); g.classList.add('drag-ghost'); g.removeAttribute('data-act'); g.removeAttribute('data-id');
    g.style.width = r.width + 'px'; g.style.height = r.height + 'px'; g.style.maxHeight = r.height + 'px';
    document.body.append(g); d.ghost = g;
    const ph = document.createElement('div'); ph.className = d.type === 'card' ? 'card-ph' : 'list-ph';
    ph.style.height = r.height + 'px';
    if (d.type === 'list') ph.style.width = r.width + 'px';
    d.el.after(ph); d.ph = ph; d.el.classList.add('drag-hidden');
    document.body.classList.add('dragging');
    addEventListener('touchmove', blockTouch, { passive: false });
    addEventListener('contextmenu', blockMenu);
    d.scrollTimer = setInterval(autoScroll, 16);
    placeGhost();
  }
  function placeGhost() {
    const d = drag; if (!d?.ghost) return;
    d.ghost.style.transform = `translate(${d.lx - d.offX}px, ${d.ly - d.offY}px) rotate(${d.type === 'card' ? 3 : 2}deg)`;
  }
  function onPointerMove(e) {
    const d = drag; if (!d || e.pointerId !== d.id) return;
    d.lx = e.clientX; d.ly = e.clientY;
    if (!d.active) {
      const dist = Math.hypot(d.lx - d.x, d.ly - d.y);
      if (d.touch) { if (dist > 8) cancelPending(); }
      else if (dist > 5) beginDrag();
      return;
    }
    if (e.cancelable) e.preventDefault();
    placeGhost(); reorder();
  }
  function cancelPending() { clearTimeout(drag?.timer); stopListening(); drag = null; }
  function onPointerUp(e) { if (drag && e.pointerId === drag.id) endDrag(true); }
  function onPointerCancel(e) { if (drag && e.pointerId === drag.id) endDrag(false); }

  function reorder() {
    const d = drag; if (!d?.ph) return;
    const x = d.lx, y = d.ly;
    if (d.type === 'card') {
      const listEl = document.elementFromPoint(x, y)?.closest('.list'); if (!listEl) return;
      const wrap = $('.list-cards', listEl);
      if (!wrap) return;
      let before = null;
      for (const c of $$('.card', wrap)) {
        if (c === d.el || c.classList.contains('drag-hidden')) continue;
        const r = c.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = c; break; }
      }
      if (before) { if (d.ph.nextElementSibling !== before) wrap.insertBefore(d.ph, before); }
      else {
        const bottom = $$('.virtual-spacer', wrap).at(-1);
        if (bottom) wrap.insertBefore(d.ph, bottom);
        else if (wrap.lastElementChild !== d.ph) wrap.append(d.ph);
      }
    } else {
      const wrap = $('.lists');
      let before = null;
      for (const l of $$('.list', wrap)) {
        if (l === d.el) continue;
        const r = l.getBoundingClientRect();
        if (x < r.left + r.width / 2) { before = l; break; }
      }
      const ref = before || $('.add-list', wrap);
      if (d.ph.nextElementSibling !== ref) wrap.insertBefore(d.ph, ref);
    }
  }
  function autoScroll() {
    const d = drag; if (!d?.active) return;
    const sc = $('.board-scroll');
    if (sc) { const r = sc.getBoundingClientRect(); if (d.lx < r.left + 60) sc.scrollLeft -= 14; else if (d.lx > r.right - 60) sc.scrollLeft += 14; }
    if (d.type === 'card') {
      const w = document.elementFromPoint(d.lx, d.ly)?.closest('.list')?.querySelector('.list-cards');
      if (w) { const r = w.getBoundingClientRect(); if (d.ly < r.top + 40) w.scrollTop -= 12; else if (d.ly > r.bottom - 40) w.scrollTop += 12; }
    }
    reorder();
  }

  function endDrag(commit) {
    const d = drag; if (!d) return;
    clearTimeout(d.timer); stopListening();
    if (!d.active) { drag = null; return; }
    clearInterval(d.scrollTimer);
    removeEventListener('touchmove', blockTouch); removeEventListener('contextmenu', blockMenu);
    document.body.classList.remove('dragging');
    d.ghost.remove();
    suppressClick = Date.now() + 300;
    const b = cur();
    // Siguiente hermano real (ignorando el elemento original oculto).
    let next = d.ph.nextElementSibling; while (next && (next === d.el || next.classList.contains('drag-hidden'))) next = next.nextElementSibling;
    const toListEl = d.ph.closest('.list');
    const toListId = toListEl?.dataset.id;
    let beforeId = next && next.matches(d.type === 'card' ? '.card' : '.list') ? next.dataset.id : null;
    if (d.type === 'card' && (!next || next.classList.contains('virtual-spacer'))) {
      const virtual = d.ph.parentElement.virtualWindow;
      beforeId = virtual?.keys[virtual.end]?.id || null;
    }
    d.ph.remove(); d.el.classList.remove('drag-hidden');
    drag = null;
    run(async () => {
    if (commit && b) {
      if (d.type === 'card' && toListId) {
        const f = findCard(b, d.el.dataset.id) || (d.card && { card: d.card, list: b.lists.find(l => l.id === d.card.listId) }), to = b.lists.find(l => l.id === toListId);
        if (f && to) {
          f.card._pos = await store.positionBefore(b.id, to.id, beforeId, f.card.id);
          f.card._positioned = true;
          f.list.cards = f.list.cards.filter(c => c !== f.card);
          const idx = beforeId ? to.cards.findIndex(c => c.id === beforeId) : -1;
          if (idx >= 0) to.cards.splice(idx, 0, f.card); else to.cards.push(f.card);
          save();
        }
      } else if (d.type === 'list') {
        const l = b.lists.find(x => x.id === d.el.dataset.id);
        if (l) {
          b.lists = b.lists.filter(x => x !== l);
          const idx = beforeId ? b.lists.findIndex(x => x.id === beforeId) : -1;
          if (idx >= 0) b.lists.splice(idx, 0, l); else b.lists.push(l);
          save();
        }
      }
    }
    render();
    });
  }
  document.addEventListener('pointerdown', onPointerDown);

  /* ---------------- Arranque ---------------- */
  let searchT = null;
  async function start() {
    try {
      state = await store.initialize(seed);
      await store.applyWelcomePriorities('My first board', WELCOME_PRIORITIES);
      ready = true;
      if (location.hash.startsWith('#/b/') && !cur()) location.replace('#/');
      render();
      refreshStorageUsage();
      navigator.storage?.persist?.().catch(error => console.warn('Kanbaya: could not request persistent storage', error));
    } catch (error) { storageError(error); }
  }
  start();
  window.kanbayaFlush = async () => {
    if (hasDescriptionChanges()) throw new Error('Save or cancel the description before updating.');
    await run(() => {});
    if (failed || dirty || saveT) throw new Error('Export pending changes before updating.');
  };
})();
