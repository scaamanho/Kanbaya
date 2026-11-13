# Kanbaya technical documentation

Architecture, implementation contracts, deployment and maintenance reference. Project presentation, licensing, local startup and user-facing instructions remain in [README.md](README.md).

## Contents

- [Deployment and runtime resources](#deployment-and-runtime-resources)
- [Application modules](#application-modules)
- [Persistence and transactions](#persistence-and-transactions)
- [Loading, rendering and search](#loading-rendering-and-search)
- [Lane metadata and WIP enforcement](#lane-metadata-and-wip-enforcement)
- [Attachment storage and processing](#attachment-storage-and-processing)
- [Markdown rendering and drafts](#markdown-rendering-and-drafts)
- [PWA loading, versions and releases](#pwa-loading-versions-and-releases)
- [Backup format and compatibility](#backup-format-and-compatibility)
- [Google Drive integration](#google-drive-integration)
- [Development tests](#development-tests)
- [Performance reference](#performance-reference)

## Deployment and runtime resources

The product website lives at the repository root, with screenshots in [assets/](assets/). The application and its development files live in [app/](app/). Serve the repository over HTTPS, or localhost for development; opening HTML using `file:` does not provide the expected PWA functionality. Local server commands are in [Running and deploying](README.md#running-and-deploying).

For production, publish the root `index.html`, `site.css`, `site.js`, `assets/`, `info/`, and `LICENSE`, together with `app/index.html`, `app/manifest.webmanifest`, `app/sw.js`, and the `app/scripts/`, `app/css/`, `app/vendor/`, and `app/icons/` directories under the same `app/` path. Do not publish `node_modules/`, `tests/`, or test reports. Deploy the complete resource set at the same origin and application path; pushing to GitHub alone is not a deployment.

The public [Privacy Policy](info/privacy.html) and [Terms of Service](info/terms.html) work without JavaScript. Publish them before adding their full URLs in Google Auth Platform's Branding settings. Review the deployment-specific legal details as described in the README.

Dexie is bundled locally in [vendor/dexie.min.js](app/vendor/dexie.min.js), with its [Apache-2.0 license](app/vendor/dexie.LICENSE). Markdown uses bundled [Marked](app/vendor/marked.umd.js) ([MIT license](app/vendor/marked.LICENSE)) and [DOMPurify](app/vendor/purify.min.js) ([Apache-2.0 license](app/vendor/dompurify.LICENSE)). These libraries are not downloaded from a CDN when the application runs. Preserve their licenses and notices when deploying or redistributing.

The home screen displays the product version as non-interactive, secondary-colored text in the bottom-left footer. It does not open a dialog or navigate. The same footer contains the **Buy Me a Coffee** button on the right, without overlaying content. Boards do not show the footer.

## Application modules

[app.js](app/scripts/app.js) composes the application and owns navigation, shared UI/data state, action dispatch, virtual-view mounting and the serialized `run` / `flush` save cycle. Feature modules receive specific data or callbacks instead of a shared application-state container:

- [model.js](app/scripts/model.js): board/card creation, normalization, structural copies, sample data and date calculations.
- [backup-merge.js](app/scripts/backup-merge.js): conflict detection and preferred-version merging, without mutating the input boards or accessing storage.
- [dialogs.js](app/scripts/dialogs.js): confirmations, text/URL input, conflict choices and popup menus; menu actions use the application's serialized executor.
- [description-editor.js](app/scripts/description-editor.js): Markdown rendering, formatting, preview, selection and the private description draft. Save/discard remains coordinated with navigation and persistence.
- [attachments.js](app/scripts/attachments.js): image optimization, lossless file compression, lazy previews and temporary object-URL cleanup. Application actions still stage attachment mutations through the existing store.
- [timeline.js](app/scripts/timeline.js): timeline markup and pointer gestures. Date commits return to the application executor, which checks concurrent revisions before saving.

[boot.js](app/scripts/boot.js) loads these browser scripts in dependency order; no bundler or new runtime dependency is needed. Every loaded module must also be included in [sw.js](app/sw.js)'s precache for offline startup, and in `npm run check` in [package.json](app/package.json). Adding precache entries does not itself change the worker/cache version; coordinate release activation before publishing changes to an already-cached installation.

## Persistence and transactions

[storage.js](app/scripts/storage.js) centralizes the schema, queries, and transactions. The `kanbaya` IndexedDB database uses Dexie schema version 2 and separates `boards`, `lists`, `cards`, `cardDetails`, `images`, `templates`, and `settings`. Data and the initialization marker are committed together on first startup.

- Edits compare only loaded metadata and records against their committed snapshot. Only changed records and affected counters are written, rather than a JSON representation of all boards.
- Moving, deleting, importing, and undoing use transactions. Deletions include details and relationships. Undo restores only the affected operation and refuses to overwrite later revisions.
- Tabs are notified after a commit through BroadcastChannel; regaining focus also checks the revision. Writes based on an outdated revision are rejected to avoid overwriting another tab's changes.
- Text fields use a 300 ms debounce, except the description, which uses explicit Save/Cancel. Navigation, closing details, exporting, or activating an update waits for pending changes. Leaving with pending saves or a changed description draft requires confirmation; the application does not rely on completing a transaction while the browser is closing.
- Confirmation and name-entry dialogs use the application interface. When closing or reloading a browser tab with unsaved changes, the browser itself displays the unavoidable native warning.

Open-tab preferences are stored separately from board backups. User-facing tab behavior is described in [Using boards](README.md#using-boards).

## Loading, rendering and search

[virtual.js](app/scripts/virtual.js) maintains windows of up to 60 cards per list, events per day, timeline, or archive/template rows, with measured heights, scroll overscan, and keyboard focus.

Startup queries metadata and counters. Boards retain result keys/positions and summary windows; full details are read when a card is opened. Windows for inactive boards are released from memory. Global operations that need all content, such as duplicating, sorting, archiving all cards, or exporting, load it temporarily: they do not operate only on visible cards.

The calendar queries the 42-day range once and groups the results. Search preserves substring matching in titles, descriptions, labels, checklists, and comments; it uses derived text and current label names. **This is not a full-text index**: it must scan candidates, so its cost still grows with the number of cards. Results from previous views or searches are discarded.

The initial sample board has date ranges within its creation month. An existing board named **My first board** with all five original card titles receives those dates once, only on cards that have neither date; existing dates are never replaced. Clearing dates later does not restore them.

## Lane metadata and WIP enforcement

Lane options are optional metadata in the existing `lists` store (`collapsed`, `wipLimit`); no schema upgrade or card rewrite is needed. WIP counts are derived from persisted cards, and options survive reloads, backups and import. WIP counts only non-archived, incomplete cards, including offscreen cards regardless of search or filters; `0` means unlimited.

WIP is enforced inside the same IndexedDB transaction as card changes, for manual/batch creation, drag/drop, card moves, templates, duplication, restoration, reopening completed cards, import and Undo. If an operation increases WIP beyond the limit, **the entire operation rolls back**, including details and attachment writes, and a notification explains the refusal; the app remains editable. Reordering or editing existing cards does not consume extra capacity. Lowering a limit below current usage keeps every existing card and blocks increases until there is capacity. New imported/duplicated lanes must also satisfy their WIP limits. Undo cannot reintroduce cards beyond the resulting lane limit. Cross-tab revision checks still prevent stale writes.

## Attachment storage and processing

Before persistence, the browser decodes and resizes each image to at most 1600 pixels on its longest side, then encodes it using `canvas.toBlob()` as WebP at quality 0.75 (PNG if the browser cannot encode WebP). Animated images become a still frame. Unsupported or damaged images are rejected with a notification; a multi-file upload is only saved after all files have been processed.

Other files use native `CompressionStream('gzip')` losslessly, including empty files. Download decompresses them automatically, preserving the original bytes, MIME type and filename (or the renamed filename). Already-compressed and very small files may not shrink. A browser supporting CompressionStream and DecompressionStream is required for these files; processing and download failures are notified explicitly.

For compatibility within the current schema, `imageIds` and `images` also represent non-image attachments; no IndexedDB schema change or data rewrite is needed. Cards contain only references and `coverImageId`, never file bytes. Records contain `id`, `boardId`, `cardId`, `blob`, `mime`, `size` (stored bytes), `name`, and `created`. Images have `kind: 'image'`, `width` and `height`; other files have `kind: 'file'`, `compression: 'gzip'`, and `originalSize`. Indexes remain `boardId`, `[boardId+cardId]`, and `created`. All bytes are binary `Blob` values, never base64. Visible image previews load separately using temporary object URLs, revoked when their elements are removed. `KanbayaStore.imageUsage()` sums all stored attachment sizes; the header meter uses `navigator.storage.estimate()` for overall origin usage, including caches.

Attachment additions, edits, and deletions participate in transactions and Undo. Deleting cards, lists, or boards removes their attachments atomically. Duplicates get independent attachment identities; deleting a duplicate does not affect the original. These are cascading deletions, not a global orphan-record cleanup.

Description references use `![name](attachment:id)` and are remapped when duplicating cards/boards or importing backups, including Markdown reference definitions and angle-bracket destinations. Deleting an attachment removes the editor's generated inline references in the same undoable transaction; any remaining handwritten references show an unavailable-image placeholder. Personal templates remain text/checklist-only: generated inline image references become their label text, with an explicit notification that attachments are excluded.

## Markdown rendering and drafts

Markdown uses bundled Marked and DOMPurify. Raw HTML is displayed as literal text rather than executed, and the resulting HTML is sanitized with DOMPurify. Links only allow HTTP, HTTPS and mailto destinations and open with `noopener noreferrer`. External Markdown images allow HTTP/HTTPS, load lazily without a referrer, and require a network connection; attached images remain local and work offline. Supported syntax and editor controls are listed in [Markdown descriptions](README.md#markdown-descriptions).

The editor stores a separate in-memory draft. Only **Save description** (or Ctrl+Enter / Cmd+Enter) changes the persisted Markdown. Editing other card properties or uploading attachments does not save that draft. **Cancel** or Escape leaves editing; abandoning changed text requires confirmation. Closing the card, navigation and browser unload also protect changed drafts. Update activation refuses an unsaved description. A draft survives card-modal rerenders, but it is not a persistent autosave; save it before reloading. Recovery exports include a separate pending description draft when one exists.

## PWA loading, versions and releases

[boot.js](app/scripts/boot.js) checks the Service Worker version before loading scripts. [sw.js](app/sw.js) is scoped to `app/`, so it does not control the product website; it precaches the complete versioned resource set, including Dexie, and does not mix scripts from different versions. An update waits for explicit activation; pending writes are flushed and the user is asked to close other tabs before activation. After a successful first load, the application can be reloaded and edited offline.

The product version is defined by `PRODUCT_VERSION` in [app.js](app/scripts/app.js) and is independent of worker/cache, database and backup versions. Changing only `PRODUCT_VERSION` does not trigger an update.

Worker/cache version changes require explicit release authorization. When an asset release is authorized, update the `VERSION` constants in [boot.js](app/scripts/boot.js) and [sw.js](app/sw.js), and the versioned references in [index.html](app/index.html) together. The loader and the worker's versioned precache URLs derive their query parameter from their respective `VERSION` constant; no per-resource version edits are needed in the worker. Keep the precache resource list complete when adding or removing modules. Do not change a published schema under the same version number: add a new Dexie version and its migration.

Product **1.1.0**, including Google Drive backups and the modular application scripts, uses coordinated asset/cache version **40**, so earlier installations can discover this release on their next online startup and offer **Activate update and reload**. No database schema migration or reinstall is needed for this release.

When opening `app/` on the same origin after using version 23 at the repository root, the application unregisters the old root-scoped worker and reloads. Close other old application tabs first. Kanbaya starts with its own database; data from the previous product is not imported. Old installations need a network connection for this transition; the old root URL and installed shortcut should be replaced with `app/`.

## Backup format and compatibility

All complete backups, local and Google Drive, use the same `.kanbaya` binary format, whether or not they contain attachments:

1. The eight-byte ASCII signature `KANBAYA4`.
2. A four-byte little-endian JSON header length.
3. The UTF-8 version 4 JSON header, including ordered attachment metadata in `images`.
4. The concatenated stored blobs (WebP/PNG/JPEG or gzip).

There is no base64 conversion. Keep the whole file: both the JSON metadata and binary bytes are needed to restore attachments.

Import accepts version 2 JSON and version 4 `.kanbaya`/`KANBAYA4` backups. Boards with matching IDs are merged; lanes, cards and labels found in only one version are retained. For conflicting board settings, lists, card contents or card positions, the user chooses which version takes precedence for that board. The chosen version supplies each conflicting card as a whole, including its attachments; attachments unique to the other version of that card are not retained. Cancelling leaves all boards unchanged.

The application cannot distinguish a deletion from a new item without a shared history, so a deleted item present in the other version is kept. Boards imported by older versions were assigned new IDs and cannot be matched automatically. Templates are imported as copies. Older application versions cannot import version 4 backups. Start dates are preserved in backups and duplicates; older backups without them remain compatible. The existing "Delete all data" command deletes boards and their attachments but keeps the theme and templates.

Data belongs to the browser origin; changing the domain, port, profile, or browser does not move the database. IndexedDB and persistent storage requests do not guarantee protection against profile deletion, quotas, private browsing, or browser eviction. User-facing export and failure-recovery instructions are in [Backups and recovery](README.md#backups-and-recovery).

## Google Drive integration

[drive.js](app/scripts/drive.js) defines the public OAuth `CLIENT_ID`, requests only `drive.file`, and keeps access tokens in memory, never in IndexedDB, localStorage, sessionStorage or backups. Reloading requires reconnecting; closing the dialog does not sign out of Google or revoke previously granted permission. Expired/revoked authorization asks the user to connect again. The integration uses resumable upload sessions, but does not automatically retry or resume interrupted transfers.

Opening a Drive dialog loads Google's Identity Services library from `https://accounts.google.com/gsi/client`; connecting contacts Google for consent. Saving sends the backup to Google Drive; listing and import also require Internet access. There is no automatic cloud sync. Core editing and local backups still work offline, and no Google request is needed at application startup.

For local OAuth testing, authorize and open `http://localhost:8765`, not the different `127.0.0.1` origin. The production origin must also be authorized in Google Cloud. See the [step-by-step Google Cloud setup guide (Spanish)](app/docs/GOOGLE_DRIVE_SETUP.md) for OAuth configuration and [Google Drive backups](README.md#google-drive-backups) for usage.

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

Tests start a localhost server and use disposable browser profiles, synthetic data, and independent test databases. They do not read or modify the database in your regular profile. No CI pipeline or branch protection is configured by this documentation split.

When updating Marked or DOMPurify, update their exact devDependency versions and lockfile, and copy their browser distribution and license from `app/node_modules` into `app/vendor`. Publish them with a coordinated asset version change only after release authorization. Do not fetch runtime scripts from a CDN.

Tests cover atomic initialization and rollback/retry, duplicate records, CRUD and cascading deletion, binary backups, lossless file compression/download, image compression and covers, explicit Markdown editing/saving/canceling, safe rendering and reference remapping, responsive editors, quota rollback, Undo, conflicts, schema changes, offline use, worker updates, keyboard navigation, mouse/touch dragging, bounded windows, and the English interface.

## Performance reference

Fixture: 10,000 cards, two boards with 5,000 each, a 1280 x 800 viewport, and Playwright Chromium. Local measurements across five warm runs; timings include automation overhead. These are historical reference measurements retained from the README, not guaranteed limits, a fresh benchmark of the current checkout, or comparisons with localStorage.

| Operation | Median | Observed p95 |
|---|---:|---:|
| Reload and first cards | 498 ms | 500 ms |
| Scrolling to the end of 5,000 cards | 37 ms | 41 ms |
| Opening details | 168 ms | 199 ms |
| Editing and requested commit | 43 ms | 61 ms |
| Searching for offscreen text | 385 ms | 397 ms |
| JavaScript heap after GC | 6.1 MiB | 6.2 MiB |

The heap does not include IndexedDB storage or all browser memory. Initial database setup adds overhead and is not included in these reloads. No equivalent timing baseline was recorded for the previous version: the verified improvement is structural (no global writes, on-demand details, and a bounded DOM), not an estimated speedup factor.
