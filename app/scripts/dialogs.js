'use strict';
(() => {
  function create({ $, esc, execute }) {
    let menuEl = null;
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
        if (it.icon) {
          const icon = document.createElement('span'); icon.className = 'menu-item-icon';
          icon.setAttribute('aria-hidden', 'true'); icon.textContent = it.icon;
          n.prepend(icon);
        }
        n.addEventListener('click', e => { e.stopPropagation(); closeMenu(); if (it.fn) execute(it.fn); });
        if (it.close) {
          const row = document.createElement('div'); row.className = 'menu-tab-row'; row.setAttribute('role', 'none');
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'icon-btn'; button.textContent = '✕';
          button.setAttribute('role', 'menuitem'); button.setAttribute('aria-label', it.closeLabel);
          button.addEventListener('click', e => { e.stopPropagation(); closeMenu(); execute(it.close); });
          row.append(n, button); m.append(row);
        } else m.append(n);
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
    return { appDialog, confirmAction, promptAction, attachmentURLDialog, mergeConflictDialog, openMenu, closeMenu, isMenuOpen: () => !!menuEl };
  }
  window.KanbayaDialogs = { create };
})();
