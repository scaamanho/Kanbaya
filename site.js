const imageViewer = document.querySelector('.image-viewer');
const viewerImage = imageViewer.querySelector('.image-viewer-image');
const viewerCaption = document.querySelector('#image-viewer-caption');

document.querySelectorAll('[data-screenshot]').forEach(link => {
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !imageViewer.showModal) return;

    event.preventDefault();
    const image = link.querySelector('img');
    viewerImage.src = link.href;
    viewerImage.alt = image.alt;
    viewerCaption.textContent = image.alt;
    imageViewer.showModal();
  });
});

imageViewer.querySelector('.image-viewer-close').addEventListener('click', () => imageViewer.close());
