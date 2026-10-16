# Image paste fix and upload mode (convert / original)

## Goal

1. Pasting an image into a task rich-text field (create and edit) works on Windows.
2. Every image upload lets the user choose **Convert (WebP)** or **Original**, with a preview of the converted result before anything is saved.
3. CLI and MCP can add an asset with the same choice.

Out of scope: random task IDs (separate spec).

## Root cause of the paste bug

`imageFilesFrom` (`src/web/lib/markdown-image-insert.ts`) reads only `clipboardData.files` and keeps only files whose `type` starts with `image/`. On Windows, copying a file from Explorer can give an empty `type`, and some browsers expose the image only through `clipboardData.items`. Both cases silently drop the image.

## Design

### Clipboard extraction

- `imageFilesFrom` accepts a `DataTransfer` and reads both `files` and `items` (`kind === "file"`).
- Drop duplicates (same name + size + lastModified).
- When `type` is empty, infer it from the extension: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.avif`. Unknown extension: skip.
- Paste and drop both use this one helper.

### Server

- `POST /api/assets` takes an extra form field `mode`: `convert` (default, current behavior) or `original`. `original` skips `compressImage` and stores the bytes as-is.
- New `POST /api/assets/preview`: runs `compressImage` on the upload and returns `{ dataUrl, originalSize, finalSize, mime, compressed }`. It writes nothing to disk.
- Both paths share the existing code in `src/core/assets.ts`; the save function gains one `mode` option. No second conversion implementation.

### Web dialog `ImageUploadDialog`

- Opens on paste, drop, and file pick in `TaskMarkdownEditor`.
- Shows each image with a toggle **Convert** | **Original**, thumbnails, and sizes ("2.4 MB → 310 KB"). Default: Convert.
- One choice applies to all images in the batch.
- Buttons: **Insert** (uploads, then inserts markdown at the saved cursor position) and **Cancel** (nothing is uploaded).
- If preview fails or the type cannot convert (GIF, SVG), the dialog shows Original only, with a one-line reason.
- Upload errors use the existing toast.

### CLI

`backlog asset add <file> [--task <id>] [--original]`

- Prints the saved path and markdown snippet.
- Without `--task`, the asset goes to the unsorted folder, same as the web create form.

### MCP

Tool `asset_add` with `{ path: string, taskId?: string, original?: boolean }`. Returns the saved path, markdown snippet, and sizes. Document it in the shipped MCP instructions.

## Testing

- Unit: `imageFilesFrom` with empty `type`, with `items` only, with duplicates.
- Core: save with `mode: "original"` keeps bytes unchanged; preview writes no file.
- Component: dialog toggle, Insert, Cancel, Original-only fallback.
- CLI and MCP: `asset add` with and without `--original`.
