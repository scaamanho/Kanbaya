function fixture(count = 10000) {
  const boards = [0, 1].map(n => ({
    id: 'board' + n, name: 'Tablero ' + n, bg: n, bgColor: '', created: 1, favorite: false,
    labels: [{ id: 'label' + n, name: 'Urgente', color: '#f87168' }],
    lists: [{ id: 'list' + n, name: 'Pendientes', theme: '', cards: [] }, { id: 'empty' + n, name: 'Destino', theme: '', cards: [] }]
  }));
  for (let i = 0; i < count; i++) {
    const b = boards[i % 2];
    b.lists[0].cards.push({
      id: 'card' + i, title: 'Tarea ' + i, desc: i === count - 2 ? 'aguja-remota' : 'Descripción ' + i,
      labels: [b.labels[0].id], due: '2026-11-11', dueDone: false, priority: '', completed: false,
      recurrence: i === 0 ? 'daily' : '', theme: '', archived: false, created: i + 1,
      checklist: [{ id: 'check' + i, text: 'Revisar ' + i, done: true }],
      comments: [{ id: 'comment' + i, text: 'Nota ' + i, created: i + 1 }]
    });
  }
  return { version: 2, theme: 'dark', boards, templates: [{ id: 'template', title: 'Modelo', desc: 'Contenido', checklist: ['Paso'] }] };
}
module.exports = { fixture };
