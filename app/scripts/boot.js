'use strict';
(() => {
  const VERSION = '30';
  let installEvent = null;
  const installBanner = document.createElement('section');
  installBanner.className = 'install-banner';
  installBanner.setAttribute('aria-label', 'Install Kanbaya');
  installBanner.hidden = true;
  installBanner.innerHTML = '<div><strong>Install Kanbaya</strong><p role="status">Keep your boards close at hand.</p></div><div class="install-actions"><button class="btn primary" type="button" data-install-trigger>Install</button><button class="icon-btn" type="button" aria-label="Dismiss install banner">✕</button></div>';
  document.body.append(installBanner);
  const installMessage = installBanner.querySelector('p');
  const installUrl = new URL(location.href);
  if (installUrl.searchParams.get('install') === '1') {
    installBanner.hidden = window.matchMedia('(display-mode: standalone)').matches;
  }
  const notifyInstallChange = () => {
    window.kanbayaInstallAvailable = !!installEvent;
    window.dispatchEvent(new Event('kanbaya-install-change'));
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installEvent = event;
    notifyInstallChange();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    installBanner.hidden = true;
    notifyInstallChange();
  });
  installBanner.querySelector('[aria-label="Dismiss install banner"]').addEventListener('click', () => { installBanner.hidden = true; });
  document.addEventListener('click', async event => {
    if (!event.target.closest('[data-install-trigger]')) return;
    if (!installEvent) {
      installMessage.textContent = 'Use your browser menu to install the app. On iPhone or iPad, use Share, then Add to Home Screen.';
      return;
    }
    const prompt = installEvent;
    installEvent = null;
    try {
      const result = await prompt.prompt();
      if (result.outcome === 'accepted') installBanner.hidden = true;
    } catch (error) {
      console.error('Kanbaya: could not open the installation prompt', error);
      installBanner.hidden = false;
      installMessage.textContent = 'Could not open the install prompt. Use your browser menu to install the app.';
    } finally {
      notifyInstallChange();
    }
  });
  const scripts = ['vendor/dexie.min.js', 'vendor/marked.umd.js', 'vendor/purify.min.js', 'scripts/storage.js', 'scripts/virtual.js', 'scripts/drive.js', 'scripts/app.js'];
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${src}?v=${VERSION}`;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(script);
  });
  const workerVersion = worker => new Promise(resolve => {
    if (!worker) { resolve(null); return; }
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); resolve(null); }, 1000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data?.version); };
    worker.postMessage({ type: 'VERSION' }, [channel.port2]);
  });
  function offerUpdate(registration, blocking) {
    if (document.querySelector('.update-notice')) return;
    const panel = document.createElement('section');
    panel.className = 'storage-error update-notice';
    const text = document.createElement('p');
    text.textContent = 'An update is available. Save and close other Kanbaya tabs before activating it.';
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = 'Activate update and reload';
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (window.kanbayaFlush) await window.kanbayaFlush();
        if (!registration.waiting) throw new Error('The update is not ready yet. Reload to try again.');
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        registration.waiting.postMessage({ type: 'ACTIVATE' });
      } catch (error) { console.error(error); text.textContent = error.message; button.disabled = false; }
    };
    panel.append(text, button); document.body.append(panel);
    if (blocking) document.querySelector('#app').textContent = 'Update to open your data with a consistent application version.';
  }
  async function boot() {
    let registration;
    if ('serviceWorker' in navigator && window.isSecureContext) {
      const previous = navigator.serviceWorker.controller;
      const previousUrl = previous && new URL(previous.scriptURL);
      const parentWorkerUrl = new URL('../sw.js', location.href);
      if (previousUrl && previousUrl.origin === parentWorkerUrl.origin &&
          previousUrl.pathname === parentWorkerUrl.pathname && await workerVersion(previous) === '23') {
        const parentScope = new URL('../', location.href).href;
        const previousRegistration = (await navigator.serviceWorker.getRegistrations())
          .find(reg => reg.scope === parentScope && reg.active?.scriptURL === previous.scriptURL);
        if (previousRegistration && !await previousRegistration.unregister()) throw new Error('Could not remove the previous offline registration.');
        location.reload();
        return;
      }
      try { registration = await navigator.serviceWorker.register('sw.js'); }
      catch (error) {
        console.warn('Kanbaya: could not register offline support; checking the previous installation.', error);
        registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw error;
      }
      try { await registration.update(); }
      catch (error) {
        console.warn('Kanbaya: could not check for updates; using the installed version.', error);
        if (!navigator.serviceWorker.controller) throw error;
      }
      const current = navigator.serviceWorker.controller;
      const version = await workerVersion(current);
      if (current && version !== VERSION) {
        if (registration.installing) await new Promise((resolve, reject) => {
          const worker = registration.installing;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') resolve();
            if (worker.state === 'redundant') reject(new Error('The update download failed.'));
          });
        });
        if (await workerVersion(navigator.serviceWorker.controller) !== VERSION) { offerUpdate(registration, true); return; }
      }
      const checkUpdate = () => { if (registration.waiting) offerUpdate(registration, false); };
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', checkUpdate);
      });
      checkUpdate();
    }
    for (const script of scripts) await load(script);
  }
  boot().catch(error => {
    console.error('Kanbaya: startup', error);
    const app = document.querySelector('#app');
    app.textContent = 'Could not start Kanbaya: ' + error.message + '. Your data has not been deleted. Reload to try again.';
    app.setAttribute('role', 'alert');
  });
})();
