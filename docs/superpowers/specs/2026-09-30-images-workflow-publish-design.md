# Images, Workflow Editor, and Fork Publish — Design

Date: 2026-09-30
Fork: https://github.com/odarino/Backlog.md (upstream: MrLesk/Backlog.md, base version 1.53.0)
Package: `@odarino/backlog.md` (command stays `backlog`)

## Goals

1. Zoom in/out on images in the task view and edit modal.
2. Compress images automatically when they are added to a task.
3. Pick images from `backlog/assets/` in the markdown editor (plus upload, paste, drag-drop).
4. Edit the workflow (statuses) from the web UI.
5. Publish the fork to npm under the `@odarino` scope, with a README section that lists the fork features.

## Non-goals

- Asset management screen (rename, delete, unused-asset report). The picker is the only asset UI. The API shape leaves room for "list unused + delete" later.
- Transition rules, status automation, WIP limits, per-type workflows.
- Status colors in the TUI.
- CLI commands for status rename/remove or asset upload.
- Nix flake, website, TUI update checks for the fork.

## Build order

Each phase gets its own implementation plan and is mergeable alone.

1. Image zoom (lightbox).
2. WASM compression spike, then asset API + compression + editor integration.
3. Workflow editor.
4. Publish: package rename, CI publish, README fork section, release `v1.54.0`.

---

## 1. Image zoom (lightbox)

**Dependency:** `yet-another-react-lightbox` (devDependency, bundled), with the `Zoom` and `Counter` plugins and `yet-another-react-lightbox/styles.css`.

**Component:** `src/web/components/ImageLightbox.tsx`

- Props: `slides: { src: string; alt?: string }[]`, `index: number | null`, `onClose(): void`.
- `Zoom` plugin: wheel, double-click, pinch, drag to pan, max zoom 8x. `Counter` plugin shows "2 / 5".
- Esc or a click on the backdrop closes it. Arrow keys go to the next/previous image.
- No helper text or subtitles (project UI rule).

**Hook-in:** `src/web/components/ImageZoomScope.tsx`

- A wrapper component with one delegated `click` handler. A click on an `<img>` inside `.wmde-markdown` (and not inside a link) opens the lightbox.
- Slides = every such image inside the scope, in DOM order. In the task modal the scope wraps the whole modal body, so navigation crosses description, plan, notes and final summary, and it also covers the MDEditor live/preview pane in edit mode (edit mode uses `preview="edit"`, whose preview pane does not use `MermaidMarkdown`).
- Images get `cursor: zoom-in`. Images inside links keep their link behavior.
- `Modal` gets `suspendKeyHandling?: boolean`. While the lightbox is open, the task modal's document-level Escape/Tab handler steps aside, so Escape closes only the lightbox.
- `DocumentationDetail` and `DecisionDetail` wrap their view-mode markdown in the same scope.

**Tests:** unit test for image collection order (pure function over a DOM fragment).

---

## 2. Asset API and compression (server-side WASM)

### Why server-side WASM

The backend is Bun compiled to one binary per platform (`bun build --compile`, 6 targets).

- `sharp` needs a native `.node` addon plus the `libvips` shared library at runtime. The compiled binary cannot embed the shared library. Rejected.
- Browser canvas compression depends on the browser. Safari canvas cannot encode WebP. Rejected.
- `@jsquash/*` (Squoosh codecs: jpeg, png, webp, avif decode, resize) are pure WASM. Output is the same on every OS. `.wasm` files are embedded with `import path from "…wasm" with { type: "file" }`. Binary grows about 2–3 MB.

### Spike (first task of phase 2)

Prove that a compiled binary (`bun run build`) loads the embedded WASM codecs and compresses a JPEG fixture. Run it in CI on all 6 targets through `scripts/smoke-compiled-build.ts`. If the spike fails, stop and revisit this section before more work.

### Code layout

- `src/core/assets.ts`: list, save, compress, `_unsorted` move. No HTTP code.
- `src/server/assets.ts`: route handlers only. Routes are registered in `src/server/index.ts` next to the existing `/assets/*` route.

### `GET /api/assets?taskId=<id>`

- Scans `backlog/assets/` recursively for `png | jpg | jpeg | gif | webp | avif | svg`.
- Returns `[{ path, name, size, mtime, taskId }]`. `path` is the public URL (`/assets/images/back-123/x.webp`). `taskId` is the folder name under `images/` when it matches a task ID, else `null`.
- Sort: files of the requested task first, then newest first.

