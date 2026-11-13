'use strict';
(() => {
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
  window.KanbayaBackupMerge = { boardConflicts, mergeBoard };
})();
