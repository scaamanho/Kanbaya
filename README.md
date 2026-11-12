# Kanbaya PWA

Static Kanban application with local IndexedDB storage using Dexie 4.2.1. No backend, CDN, npm, or build step is required to run it.

<img src="assets/dashboard.png" with=800>

## License

Except for third-party components, this project's code and documentation are licensed under [Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International](https://creativecommons.org/licenses/by-nc-nd/4.0/) (`CC-BY-NC-ND-4.0`). See [LICENSE](LICENSE) for the full legal terms.

The license permits noncommercial copying and sharing of the unadapted material with appropriate attribution, a link to the license, and preservation of supplied notices. You may produce adaptations for noncommercial purposes, but may not share adapted material under this license. Commercial use or sharing adaptations requires separate permission from the relevant rights holders, unless an applicable copyright exception permits it. The material is provided without warranty.

This is not an open-source software license. This declaration does not revoke permissions already granted under licenses for earlier versions.

Third-party components retain their own licenses; the project license does not replace them. Preserve the license files and applicable notices in [vendor/](app/vendor/) when redistributing or deploying the application. DOMPurify is used under its Apache-2.0 option.

## Running and deploying

The product website lives at the repository root, with screenshots in `assets/`. The application and its development files live in `app/`.

The application displays **Kanbaya v1.1.0** as non-interactive, secondary-colored text in the bottom-left footer on the home screen and boards. It does not open a dialog or navigate. On the home screen, the same footer contains the **Buy Me a Coffee** button on the right, without overlaying content. The product version is defined by `PRODUCT_VERSION` in `app/scripts/app.js` and is independent of worker/cache, database and backup versions.

Serve the repository directory over HTTPS, or localhost for development. For example, with Node installed:

```powershell
node app\tests\server.js
```

When the server starts, it prints a clickable link to the application: `http://127.0.0.1:8765/app/`. Open `http://127.0.0.1:8765/` for the product website. This server is for development only. For production, publish the root `index.html`, `site.css`, `site.js`, `assets/`, `info/`, and `LICENSE`, together with `app/index.html`, `app/manifest.webmanifest`, `app/sw.js`, and the `app/scripts/`, `app/css/`, `app/vendor/`, and `app/icons/` directories under the same `app/` path. Do not publish `node_modules/`, `tests/`, or test reports. Opening the HTML using `file:` does not provide the expected PWA functionality.

The website's **Install Kanbaya** button opens the application with an installation banner. Its **Install** button opens the native prompt when the browser provides one; otherwise it explains how to use the browser's install option. Availability depends on browser, device, and install status.

For Google Drive backups, see the [step-by-step Google Cloud setup guide (Spanish)](app/docs/GOOGLE_DRIVE_SETUP.md), including the OAuth configuration and usage instructions.

The public [Privacy Policy](info/privacy.html) and [Terms of Service](info/terms.html) are linked from the product website footer and work without JavaScript. Publish them before adding their full URLs in Google Auth Platform's Branding settings. Review these texts for your deployment, operator/contact details and applicable legal obligations; they describe the current implementation, not a guarantee of legal compliance or Google verification.

Dexie is bundled locally in [vendor/dexie.min.js](app/vendor/dexie.min.js), with its [Apache-2.0 license](app/vendor/dexie.LICENSE). Markdown uses bundled [Marked](app/vendor/marked.umd.js) ([MIT license](app/vendor/marked.LICENSE)) and [DOMPurify](app/vendor/purify.min.js) ([Apache-2.0 license](app/vendor/dompurify.LICENSE)). These libraries are not downloaded from a CDN when the application runs.

## Persistence

