'use strict';
(() => {
  const CLIENT_ID = '54984532757-hr8smhh2lb9fctmcdc9obq26voqgv2ps.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files';
  let identityReady = null, accessToken = null, expiresAt = 0;
  const connected = () => !!accessToken && Date.now() < expiresAt - 5000;
  const disconnect = () => { accessToken = null; expiresAt = 0; };
  function online() {
    if (!navigator.onLine) throw new Error('Google Drive needs an Internet connection. Local backups still work.');
  }
  function prepare() {
    online();
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (identityReady) return identityReady;
    identityReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new Error('Google sign-in took too long to load. Check your connection and try again.')), 15000);
      function finish(error) {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      }
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => finish(window.google?.accounts?.oauth2 ? null : new Error('Google sign-in is unavailable.'));
      script.onerror = () => finish(new Error('Could not load Google sign-in. Check your connection or browser restrictions.'));
      document.head.append(script);
    }).catch(error => { identityReady = null; throw error; });
    return identityReady;
  }
  function connect() {
    online();
    if (!window.google?.accounts?.oauth2) throw new Error('Load Google sign-in before connecting.');
    disconnect();
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPE, include_granted_scopes: false,
        callback(response) {
          if (response.error) { reject(new Error(`Google authorization failed: ${response.error_description || response.error}`)); return; }
          if (!response.scope?.split(/\s+/).includes(SCOPE)) { reject(new Error('Google Drive permission was not granted. Connect again and allow access to application files.')); return; }
          const lifetime = Number(response.expires_in);
          if (!response.access_token || !Number.isFinite(lifetime) || lifetime <= 0) { reject(new Error('Google returned an invalid session. Connect again.')); return; }
          accessToken = response.access_token;
          expiresAt = Date.now() + lifetime * 1000;
          resolve();
        },
        error_callback(error) {
          reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was cancelled.' : 'Google sign-in could not open. Allow pop-up windows and try again.'));
        }
      });
      client.requestAccessToken({ prompt: 'select_account' });
    });
  }
  async function request(url, options = {}) {
    online();
    if (!connected()) { disconnect(); throw new Error('Your Google Drive session has expired. Connect again.'); }
    const response = await fetch(url, {
      ...options, signal: AbortSignal.timeout(120000), credentials: 'omit', redirect: 'error',
      headers: { ...options.headers, Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 401) { disconnect(); throw new Error('Google Drive authorization has expired or was revoked. Connect again.'); }
    if (!response.ok) {
      const detail = response.headers.get('Content-Type')?.includes('application/json') ? (await response.json()).error?.message : '';
      throw new Error(`Google Drive request failed (HTTP ${response.status})${detail ? ': ' + detail : '.'}`);
    }
    return response;
  }
  async function listFiles(query) {
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `trashed = false and (${query})`, spaces: 'drive', pageSize: '100',
        fields: 'nextPageToken,files(id,name,modifiedTime)', orderBy: 'modifiedTime desc',
        ...(pageToken ? { pageToken } : {})
      });
      const result = await (await request(`${API}?${params}`)).json();
      if (!Array.isArray(result.files) || result.files.some(file => typeof file.id !== 'string' || typeof file.name !== 'string')) throw new Error('Google Drive returned an invalid file list.');
      files.push(...result.files);
      pageToken = result.nextPageToken || '';
    } while (pageToken);
    return files;
  }
  async function upload(backup, name) {
    const folders = await listFiles("mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='kanbayaType' and value='backup-folder' }");
    const folder = folders[0] || await (await request(API + '?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kanbaya Backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { kanbayaType: 'backup-folder' } })
    })).json();
    if (typeof folder.id !== 'string' || !folder.id) throw new Error('Google Drive did not return a backup folder.');
    const type = backup.blob.type || 'application/octet-stream';
    const session = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': type },
      body: JSON.stringify({ name, mimeType: type, parents: [folder.id], appProperties: { kanbayaType: 'backup' } })
    });
    const location = session.headers.get('Location');
    if (!location) throw new Error('Google Drive did not provide an upload session.');
    const target = new URL(location);
    if (target.origin !== 'https://www.googleapis.com' || target.pathname !== '/upload/drive/v3/files') throw new Error('Google Drive returned an unexpected upload address.');
    const saved = await (await request(target.href, { method: 'PUT', headers: { 'Content-Type': type }, body: backup.blob })).json();
    if (typeof saved.id !== 'string' || !saved.id) throw new Error('Google Drive did not confirm the backup upload.');
    return saved;
  }
  window.KanbayaDrive = {
    prepare, connect, disconnect, connected, upload,
    list: () => listFiles("appProperties has { key='kanbayaType' and value='backup' }"),
    download: async id => (await request(`${API}/${encodeURIComponent(id)}?alt=media`)).blob()
  };
})();