### `POST /api/assets?taskId=<id>&name=<original filename>`

- Body: raw file bytes. `taskId` is optional; without it the folder is `images/_unsorted/`.
- Limit: 25 MB, else `413`.
- The type comes from magic bytes. Unsupported type: `415`.
- Processing:
  1. GIF, SVG and AVIF: saved unchanged.
  2. JPEG, PNG, WebP: decode (JPEG with `preserveOrientation: true`, which applies the EXIF orientation), resize so the longest side is at most `image_max_dimension`, encode WebP at `image_quality`. If the result is not smaller than the input, keep the original bytes and extension. AVIF is saved unchanged, like GIF and SVG (its decoder is 1.2 MB of WASM and AVIF is already compact).
- File name: slug of the original name (`My Shot.png` becomes `my-shot`) plus the final extension. On collision add `-1`, `-2`, … Pasted images without a name use `paste-YYYYMMDD-HHmmss`.
- Target: `backlog/assets/images/<taskId>/` or `backlog/assets/images/_unsorted/`. The path check reuses the traversal guard from `handleAssetRequest`.
- Write to a temp file in the target folder, then rename. No partial files on failure.
- Decode failure: `422` with a message.
- Response `200`: `{ path, originalSize, finalSize, compressed }`.

### SVG safety

`/assets/*` responses for `.svg` get the header `Content-Security-Policy: sandbox`. This blocks scripts in uploaded SVG files when opened directly.

### Config

New `BacklogConfig` keys, parsed and serialized in `src/file-system/operations.ts`, shown as two number fields on the Settings page:

| config.yml key        | Type   | Default | Range   |
|-----------------------|--------|---------|---------|
| `image_max_dimension` | number | 1920    | 256–8192 |
| `image_quality`       | number | 0.8     | 0.1–1.0 |

### `_unsorted` move on task create

After a task create succeeds (in the server create handler, right after `createTaskFromInput`), core scans the task's markdown fields for links to `/assets/images/_unsorted/…`. Each linked file moves to `images/<newId>/` (name collision rules apply), and the links are rewritten in one task update. If another task or draft also links to the same `_unsorted` file, the file is copied instead of moved.

Drafts use their own ID as the folder (`images/draft-3/`). When a draft is promoted to a task, the files stay where they are and the links stay valid. No move happens on promotion.

### Tests

- Core: JPEG fixture becomes a smaller WebP; JPEG with EXIF orientation 6 is rotated; GIF, SVG and AVIF pass through unchanged; output that is not smaller keeps the original; corrupt file raises an error and leaves no file; name collision suffixes; path traversal rejected; `_unsorted` move rewrites links and copies shared files.
- Server: one route test per status code (200, 413, 415, 422).
- Compiled binary: smoke test compresses one fixture.

---

## 3. Editor integration

### `MarkdownEditor.tsx`

New wrapper around `MDEditor` in `src/web/components/`. Same `value` / `onChange` props plus `taskId?: string`. The 4 `MDEditor` instances in `TaskDetailsModal.tsx` (description, plan, notes, final summary) use it. All image logic lives here.

### Toolbar command

A custom MDEditor command with an image icon opens `AssetPickerModal`.

### `AssetPickerModal.tsx`

- Loads `GET /api/assets?taskId=`.
- Thumbnail grid (`loading="lazy"`), filename search, two groups: "This task" and "All assets".
- Click toggles selection. **Insert** puts one `![name](path)` line per selected image at the cursor. Double-click inserts one image at once.
- **Upload** button: file input with `multiple` and `accept="image/*"`. Each file is posted in sequence. New images appear at the top, already selected.
- Empty state: the grid area with the Upload button only.

### Paste and drag-drop

- `onPaste` and `onDrop` through `textareaProps`. Only clipboard/drop data with image files is handled. Text paste is unchanged.
- At the cursor, insert `![Uploading <name>…]()` at once. On success, replace it with the real link. On failure, remove it and show an error toast.
- Several images upload in sequence, one placeholder each, in order.

### Feedback

Toast through the existing `SuccessToast`: `Compressed 3.2 MB → 180 KB`, or `Saved (not compressed)`.

### Tests (colocated `*.test.ts` in `src/web`)

- Placeholder insert, replace, remove at a cursor position (pure function).
- Text-only paste is ignored.
- Markdown output for a multi-select insert.

---

## 4. Workflow editor

### UI

A "Workflow" block in `src/web/components/Settings.tsx`, above "Default Status".