[storage.js](app/scripts/storage.js) centralizes the schema, queries, and transactions. The `kanbaya` IndexedDB database uses Dexie schema version 2 and separates `boards`, `lists`, `cards`, `cardDetails`, `images`, `templates`, and `settings`. Data and the initialization marker are committed together on first startup.
- Edits compare only loaded metadata and records against their committed snapshot. Only changed records and affected counters are written, rather than a JSON representation of all boards.
- Moving, deleting, importing, and undoing use transactions. Deletions include details and relationships. Undo restores only the affected operation and refuses to overwrite later revisions.
- Tabs are notified after a commit through BroadcastChannel; regaining focus also checks the revision. Writes based on an outdated revision are rejected to avoid overwriting another tab's changes.
- Text fields use a 300 ms debounce, except the description, which uses explicit Save/Cancel. Navigation, closing details, exporting, or activating an update waits for pending changes. Leaving with pending saves or a changed description draft requires confirmation; the application does not rely on completing a transaction while the browser is closing.
- Confirmation and name-entry dialogs use the application interface. When closing or reloading a browser tab with unsaved changes, the browser itself displays the unavoidable native warning.

## Loading and rendering

The home board search retains keyboard focus and the caret while filtering. Board names are sized using their rendered font metrics, wrap on narrow screens, and remain editable without clipping; long names on home tiles also wrap.

Use **Add card** in a lane's **List actions** menu or **Add a card** in its footer to open the focused card composer for that lane. Enter a title and submit with **Add card** or Enter; Escape cancels.

### Keyboard shortcuts

**Board menu > Keyboard shortcuts** shows the available keys:

