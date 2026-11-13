'use strict';
(() => {
  const isImage = attachment => !!attachment && attachment.kind !== 'file' && attachment.mime?.startsWith('image/');
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
  function observePreviews({ readImage, notify, queryAll, roots }) {
    const imageElements = new Map();
    function imagePreviewError(el, error) {
      if (!el.isConnected) return;
      console.error('Kanbaya: image preview', error);
      el.alt = 'Image unavailable';
      notify(`Could not display image: ${error.message}`);
    }
    const imageObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target, record = imageElements.get(el);
        imageObserver.unobserve(el);
        if (!record) continue;
        readImage(el.dataset.imageId).then(image => {
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
      for (const el of queryAll('img[data-image-id]')) {
        if (imageElements.has(el)) continue;
        imageElements.set(el, { url: null });
        imageObserver.observe(el);
      }
    }
    const mutations = new MutationObserver(syncImages);
    roots.forEach(root => mutations.observe(root, { childList: true, subtree: true }));
  }
  window.KanbayaAttachments = { isImage, prepareAttachment, observePreviews };
})();
