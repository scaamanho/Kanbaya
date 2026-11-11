'use strict';
(() => {
  const memories = new Map();
  class VirtualWindow {
    constructor(host, keys, options) {
      this.host = host;
      host.virtualWindow = this;
      this.keys = keys;
      this.options = options;
      this.alive = true;
      this.generation = 0;
      this.memory = memories.get(options.key) || { heights: new Map(), scroll: 0 };
      memories.delete(options.key);
      memories.set(options.key, this.memory);
      if (memories.size > 32) memories.delete(memories.keys().next().value);
      this.host.classList.add('virtual-window');
      this.host.tabIndex = 0;
      this.host.setAttribute('aria-label', options.label || 'Cards');
      this.host.addEventListener('scroll', () => {
        this.memory.scroll = this.host.scrollTop;
        if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = null; this.draw().catch(options.error); });
      });
      this.host.addEventListener('keydown', e => {
        const row = e.target.closest('[data-virtual-id]');
        if (!row || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
        e.preventDefault();
        const index = this.keys.findIndex(k => k.id === row.dataset.virtualId);
        const next = index + (e.key === 'ArrowDown' ? 1 : -1);
        if (next < 0 || next >= this.keys.length) return;
        this.host.scrollTop = this.offsets[next];
        this.draw(this.keys[next].id).catch(options.error);
      });
      this.resize = new ResizeObserver(() => this.draw().catch(options.error));
      this.resize.observe(host);
      this.rebuild();
      this.host.innerHTML = `<div style="height:${this.total}px" aria-hidden="true"></div>`;
      this.host.scrollTop = this.memory.scroll;
    }
    rebuild() {
      this.offsets = [];
      let total = 0;
      for (const key of this.keys) { this.offsets.push(total); total += this.memory.heights.get(key.id) || this.options.estimate || 110; }
      this.total = total;
    }
    async draw(focusId) {
      if (focusId) this.pendingFocus = focusId;
      if (!this.alive || this.options.paused?.()) return;
      const generation = ++this.generation;
      this.rebuild();
      let low = 0, high = this.keys.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (this.offsets[middle] < this.host.scrollTop) low = middle + 1;
        else high = middle;
      }
      const start = Math.max(0, low - 5);
      const anchorOffset = this.offsets[low] || 0;
      let end = Math.min(this.keys.length, start + 60);
      const bottom = this.host.scrollTop + this.host.clientHeight + 500;
      for (let i = low; i < end; i++) if (this.offsets[i] > bottom) { end = i + 1; break; }
      const signature = `${start}:${end}:${this.options.revision}`;
      if (signature === this.signature && !this.pendingFocus) return;
      const rows = await this.options.read(this.keys.slice(start, end));
      if (!this.alive || generation !== this.generation || this.options.paused?.()) return;
      this.signature = signature;
      this.end = end;
      const focused = this.pendingFocus || document.activeElement?.closest('[data-virtual-id]')?.dataset.virtualId;
      const placeholder = this.host.querySelector('.card-ph');
      this.host.innerHTML = `<div class="virtual-spacer" aria-hidden="true" style="height:${this.offsets[start] || 0}px"></div>` +
        rows.map(row => this.options.html(row)).join('') +
        `<div class="virtual-spacer" aria-hidden="true" style="height:${Math.max(0, this.total - (this.offsets[end] ?? this.total))}px"></div>`;
      if (placeholder) this.host.insertBefore(placeholder, this.host.lastElementChild);
      this.options.loaded?.(rows);
      for (const row of this.host.querySelectorAll('[data-virtual-id]')) this.memory.heights.set(row.dataset.virtualId, row.getBoundingClientRect().height + 8);
      this.rebuild();
      const spacers = this.host.querySelectorAll('.virtual-spacer');
      spacers[0].style.height = (this.offsets[start] || 0) + 'px';
      spacers[1].style.height = Math.max(0, this.total - (this.offsets[end] ?? this.total)) + 'px';
      this.host.scrollTop += (this.offsets[low] || 0) - anchorOffset;
      if (focused) {
        const target = [...this.host.querySelectorAll('[data-virtual-id]')].find(row => row.dataset.virtualId === focused);
        if (target) { target.focus({ preventScroll: true }); this.pendingFocus = null; }
      }
      this.options.afterLayout?.();
    }
    destroy() {
      this.alive = false;
      this.resize.disconnect();
      if (this.frame) cancelAnimationFrame(this.frame);
    }
  }
  window.KambayaVirtual = VirtualWindow;
})();