- **N**: add a card in the focused list, or the first list if none is focused. Collapsed lists expand automatically.
- **L**: add a list.
- **/**: open card search and focus its keyword field.
- **F**: show/hide filters.
- **V**: switch between board and calendar.
- **M**: open the board menu.

These single-key shortcuts only run on an open board, outside text fields, editable content, dialogs, menus, drag operations and card/list composers. They ignore held keys, IME composition and modifier combinations, preserving browser and editor shortcuts. **N** and **L** require board view; **N** asks you to create a list if none exists.

Existing keys remain available: **Enter** opens a focused card or submits a card/list composer; **Up/Down** navigate cards in a virtual list; **Escape** cancels the active edit or closes a panel. In the description editor, **Ctrl/Cmd+Enter** saves, and **Ctrl/Cmd+B / I / K** insert bold, italic or a link.

### Lane actions and WIP

The lane menu also offers:

- **Collapse list / Expand list**: hide cards without loading their window, keeping the lane's normal width. The expand button restores it; **Add card** also expands it.
- **Set WIP limit...**: a non-negative integer, with **0 = unlimited**. WIP counts only **non-archived, incomplete** cards, including offscreen cards regardless of search or filters. A header badge shows usage/limit and highlights full or over-limit lanes. Completed cards do not consume WIP capacity; marking one incomplete does.
- **Duplicate list**: insert a full independent copy next to the source, preserving lane appearance, collapse state, WIP limit, ordering, archived/completed states, descriptions, checklists, comments and attachments. Card, checklist, comment and attachment identities are regenerated; local description image references are remapped. Undo removes the copy without touching the source.
- **Move all cards to...**: append all non-archived cards to another list in the same board, preserving order and details. Archived cards remain in the source. It includes offscreen cards and is undoable.
- **Sort by priority**: critical, high, medium, low, then no priority, preserving relative order for equal priorities. Existing name, due-date, newest, appearance, lane movement, archive and deletion actions remain available. Sorts include the whole list, not just its visible card window.

WIP is enforced inside the same IndexedDB transaction as card changes, for manual/batch creation, drag/drop, card moves, templates, duplication, restoration, reopening completed cards, import and Undo. If an operation increases WIP beyond the limit, **the entire operation rolls back**, including details and attachment writes, and a notification explains the refusal; the app remains editable. Reordering or editing existing cards does not consume extra capacity. Lowering a limit below current usage keeps every existing card and blocks increases until there is capacity. New imported/duplicated lanes must also satisfy their WIP limits. Undo cannot reintroduce cards beyond the resulting lane limit. Cross-tab revision checks still prevent stale writes.

Lane options are optional metadata in the existing `lists` store (`collapsed`, `wipLimit`); no schema upgrade or card rewrite is needed. WIP counts are derived from persisted cards, and options survive reloads, backups and import. The menu scrolls within the viewport on short/mobile screens. Expand a collapsed lane before dropping cards into it, or use **Move to list** / **Move all cards to...**.

[virtual.js](app/scripts/virtual.js) maintains windows of up to 60 cards per list, events per day, or archive/template rows, with measured heights, scroll overscan, and keyboard focus.

Startup queries metadata and counters. Boards retain result keys/positions and summary windows; full details are read when a card is opened. Windows for inactive boards are released from memory. Global operations that need all content, such as duplicating, sorting, archiving all cards, or exporting, load it temporarily: they do not operate only on visible cards.

The calendar queries the 42-day range once and groups the results. Days with many events scroll internally. Search preserves substring matching in titles, descriptions, labels, checklists, and comments; it uses derived text and current label names. **This is not a full-text index**: it must scan candidates, so its cost still grows with the number of cards. Results from previous views or searches are discarded.

## Card attachments and description images

The card sidebar places **Priority** above **Status & due date**, collapsed by default and styled like **Card appearance**. Its single **Mark as complete** checkbox completes or reopens the card, with or without a due date; completion also resolves its deadline. The collapsed heading shows **Completed** for finished cards. The optional date can be edited or removed without changing completion, and the section stays expanded while editing. Checklists remain independent.

The **Repeat task** control is temporarily hidden. Existing recurrence settings remain stored: completing a recurring card with a due date advances to its next date and keeps the card pending.

Open a card and use **Attachments > From your device** (multiple files supported, any file type) or **Add from URL**. URL attachments are downloaded once; the server must allow CORS and HTTPS pages cannot fetch insecure HTTP resources. Downloads time out after 30 seconds. Once saved, attachments are available offline.

Before persistence, the browser decodes and resizes each image to at most 1600 pixels on its longest side, then encodes it using `canvas.toBlob()` as WebP at quality 0.75 (PNG if the browser cannot encode WebP). Animated images become a still frame. Unsupported or damaged images are rejected with a notification; a multi-file upload is only saved after all files have been processed.

Other files use native `CompressionStream('gzip')` losslessly, including empty files. Download decompresses them automatically, preserving the original bytes, MIME type and filename (or the renamed filename). Already-compressed and very small files may not shrink. A browser supporting CompressionStream and DecompressionStream is required for these files; processing and download failures are notified explicitly.

For compatibility within the current schema, `imageIds` and `images` also represent non-image attachments; no IndexedDB schema change or data rewrite is needed. Cards contain only references and `coverImageId`, never file bytes. Records contain `id`, `boardId`, `cardId`, `blob`, `mime`, `size` (stored bytes), `name`, and `created`. Images have `kind: 'image'`, `width` and `height`; other files have `kind: 'file'`, `compression: 'gzip'`, and `originalSize`. Indexes remain `boardId`, `[boardId+cardId]`, and `created`. All bytes are binary `Blob` values, never base64. Visible image previews load separately using temporary object URLs, revoked when their elements are removed. `KanbayaStore.imageUsage()` sums all stored attachment sizes; the header meter uses `navigator.storage.estimate()` for overall origin usage, including caches.

Only images offer cover controls. The first image becomes the cover even if files were attached earlier. Use **Card appearance > Cover image**, **Make cover**, or the **Attachment options** menu to change/remove it. The menu also supports renaming, downloading, and deleting any attachment. Removing a cover does not delete the image. Deleting the cover selects the next remaining image, never a generic file. Adding another image while other images remain does not override an explicitly removed cover.

In the description toolbar, the **Insert attached image** icon next to the link icon opens a floating selector of this card's uploaded images, without adding a permanent row. Close it with the same icon, its close button, Escape, or by selecting an image. Select one to insert `![name](attachment:id)` at the last description cursor/selection (or at the end if it has not been focused). References persist offline and are remapped when duplicating cards/boards or importing backups, including Markdown reference definitions and angle-bracket destinations. Deleting an attachment removes the editor's generated inline references in the same undoable transaction; any remaining handwritten references show an unavailable-image placeholder. Personal templates remain text/checklist-only: generated inline image references become their label text, with an explicit notification that attachments are excluded.

Attachment additions, edits, and deletions participate in transactions and Undo. Deleting cards, lists, or boards removes their attachments atomically. Duplicates get independent attachment identities; deleting a duplicate does not affect the original. These are cascading deletions, not a global orphan-record cleanup.

## Markdown descriptions

Opening a card shows its rendered description, not a textarea and a duplicated preview. Click the description (including its empty placeholder) or **Edit description** to open a Markdown source editor with a compact, grouped icon toolbar (accessible labels and tooltips), **Preview / Write**, **Save description**, **Cancel**, and a local **Formatting guide**. Clicking the preview also returns to writing without losing the draft. Links and read-only task checkboxes retain their normal behavior. Toolbar controls wrap on narrow screens and share the application's theme colors.

The renderer supports CommonMark and GitHub-flavored Markdown: headings, paragraphs, emphasis, bold, strikethrough, links/autolinks, inline and reference images, nested ordered/unordered lists, read-only task checkboxes, blockquotes, inline/fenced code, horizontal rules, tables, escapes and hard line breaks. Language names on fenced code blocks are preserved; syntax highlighting, math, and nonstandard Markdown extensions are not included. Raw HTML is displayed as literal text rather than executed, and the resulting HTML is sanitized with DOMPurify. Links only allow HTTP, HTTPS and mailto destinations and open with `noopener noreferrer`. External Markdown images allow HTTP/HTTPS, load lazily without a referrer, and require a network connection; attached images remain local and work offline.

The editor stores a separate in-memory draft. Only **Save description** (or Ctrl+Enter / Cmd+Enter) changes the persisted Markdown. Editing other card properties or uploading attachments does not save that draft. **Cancel** or Escape leaves editing; abandoning changed text requires confirmation. Closing the card, navigation and browser unload also protect changed drafts. Update activation refuses an unsaved description. Ctrl+B / Cmd+B, Ctrl+I / Cmd+I and Ctrl+K / Cmd+K format the selection. A draft survives card-modal rerenders, but it is not a persistent autosave; save it before reloading. Recovery exports include a separate pending description draft when one exists.

## Offline support and updates

[boot.js](app/scripts/boot.js) checks the Service Worker version before loading scripts. [sw.js](app/sw.js) is scoped to `app/`, so it does not control the product website; it precaches the complete versioned resource set, including Dexie, and does not mix scripts from different versions. An update waits for explicit activation; pending writes are flushed and the user is asked to close other tabs before activation. After a successful first load, the application can be reloaded and edited offline.

When opening `app/` on the same origin after using version 23 at the repository root, the application unregisters the old root-scoped worker and reloads. Close other old application tabs first. Kanbaya starts with its own database; data from the previous product is not imported. Old installations need a network connection for this transition; the old root URL and installed shortcut should be replaced with `app/`.

When changing production resources, update the version in `app/scripts/boot.js`, `app/sw.js`, their precache entries, and the versioned references in `app/index.html` together. Do not change a published schema under the same version number: add a new Dexie version and its migration.

Product **1.1.0**, including Google Drive backups, uses coordinated asset/cache version **31**, so earlier installations can discover this release on their next online startup and offer **Activate update and reload**. Deploy the complete resource set at the same origin and application path; pushing to GitHub alone is not a deployment. Changing only `PRODUCT_VERSION` does not trigger an update. No database migration or reinstall is needed for this release.

## Backups and recovery

Data belongs to the **browser origin**; changing the domain, port, profile, or browser does not move the database. There is no cross-device synchronization. IndexedDB and persistent storage requests do not guarantee protection against profile deletion, quotas, private browsing, or browser eviction.

The application interface is in English. Regularly use **Data > Export all boards (backup)**. Export includes offscreen records. All complete backups, local and Google Drive, use the same `.kanbaya` binary format, whether or not they contain attachments: the eight-byte ASCII signature `KANBAYA4`, a four-byte little-endian JSON header length, the UTF-8 version 4 JSON header (including ordered attachment metadata in `images`), and the concatenated stored blobs (WebP/PNG/JPEG or gzip). There is no base64 conversion. Keep the whole file: both the JSON metadata and binary bytes are needed to restore attachments.

On failure, writes are blocked and recovery and reload options are offered:

- If IndexedDB is still readable: download a complete backup and the pending partial draft.
- If it cannot be read: download the available partial draft.
- A partial draft **is not a complete importable backup**. Do not delete the database or reload with an important draft without exporting it first.

Import accepts version 2 JSON and version 4 `.kanbaya`/`KANBAYA4` backups. It regenerates board, card, and attachment IDs and their references (including description images), so internal board links change. Older application versions cannot import version 4 backups. The existing "Delete all data" command deletes boards and their attachments but keeps the theme and templates.

### Google Drive backups

Use **Data > Save backup to Google Drive…** or **Import backup from Google Drive…**, then **Connect / change Google account**. Saving copies all boards, templates and attachments into the visible **Kanbaya Backups** folder, without overwriting earlier backups. Import lists backups created through this integration and adds independent copies of their boards using the same validation and formats as local import. Manually uploaded files are not listed; download those and use local import instead.

For an individual board, open **Board menu > Save this board to Google Drive…**. This includes only that board and its attachments, not other boards or personal templates, matching local board export. The filename includes the board name and a timestamp. Every save creates a new backup, never overwriting an earlier file. Individual-board and full backups share the same Drive import action.

[drive.js](app/scripts/drive.js) defines the public OAuth `CLIENT_ID`, requests only `drive.file`, and keeps access tokens in memory, never in IndexedDB, localStorage, sessionStorage or backups. Reloading requires reconnecting; closing the dialog does not sign out of Google or revoke previously granted permission. Expired/revoked authorization asks you to connect again. The integration uses resumable upload sessions, but does not automatically retry or resume interrupted transfers.

Opening a Drive dialog loads Google's Identity Services library from `https://accounts.google.com/gsi/client`; connecting contacts Google for consent. Saving sends the backup to Google Drive; listing and import also require Internet access. There is no automatic cloud sync. Core editing and local backups still work offline, and no Google request is needed at application startup. For local OAuth testing, authorize and open `http://localhost:8765`, not the different `127.0.0.1` origin. The production origin must also be authorized in Google Cloud.

## Development tests

npm manages Playwright and the pinned source packages used for vendored browser libraries; deployed pages need no npm installation:

```powershell
cd app
npm ci
npx playwright install chromium
npm run check
npm test
```

Run a specific test:

```powershell
npm test -- storage.spec.js --grep offline
```

Tests start a localhost server and use disposable browser profiles, synthetic data, and independent test databases. They do not read or modify the database in your regular profile. No CI pipeline or branch protection is configured by this change.

When updating Marked or DOMPurify, update their exact devDependency versions and lockfile, copy their browser distribution and license from `app/node_modules` into `app/vendor`, and bump the coordinated asset version. Do not fetch runtime scripts from a CDN.

Tests cover atomic initialization and rollback/retry, duplicate records, CRUD and cascading deletion, binary backups, lossless file compression/download, image compression and covers, explicit Markdown editing/saving/canceling, safe rendering and reference remapping, responsive editors, quota rollback, Undo, conflicts, schema changes, offline use, worker updates, keyboard navigation, mouse/touch dragging, bounded windows, and the English interface.

### Performance reference

Fixture: 10,000 cards, two boards with 5,000 each, a 1280 x 800 viewport, and Playwright Chromium. Local measurements across five warm runs; timings include automation overhead. These are not guaranteed limits or comparisons with localStorage.

| Operation | Median | Observed p95 |
|---|---:|---:|
| Reload and first cards | 498 ms | 500 ms |
| Scrolling to the end of 5,000 cards | 37 ms | 41 ms |
| Opening details | 168 ms | 199 ms |
| Editing and requested commit | 43 ms | 61 ms |
| Searching for offscreen text | 385 ms | 397 ms |
| JavaScript heap after GC | 6.1 MiB | 6.2 MiB |

The heap does not include IndexedDB storage or all browser memory. Initial database setup adds overhead and is not included in these reloads. No equivalent timing baseline was recorded for the previous version: the verified improvement is structural (no global writes, on-demand details, and a bounded DOM), not an estimated speedup factor.


### Test Local
python -m http.server 8766
netstat -ano | findstr :8766
tasklist /FI "PID eq 1234"
taskkill /PID 1234 /F


<a href="https://www.buymeacoffee.com/scaamanho" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" style="height: 30px !important;width: 100px !important;" ></a>