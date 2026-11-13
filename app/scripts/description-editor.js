'use strict';
(() => {
  function create({ $, esc, isImage, confirmAction, getContext, getAttachments, render, save, focus, rememberEmojiTarget, notify }) {
    let descriptionDraft = null;
    const hasDescriptionChanges = () => descriptionDraft && descriptionDraft.text !== descriptionDraft.original;
    const descriptionImagePattern = /!\[([^\]\n]*)\]\(attachment:([\w-]+)\)/g;
    function descriptionHTML(card, attachments, text = card.desc) {
      const renderer = new marked.Renderer();
      renderer.html = token => esc(token.text);
      renderer.image = ({ href, text, title }) => {
        if (href.startsWith('attachment:')) {
          const id = href.slice('attachment:'.length);
          const image = attachments?.find(item => item.id === id);
          return card.imageIds?.includes(id) && isImage(image)
            ? `<img data-image-id="${esc(id)}" alt="${esc(text)}" class="description-image">`
            : `<span class="muted">[Image unavailable: ${esc(text)}]</span>`;
        }
        if (!/^https?:\/\//i.test(href)) return esc(text);
        return `<img src="${esc(href)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} class="description-image" loading="lazy" referrerpolicy="no-referrer">`;
      };
      renderer.link = function ({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        let url;
        try { url = new URL(href, location.href); }
        catch { return label; }
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return label;
        return `<a href="${esc(url.href)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`;
      };
      return DOMPurify.sanitize(marked.parse(text, { renderer, gfm: true, breaks: false }), {
        USE_PROFILES: { html: true }, ADD_ATTR: ['data-image-id', 'target', 'referrerpolicy']
      });
    }
    function updateDescriptionPreview() {
      const context = getContext(), preview = $('.description-preview');
      if (context && preview && descriptionDraft) preview.innerHTML = descriptionHTML(context.card, getAttachments(), descriptionDraft.text);
    }
    async function discardDescription() {
      if (hasDescriptionChanges() && !await confirmAction('Discard unsaved description changes?', 'Discard')) return false;
      descriptionDraft = null;
      return true;
    }

    function descriptionEditor(card, attachments) {
      const draft = descriptionDraft;
      const tools = [
        ['heading', 'Heading', 'M4 4v12M14 4v12M4 10h10'],
        ['bold', 'Bold', 'M6 4h5a3 3 0 0 1 0 6H6V4Zm0 6h6a3 3 0 0 1 0 6H6v-6Z'],
        ['italic', 'Italic', 'M9 4h6M5 16h6M12 4 8 16'],
        ['strike', 'Strikethrough', 'M14 5c-1-2-8-2-8 1 0 2 3 3 4 4M6 15c2 2 8 2 8-1M3 10h14'],
        ['ul', 'Bullet list', 'M8 5h9M8 10h9M8 15h9M3 5h1M3 10h1M3 15h1'],
        ['ol', 'Numbered list', 'M8 5h9M8 10h9M8 15h9M3 3h1v5M2 11c0-2 3-2 3 0 0 1-3 3-3 4h3'],
        ['task', 'Task list', 'M8 5h9M8 14h9M2 4l2 2 3-4M2 11h4v5H2z'],
        ['quote', 'Quote', 'M4 5h5v5H4zM4 10c0 3 1 4 3 5M12 5h5v5h-5zM12 10c0 3 1 4 3 5'],
        ['code', 'Inline code', 'm6 6-4 4 4 4m8-8 4 4-4 4M12 4 8 16'],
        ['codeblock', 'Code block', 'M7 3H5v5l-2 2 2 2v5h2M13 3h2v5l2 2-2 2v5h-2'],
        ['link', 'Insert link', 'm8 6 2-2a4 4 0 0 1 6 6l-2 2M6 8l-2 2a4 4 0 0 0 6 6l2-2M7 13l6-6'],
        ['image', 'Insert attached image', 'M3 3h14v14H3zM3 14l4-4 3 3 3-5 4 6M7 6h.01'],
        ['table', 'Insert table', 'M3 3h14v14H3zM3 8h14M8 3v14M3 12h14M12 8v9'],
        ['rule', 'Horizontal rule', 'M3 10h14']
      ];
      return `<div class="description-editor">
        <div class="description-toolbar" role="toolbar" aria-label="Markdown formatting">${tools.map(([format, label, path], index) => `${[4, 8, 10].includes(index) ? '<span class="editor-separator" aria-hidden="true"></span>' : ''}<button type="button" class="editor-tool" data-act="${format === 'image' ? 'toggle-description-images' : 'format-description'}" ${format === 'image' ? `aria-expanded="${!!draft.imagePicker}" aria-controls="description-image-picker"` : `data-format="${format}"`} aria-label="${label}" title="${label}" ${draft.preview ? 'disabled' : ''}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg></button>`).join('')}
          <button class="editor-tool editor-preview" data-act="preview-description" aria-pressed="${draft.preview}">${draft.preview ? 'Write' : 'Preview'}</button>
        <div id="description-image-picker" class="description-picker" role="region" aria-label="Attached images" ${!draft.imagePicker || draft.preview ? 'hidden' : ''}>
          <div class="description-picker-heading"><span>Insert attached image</span><button type="button" class="editor-tool" data-act="toggle-description-images" aria-label="Close image picker">&times;</button></div>
          <div class="description-image-options">${(attachments || []).filter(isImage).map(image => `<button class="btn" data-act="insert-description-image" data-image-id="${esc(image.id)}"><img data-image-id="${esc(image.id)}" alt="" draggable="false"><span>${esc(image.name)}</span></button>`).join('') || '<p class="muted">Upload an image in Attachments first.</p>'}</div>
        </div></div>
        <textarea data-f="desc" placeholder="Write a description using Markdown..." aria-label="Description" ${draft.preview ? 'hidden' : ''}>${esc(draft.text)}</textarea>
        ${draft.preview ? `<div class="description-preview markdown-body" data-act="preview-description" aria-label="Description preview">${descriptionHTML(card, attachments, draft.text)}</div>` : ''}
      </div>
      <div class="description-actions"><button class="btn primary" data-act="save-description">Save description</button><button class="btn" data-act="cancel-description">Cancel</button>
        <details class="markdown-help"><summary>Formatting guide</summary><p>Markdown supports headings, paragraphs, **bold**, *italic*, ~~strikethrough~~, links, images, lists, task lists, quotes, tables, horizontal rules and fenced code blocks.</p><pre># Heading
**bold** and *italic*
[Link](https://example.com)
- Item
- [ ] Task
&gt; Quote
\`inline code\`
\`\`\`js
const answer = 42;
\`\`\`
| Column | Value |
| --- | --- |
| Item | Text |</pre><p>Use Preview to see the result. HTML is displayed as text, not executed. Ctrl+Enter (or Cmd+Enter) saves; Escape cancels editing.</p></details>
      </div>`;
    }

    const actions = {
      'edit-description'() {
        const context = getContext();
        if (!context) return;
        descriptionDraft = { boardId: context.b.id, cardId: context.card.id, original: context.card.desc, text: context.card.desc, preview: false };
        focus('[data-f="desc"]');
        render();
      },
      'save-description'() {
        const context = getContext();
        if (!context || descriptionDraft?.cardId !== context.card.id || descriptionDraft.boardId !== context.b.id) return;
        const text = descriptionDraft.text;
        context.card.desc = text;
        save();
        descriptionDraft = null;
        focus('[data-act="edit-description"]');
        render();
      },
      async 'cancel-description'() {
        if (!await discardDescription()) return;
        focus('[data-act="edit-description"]');
        render();
      },
      'preview-description'() {
        if (!descriptionDraft) return;
        descriptionDraft.preview = !descriptionDraft.preview;
        descriptionDraft.imagePicker = false;
        if (!descriptionDraft.preview) focus('[data-f="desc"]');
        render();
      },
      'toggle-description-images'() {
        if (!descriptionDraft || descriptionDraft.preview) return;
        descriptionDraft.imagePicker = !descriptionDraft.imagePicker;
        focus(descriptionDraft.imagePicker ? '.description-picker [data-act="insert-description-image"], .description-picker [data-act="toggle-description-images"]' : '[data-act="toggle-description-images"]');
        render();
      },
      'format-description'(el) {
        const textarea = $('[data-f="desc"]');
        if (!descriptionDraft || !textarea || descriptionDraft.preview) return;
        const { start = textarea.value.length, end = start } = descriptionDraft.selection || {};
        const selected = textarea.value.slice(start, end);
        const wrappers = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], code: ['`', '`'], link: ['[', '](https://example.com)'], codeblock: ['\n```\n', '\n```\n'] };
        const prefixes = { heading: '## ', ul: '- ', ol: '1. ', task: '- [ ] ', quote: '> ' };
        let text, offset = 0, length = 0;
        if (wrappers[el.dataset.format]) {
          const [before, after] = wrappers[el.dataset.format], content = selected || 'text';
          text = before + content + after; offset = before.length; length = content.length;
        } else if (prefixes[el.dataset.format]) {
          const prefix = prefixes[el.dataset.format];
          text = (start && textarea.value[start - 1] !== '\n' ? '\n' : '') + (selected || 'text').split('\n').map(line => prefix + line).join('\n');
          offset = text.length; length = 0;
        } else {
          text = el.dataset.format === 'table' ? '\n\n| Column | Value |\n| --- | --- |\n| Item | Text |\n\n' : '\n\n---\n\n';
          offset = text.length;
        }
        textarea.setRangeText(text, start, end, 'select');
        textarea.focus();
        textarea.setSelectionRange(start + offset, start + offset + length);
        descriptionDraft.text = textarea.value;
        rememberEmojiTarget(textarea);
      },
      'insert-description-image'(el) {
        const context = getContext(), id = el.dataset.imageId;
        const image = getAttachments()?.find(item => item.id === id);
        if (!context?.card.imageIds?.includes(id) || !isImage(image)) {
          notify('Choose an image attached to this card.'); return;
        }
        const textarea = $('[data-f="desc"]');
        if (!descriptionDraft || !textarea) return;
        const selection = descriptionDraft.selection || { start: textarea.value.length, end: textarea.value.length };
        const name = String(image.name || 'Image').replace(/[\[\]\r\n]/g, ' ');
        const token = `![${name}](attachment:${id})`;
        textarea.setRangeText(token, Math.min(selection.start, textarea.value.length), Math.min(selection.end, textarea.value.length), 'end');
        descriptionDraft.text = textarea.value;
        descriptionDraft.imagePicker = false;
        $('.description-picker').hidden = true;
        $('[aria-controls="description-image-picker"]').setAttribute('aria-expanded', 'false');
        updateDescriptionPreview();
        textarea.focus();
        rememberEmojiTarget(textarea);
      },
    };

    function clear() { descriptionDraft = null; }
    function setText(text) {
      if (!descriptionDraft) return;
      descriptionDraft.text = text;
    }
    function rememberSelection(start, end) {
      if (descriptionDraft) descriptionDraft.selection = { start, end };
    }
    function removeImageReferences(card, id) {
      card.desc = card.desc.replace(descriptionImagePattern, (match, name, imageId) => imageId === id ? '' : match);
      if (descriptionDraft?.cardId === card.id) {
        descriptionDraft.text = descriptionDraft.text.replace(descriptionImagePattern, (match, name, imageId) => imageId === id ? '' : match);
        descriptionDraft.original = card.desc;
      }
    }
    const stripImages = text => text.replace(descriptionImagePattern, (match, label) => label);
    return { descriptionHTML, descriptionEditor, updateDescriptionPreview, discardDescription, actions, clear, setText, rememberSelection, removeImageReferences, stripImages, hasChanges: hasDescriptionChanges, get draft() { return descriptionDraft; } };
  }
  window.KanbayaDescriptionEditor = { create };
})();
