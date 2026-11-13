'use strict';
(() => {
  const PALETTE = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#579dff', '#6cc3e0', '#94c748', '#e774bb', '#8c9bab'];
  const PRIORITIES = [{ value: '', label: 'No priority' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }];
  const WELCOME_PRIORITIES = {
    '👋 Welcome: drag this card to another list': 'low',
    'Click a card to view its details': 'medium',
    'Create your own board with "＋ Create"': 'high',
    'Your data is saved only in this browser': 'critical',
    'Install the app (browser menu → Install)': 'low'
  };
  const WELCOME_DAY_RANGES = [[1, 6], [4, 11], [9, 16], [15, 23], [22, 28]];
  const BACKGROUNDS = [
    'linear-gradient(135deg,#0c66e4,#5e4db2)',
    'linear-gradient(135deg,#1f845a,#0c66e4)',
    'linear-gradient(135deg,#c25100,#ae2e24)',
    'linear-gradient(135deg,#943d73,#5e4db2)',
    'linear-gradient(135deg,#206a83,#1f845a)',
    'linear-gradient(135deg,#505f79,#172b4d)',
    '#0c66e4', '#1f845a', '#ae2e24', '#5e4db2', '#37474f'
  ];
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
  function welcomeDates(created) {
    const date = new Date(created);
    if (!Number.isFinite(date.getTime())) throw new Error('The sample board has an invalid creation date.');
    const year = date.getFullYear(), month = date.getMonth();
    return Object.fromEntries(Object.keys(WELCOME_PRIORITIES).map((title, index) => {
      const [start, end] = WELCOME_DAY_RANGES[index];
      return [title, { startDate: dateKey(new Date(year, month, start)), due: dateKey(new Date(year, month, end)) }];
    }));
  }
  const dateOrdinal = value => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getTime() / 86400000;
  };
  const shiftDate = (value, days) => new Date((dateOrdinal(value) + days) * 86400000).toISOString().slice(0, 10);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftDate(value, 0) === value;

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
      cards: arr(l?.cards).map(c => {
        if (c?.startDate && (!validDate(c.startDate) || (c?.due && c.startDate > c.due))) throw new Error('Invalid card date range.');
        return {
          id: String(c?.id || uid()), title: String(c?.title || 'Untitled').slice(0, 500), desc: String(c?.desc || ''),
          labels: arr(c?.labels).map(String),
          due: /^\d{4}-\d{2}-\d{2}$/.test(c?.due) ? c.due : '', dueDone: !!c?.dueDone,
          ...(c?.startDate ? { startDate: c.startDate } : {}),
          priority: PRIORITIES.some(p => p.value === c?.priority) ? c.priority : '', completed: !!c?.completed,
          checklist: arr(c?.checklist).map(i => ({ id: String(i?.id || uid()), text: String(i?.text || ''), done: !!i?.done })),
          comments: arr(c?.comments).map(x => ({ id: String(x?.id || uid()), text: String(x?.text || '').slice(0, 2000), created: Number(x?.created) || Date.now() })),
          recurrence: ['daily', 'weekly', 'monthly'].includes(c?.recurrence) ? c.recurrence : '',
          theme: /^#[0-9a-f]{6}$/i.test(c?.theme) ? c.theme : '',
          ...(Array.isArray(c?.imageIds) ? { imageIds: c.imageIds.map(String), coverImageId: c.imageIds.includes(c.coverImageId) ? c.coverImageId : null } : {}),
          archived: !!c?.archived, created: Number(c?.created) || Date.now()
        };
      })
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
    const dates = welcomeDates(b.created);
    [c1, c2, c3, c4, c5].forEach(card => Object.assign(card, dates[card.title]));
    todo.cards.push(c1, c2, c3); doing.cards.push(c4); done.cards.push(c5);
    return { version: 2, theme: 'auto', boards: [b], templates: [] };
  }

  window.KanbayaModel = { PALETTE, PRIORITIES, WELCOME_PRIORITIES, BACKGROUNDS, uid, todayStr, fmtDate, advanceDate, dateKey, welcomeDates, dateOrdinal, shiftDate, validDate, mkList, mkCard, mkBoard, normBoard, reid, seed };
})();
