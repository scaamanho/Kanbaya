'use strict';
(() => {
  const { PRIORITIES, dateKey, todayStr, dateOrdinal, shiftDate, validDate } = KanbayaModel;
  function create({ $, esc, getBoardId, blocked, execute, commitDates, render, notify, suppressClicks, refresh }) {
    let timelineDrag = null;
    const TIMELINE_DAY_WIDTH = 36;
    function timelineHTML(month) {
      const y = month.getFullYear(), m = month.getMonth();
      const days = new Date(y, m + 1, 0).getDate();
      const first = dateKey(new Date(y, m, 1));
      const headers = Array.from({ length: days }, (_, index) => {
        const date = new Date(y, m, index + 1);
        return `<span class="${dateKey(date) === todayStr() ? 'today' : ''}">${index + 1}</span>`;
      }).join('');
      return `<section class="timeline" aria-label="Board timeline">
        <div class="calendar-head"><button class="btn" data-act="month-prev" aria-label="Previous month">‹</button><h2>${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2><button class="btn" data-act="month-next" aria-label="Next month">›</button><button class="btn sm" data-act="month-today">Today</button></div>
        <p class="timeline-help">Drag a bar to move dates or drag its ends to resize. Double-click a bar to open its card. Open a card to edit dates with the keyboard.</p>
        <div class="timeline-scroll"><div class="timeline-table" style="--timeline-width:${days * TIMELINE_DAY_WIDTH}px">
          <div class="timeline-header"><span>Card</span><div class="timeline-days">${headers}</div></div>
          <div class="timeline-window" data-timeline-first="${first}" data-timeline-days="${days}"></div>
        </div></div>
        <h3>Unscheduled cards</h3><div class="timeline-unscheduled"></div>
      </section>`;
    }

    function timelineRowHTML(b, c, first, days) {
      const start = c.startDate || c.due, end = c.due || c.startDate;
      const left = Math.max(0, dateOrdinal(start) - dateOrdinal(first));
      const right = Math.min(days - 1, dateOrdinal(end) - dateOrdinal(first));
      const milestone = !c.startDate || !c.due;
      const list = b.lists.find(l => l.id === c.listId);
      const priority = PRIORITIES.find(p => p.value === c.priority);
      return `<div class="timeline-row" data-virtual-id="${esc(c.id)}" tabindex="-1">
        <button class="timeline-card" data-act="open-card" data-id="${esc(c.id)}" title="${esc(c.title)} — ${esc(list?.name || '')}"><strong>${esc(c.title)}</strong><small>${esc(list?.name || '')}</small></button>
        <div class="timeline-track" style="--timeline-days:${days}">
          <div class="timeline-bar ${milestone ? 'milestone' : ''} ${c.completed ? 'done' : ''} ${priority?.value ? `priority-${priority.value}` : ''}" style="left:${left * TIMELINE_DAY_WIDTH}px;width:${(right - left + 1) * TIMELINE_DAY_WIDTH}px" data-timeline-id="${esc(c.id)}" data-start="${esc(c.startDate || '')}" data-due="${esc(c.due || '')}" title="${esc(start)}${start === end ? '' : ' – ' + esc(end)}">
            ${!milestone && start >= first ? '<span class="timeline-handle start" data-timeline-handle="start"></span>' : ''}
            <span class="timeline-bar-label">${milestone ? '◆' : esc(c.title)}</span>
            ${!milestone && dateOrdinal(end) < dateOrdinal(first) + days ? '<span class="timeline-handle end" data-timeline-handle="end"></span>' : ''}
          </div>
        </div></div>`;
    }

    function timelineDates(d, delta) {
      if (d.mode === 'start') delta = Math.min(delta, dateOrdinal(d.due) - dateOrdinal(d.start));
      if (d.mode === 'end') delta = Math.max(delta, dateOrdinal(d.start) - dateOrdinal(d.due));
      return {
        delta,
        start: d.start && d.mode !== 'end' ? shiftDate(d.start, delta) : d.start,
        due: d.due && d.mode !== 'start' ? shiftDate(d.due, delta) : d.due
      };
    }
    function moveTimelinePointer(e) {
      const d = timelineDrag;
      if (!d || e.pointerId !== d.id) return;
      const distance = e.clientX - d.x;
      if (!d.active && Math.abs(distance) < 5) return;
      d.active = true;
      if (e.cancelable) e.preventDefault();
      const dates = timelineDates(d, Math.round(distance / TIMELINE_DAY_WIDTH));
      d.delta = dates.delta;
      if ((dates.start && !validDate(dates.start)) || (dates.due && !validDate(dates.due))) return;
      const first = dateOrdinal(d.first), start = dateOrdinal(dates.start || dates.due), end = dateOrdinal(dates.due || dates.start);
      const left = Math.max(0, Math.min(d.days, start - first));
      const right = Math.max(left, Math.min(d.days, end - first + 1));
      d.bar.style.left = left * TIMELINE_DAY_WIDTH + 'px';
      d.bar.style.width = (right - left) * TIMELINE_DAY_WIDTH + 'px';
      d.bar.classList.add('is-dragging');
    }
    function finishTimelineDrag(commit) {
      const d = timelineDrag;
      if (!d) return;
      timelineDrag = null;
      removeEventListener('pointermove', moveTimelinePointer);
      removeEventListener('pointerup', timelinePointerUp);
      removeEventListener('pointercancel', timelinePointerCancel);
      if (d.bar.hasPointerCapture(d.id)) d.bar.releasePointerCapture(d.id);
      if (d.active) suppressClicks();
      if (!d.active || !commit || !d.delta) {
        if (d.active) render();
        refresh();
        return;
      }
      const dates = timelineDates(d, d.delta);
      if ((dates.start && !validDate(dates.start)) || (dates.due && !validDate(dates.due))) {
        render(); notify('The resulting date is outside the supported range.'); return;
      }
      execute(() => commitDates(d, dates));
    }
    function timelinePointerUp(e) { if (timelineDrag && e.pointerId === timelineDrag.id) finishTimelineDrag(true); }
    function timelinePointerCancel(e) { if (timelineDrag && e.pointerId === timelineDrag.id) finishTimelineDrag(false); }
    document.addEventListener('pointerdown', e => {
      const bar = e.target.closest('.timeline-bar'), host = bar?.closest('.timeline-window');
      if (!bar || !host || timelineDrag || blocked() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const mode = e.target.closest('[data-timeline-handle]')?.dataset.timelineHandle || 'move';
      timelineDrag = {
        id: e.pointerId, x: e.clientX, bar, mode, boardId: getBoardId(), cardId: bar.dataset.timelineId,
        start: bar.dataset.start, due: bar.dataset.due, first: host.dataset.timelineFirst, days: Number(host.dataset.timelineDays),
        active: false, delta: 0
      };
      bar.setPointerCapture(e.pointerId);
      addEventListener('pointermove', moveTimelinePointer, { passive: false });
      addEventListener('pointerup', timelinePointerUp);
      addEventListener('pointercancel', timelinePointerCancel);
    });

    return { html: timelineHTML, rowHTML: timelineRowHTML, isDragging: () => !!timelineDrag, isActive: () => !!timelineDrag?.active, cancel: () => finishTimelineDrag(false) };
  }
  window.KanbayaTimeline = { create };
})();