- One row per status: drag handle, color swatch (`<input type="color">`), inline name edit, delete (×).
- The last row shows a **Done** badge (terminal status, `getTerminalStatus`).
- "Add status" inserts the new status second-to-last, so the done status does not change by accident.
- Changes stay local until **Save workflow**. On save: renames and removes first, then one config write for order, additions and colors.

### Validation (client for fast feedback, server is the authority)

- Name not empty, unique (case-insensitive), not `Draft` (reserved).
- At least 2 statuses.

### Delete

If tasks use the status, a dialog shows "N tasks use '<status>'. Move them to: [select]". The select lists the remaining statuses. If no task uses it, the status is removed without a dialog.

### Server

- `POST /api/statuses/rename` body `{ from, to }`.
- `POST /api/statuses/remove` body `{ status, moveTo }`.
- Order, additions and colors use the existing config save endpoint.

### Core

One implementation in core for rename and remove:

- Rewrites `status:` in all local task files under `tasks/`, `completed/` and `archive/tasks/` (drafts always have status `Draft`, so they are skipped). Each file is saved under its task lock with only `status` changed; `onStatusChange` callbacks do not run. On failure, already rewritten tasks are restored.
- `PUT /api/config` may reorder statuses and add new ones, but it rejects a list that drops or renames an existing status (409); only the rename and remove endpoints do that. `GET /api/statuses/usage` returns task counts for the delete dialog.
- A long-running MCP server keeps its old status list until it restarts (documented limit).
- Updates `default_status` on rename. On remove of the default status, `default_status` becomes the first status.
- With `auto_commit` on, all changed files go into one git commit.
- Tasks that exist only on other git branches are not rewritten. They show an unknown status until merged. This limit is documented, not handled.

### Colors

New config key `status_colors` (map of status name to hex color, written as a JSON-quoted flow map). Rename and remove update the map. Board column headers and the task list status chip use it (board cards have no status chip). A status without a color keeps the current default style. Web UI only.

### Tests

- Core: rename rewrites tasks in all 4 folders and `default_status`; remove moves tasks to the target; invalid names rejected; removing below 2 statuses rejected; `status_colors` follows rename/remove.
- Config: `status_colors` round-trips through parse and serialize.
- Server: route test per endpoint.

---

## 5. Publish as `@odarino/backlog.md`

### Name changes

- `package.json`: `name` → `@odarino/backlog.md`; `repository`, `bugs`, `homepage` → `odarino/Backlog.md`; `optionalDependencies` → `@odarino/backlog.md-{darwin,linux,windows}-{arm64,x64}`.
- `scripts/resolveBinary.cjs`: package name template.
- `scripts/postuninstall.cjs`: platform package list.
- `scripts/cli.cjs`: install hints in error messages.
- `.github/workflows/release.yml`: matrix package names, the `repository` jq line, verify and install-sanity steps. Add a workflow-level `env: NPM_SCOPE: "@odarino"` and build names from it.

### Auth

- Every `npm publish` uses `--access public` (scoped packages are private by default).
- Publish steps get `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Keep `--provenance` (`id-token: write` already exists; the fork is public).
- Check that the `sync-version` job can push to `main` on the fork with `GITHUB_TOKEN`.

### One-time setup by the owner

1. Create the npm scope `@odarino` (user or org).
2. Create a granular access token with read/write for `@odarino/*`.
3. Add it as the Actions secret `NPM_TOKEN` in `odarino/Backlog.md`.
4. Enable Actions on the fork.

### README

Add a "Fork features" section near the top of `README.md`: install command (`npm i -g @odarino/backlog.md`), a note that it conflicts with a global `backlog.md` install, and one short entry per feature (image zoom, image picker + upload/paste/drop, automatic compression with the two config keys, workflow editor).

### Release

Bump `package.json` to `1.54.0`, push tag `v1.54.0`. CI builds 6 binaries, publishes 7 packages, runs install sanity, and creates the GitHub release.

### Upstream sync

Add remote `upstream` = `MrLesk/Backlog.md`. New code lives in new files where possible (`src/core/assets.ts`, `src/server/assets.ts`, `MarkdownEditor.tsx`, `AssetPickerModal.tsx`, `ImageLightbox.tsx`) to keep merges small.

---

## Project rules that apply

- Read `MANIFESTO.md` before implementation. Do not edit it.
- Biome (tabs, double quotes), Bun test runner.
- Definition of done: `bunx tsc --noEmit`, `bun run check .`, `bun test` all pass.
- Backlog tasks are managed with the `backlog` CLI only, never by direct edits of backlog markdown files.
