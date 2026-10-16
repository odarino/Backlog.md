# Image Paste, Upload Mode, and Random Task IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Windows image paste (BACK-711), let every image upload choose Convert or Original with a preview, plus CLI/MCP asset add (BACK-712), and add an opt-in random numeric task ID mode (BACK-713).

**Architecture:** One conversion path stays in `src/core/assets.ts` (`saveAsset` gains `mode`, new `previewAsset`). Web, CLI, and MCP all call it. The web gets one `ImageUploadDialog` used by paste, drop, and the asset picker. Random IDs are one branch inside `generateNextId` in `src/utils/prefix-config.ts`, switched by a new `taskIdMode` config key.

**Tech Stack:** Bun, TypeScript 5, React 18, `@uiw/react-md-editor`, Bun test runner, Biome.

## Global Constraints

- Branch `tasks/back-711-713-images-and-random-ids`. Commit per task. **Do not push.**
- Commit format: `BACK-<id> - <title>`, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- `taskIdMode` default is `sequential`; existing repos must not change behavior.
- Random IDs: 6 digits, range `100000–999999`, `crypto.getRandomValues`, 50 tries max, tasks only.
- Upload mode values: `convert` (default) and `original`.
- No subtitles or helper copy in UI beyond what the spec requires (CLAUDE.md "UI descriptions").
- Before each commit: `bunx tsc --noEmit` and `bun run check .` pass.
- Use the `backlog` CLI (`bun src/cli.ts`) for task status/notes; never edit task files by hand. Read `bun src/cli.ts instructions task-execution` before starting.

## File Map

| File | Change |
|---|---|
| `src/web/lib/markdown-image-insert.ts` | `imageFilesFrom` reads `DataTransfer` files + items, infers type from extension, dedupes |
| `src/core/assets.ts` | `UploadMode` type, `mode` on `saveAsset`, new `previewAsset` |
| `src/server/index.ts` | `mode` query param on `POST /api/assets`; new `POST /api/assets/preview` |
| `src/web/lib/api.ts` | `uploadAsset(..., mode)`, new `previewAsset(file)` |
| `src/web/components/ImageUploadDialog.tsx` | **new** dialog: toggle, thumbnails, sizes, Insert/Cancel |
| `src/web/components/TaskMarkdownEditor.tsx` | paste/drop open dialog; insert at saved selection |
| `src/web/components/AssetPickerModal.tsx` | file pick opens dialog |
| `src/cli.ts` | `asset add` command; `taskIdMode` config get/set/help |
| `src/mcp/tools/assets/{index,schemas}.ts` | **new** `asset_add` tool |
| `src/mcp/server.ts` | register asset tools |
| `src/utils/prefix-config.ts` | random branch in `generateNextId` |
| `src/core/backlog.ts`, `src/file-system/operations.ts` | pass `taskIdMode` to `generateNextId`; parse/serialize `task_id_mode` |
| `src/types/index.ts` | `taskIdMode?: "sequential" \| "random"` on `BacklogConfig` |
| `src/web/components/Settings.tsx` | `taskIdMode` select |
| Agent instruction sources (`src/guidelines/*` or wherever `zeroPaddedIds` is documented — find with `grep -rn zeroPaddedIds src/guidelines src/mcp`) | document `taskIdMode`, `asset add`, `asset_add` |

---

### Task 1: Robust clipboard image extraction (BACK-711)

**Files:**
- Modify: `src/web/lib/markdown-image-insert.ts:36-38`
- Modify: `src/web/components/TaskMarkdownEditor.tsx:96,112`
- Test: `src/web/lib/markdown-image-insert.test.ts`

**Interfaces:**
- Produces: `imageFilesFrom(source: DataTransfer | FileList | File[] | null | undefined): File[]` — returned files always have an `image/*` type.

- [ ] **Step 1: Start task**

```bash
bun src/cli.ts task edit BACK-711 -s "In Progress" -a @claude
```

- [ ] **Step 2: Write failing tests** (append inside the existing `describe("imageFilesFrom")`)

```ts
	it("infers the type from the extension when the type is empty", () => {
		const file = new File([new Uint8Array([1])], "shot.PNG", { type: "" });
		const [out] = imageFilesFrom([file]);
		expect(out?.type).toBe("image/png");
		expect(out?.name).toBe("shot.PNG");
	});

	it("skips empty-type files with an unknown extension", () => {
		expect(imageFilesFrom([new File(["x"], "notes.txt", { type: "" })])).toEqual([]);
	});

	it("reads files exposed only through DataTransfer items", () => {
		const png = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
		const transfer = {
			files: [] as unknown as FileList,
			items: [{ kind: "file", getAsFile: () => png }] as unknown as DataTransferItemList,
		} as DataTransfer;
		expect(imageFilesFrom(transfer)).toEqual([png]);
	});

	it("returns a file once when files and items both expose it", () => {
		const png = new File([new Uint8Array([1])], "image.png", { type: "image/png", lastModified: 5 });
		const transfer = {
			files: [png] as unknown as FileList,
			items: [{ kind: "file", getAsFile: () => png }] as unknown as DataTransferItemList,
		} as DataTransfer;
		expect(imageFilesFrom(transfer)).toHaveLength(1);
	});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `bun test --timeout=10000 src/web/lib/markdown-image-insert.test.ts`
Expected: the 4 new tests fail.

- [ ] **Step 4: Implement** (replace lines 36-38)

```ts
const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
};

function withImageType(file: File): File | null {
	if (file.type.startsWith("image/")) return file;
	if (file.type) return null;
	const type = IMAGE_TYPE_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""];
	return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : null;
}

function isDataTransfer(source: unknown): source is DataTransfer {
	return typeof source === "object" && source !== null && "items" in source && "files" in source;
}

// Windows clipboards can expose an image only through items, or as a file with an empty MIME type.
export function imageFilesFrom(source: DataTransfer | FileList | File[] | null | undefined): File[] {
	const candidates: File[] = [];
	if (isDataTransfer(source)) {
		candidates.push(...Array.from(source.files ?? []));
		for (const item of Array.from(source.items ?? [])) {
			if (item.kind !== "file") continue;
			const file = item.getAsFile();
			if (file) candidates.push(file);
		}
	} else {
		candidates.push(...Array.from(source ?? []));
	}
	const seen = new Set<string>();
	const result: File[] = [];
	for (const candidate of candidates) {
		const key = `${candidate.name}|${candidate.size}|${candidate.lastModified}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const file = withImageType(candidate);
		if (file) result.push(file);
	}
	return result;
}
```

In `TaskMarkdownEditor.tsx` change `imageFilesFrom(event.clipboardData?.files)` to `imageFilesFrom(event.clipboardData)` and `imageFilesFrom(event.dataTransfer?.files)` to `imageFilesFrom(event.dataTransfer)`.

- [ ] **Step 5: Run, expect PASS**

Run: `bun test --timeout=10000 src/web/lib/markdown-image-insert.test.ts src/test/web-task-markdown-editor.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
bunx tsc --noEmit && bun run check .
git add src/web/lib/markdown-image-insert.ts src/web/lib/markdown-image-insert.test.ts src/web/components/TaskMarkdownEditor.tsx
git commit -m "BACK-711 - Fix image paste into task rich-text fields on Windows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Core upload mode and preview (BACK-712)

**Files:**
- Modify: `src/core/assets.ts` (`saveAsset`, ~line 109)
- Modify: `src/types/index.ts:402` (add types)
- Test: `src/test/assets-upload-mode.test.ts` (new)

**Interfaces:**
- Produces:
  - `export type UploadMode = "convert" | "original"` in `src/types/index.ts`
  - `export interface AssetPreview { dataUrl: string; mime: string; originalSize: number; finalSize: number; compressed: boolean }` in `src/types/index.ts`
  - `saveAsset(assetsRoot, { bytes, name?, taskId?, options, now?, mode?: UploadMode })` — `original` stores bytes unchanged with the detected extension
  - `previewAsset(bytes: Uint8Array, options: CompressOptions): Promise<AssetPreview>` — writes nothing

- [ ] **Step 1: Start task**

```bash
bun src/cli.ts task edit BACK-712 -s "In Progress" -a @claude
```

- [ ] **Step 2: Write failing tests** — `src/test/assets-upload-mode.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewAsset, saveAsset } from "../core/assets.ts";
import { compressOptionsFromConfig } from "../core/image-compress.ts";

// 1x1 PNG
const PNG = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
	(c) => c.charCodeAt(0),
);

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "assets-mode-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("saveAsset mode", () => {
	it("keeps original bytes and extension in original mode", async () => {
		const saved = await saveAsset(root, { bytes: PNG, name: "shot", taskId: null, options: compressOptionsFromConfig(null), mode: "original" });
		expect(saved.path.endsWith(".png")).toBe(true);
		expect(saved.compressed).toBe(false);
		expect(saved.finalSize).toBe(PNG.byteLength);
		const file = join(root, saved.path.replace(/^.*?assets\//, ""));
		expect(new Uint8Array(await readFile(file))).toEqual(PNG);
	});

	it("rejects unknown bytes in original mode with 415", async () => {
		await expect(
			saveAsset(root, { bytes: new Uint8Array([1, 2, 3]), taskId: null, options: compressOptionsFromConfig(null), mode: "original" }),
		).rejects.toMatchObject({ status: 415 });
	});
});

describe("previewAsset", () => {
	it("returns a data URL and sizes without writing files", async () => {
		const preview = await previewAsset(PNG, compressOptionsFromConfig(null));
		expect(preview.dataUrl.startsWith(`data:${preview.mime};base64,`)).toBe(true);
		expect(preview.originalSize).toBe(PNG.byteLength);
		expect(await readdir(root)).toEqual([]);
	});
});
```

Before running, open `src/core/assets.ts` and confirm how `toPublicPath` builds `saved.path` and which property `AssetError` uses for the HTTP status; adjust the path mapping and `status` key in the test to match.

- [ ] **Step 3: Run, expect FAIL**

Run: `bun test --timeout=10000 src/test/assets-upload-mode.test.ts`
Expected: FAIL — `previewAsset` is not exported.

- [ ] **Step 4: Implement**

In `src/types/index.ts` after `SavedAsset`:

```ts
export type UploadMode = "convert" | "original";

export interface AssetPreview {
	dataUrl: string;
	mime: string;
	originalSize: number;
	finalSize: number;
	compressed: boolean;
}
```

In `src/core/assets.ts` import `detectImageKind`, `type ImageKind`, `type CompressResult` from `./image-compress.ts` and `type AssetPreview, type UploadMode` from the types. Replace the `try { result = await compressImage(...) } catch {...}` block in `saveAsset` with a call to a shared helper, and add `previewAsset`:

```ts
const ORIGINAL_FORMAT: Record<ImageKind, { extension: string; mime: string }> = {
	jpeg: { extension: "jpg", mime: "image/jpeg" },
	png: { extension: "png", mime: "image/png" },
	webp: { extension: "webp", mime: "image/webp" },
	gif: { extension: "gif", mime: "image/gif" },
	svg: { extension: "svg", mime: "image/svg+xml" },
	avif: { extension: "avif", mime: "image/avif" },
};

async function prepareImage(bytes: Uint8Array, options: CompressOptions, mode: UploadMode): Promise<CompressResult> {
	if (mode === "original") {
		const kind = detectImageKind(bytes);
		if (!kind) throw new AssetError("Unsupported image type", 415);
		return { bytes, ...ORIGINAL_FORMAT[kind], compressed: false };
	}
	try {
		return await compressImage(bytes, options);
	} catch (error) {
		if (error instanceof UnsupportedImageError) throw new AssetError(error.message, 415);
		if (error instanceof ImageDecodeError) throw new AssetError(error.message, 422);
		throw error;
	}
}

export async function previewAsset(bytes: Uint8Array, options: CompressOptions): Promise<AssetPreview> {
	if (bytes.byteLength > MAX_ASSET_BYTES) throw new AssetError("Image is larger than 25 MB", 413);
	if (bytes.byteLength === 0) throw new AssetError("Empty upload", 400);
	const result = await prepareImage(bytes, options, "convert");
	return {
		dataUrl: `data:${result.mime};base64,${Buffer.from(result.bytes).toString("base64")}`,
		mime: result.mime,
		originalSize: bytes.byteLength,
		finalSize: result.bytes.byteLength,
		compressed: result.compressed,
	};
}
```

In `saveAsset`: add `mode?: UploadMode` to the input type, and set `const result = await prepareImage(input.bytes, input.options, input.mode ?? "convert");`. Keep the rest unchanged.

- [ ] **Step 5: Run, expect PASS**

Run: `bun test --timeout=10000 src/test/assets-upload-mode.test.ts src/test/assets-claim.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
bunx tsc --noEmit && bun run check .
git add src/core/assets.ts src/types/index.ts src/test/assets-upload-mode.test.ts
git commit -m "BACK-712 - Add original upload mode and asset preview in core

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Server endpoints and web API client (BACK-712)

**Files:**
- Modify: `src/server/index.ts:466-469` (routes), `:736-756` (`handleUploadAsset`), add `handlePreviewAsset`
- Modify: `src/web/lib/api.ts:473-486`
- Test: `src/web/lib/api-assets.test.ts`, and the server asset test (find with `grep -ln "/api/assets" src/test`)

**Interfaces:**
- Consumes: `saveAsset(..., { mode })`, `previewAsset(bytes, options)` from Task 2.
- Produces:
  - `POST /api/assets?name=&taskId=&mode=convert|original` → `SavedAsset`; invalid `mode` → 400
  - `POST /api/assets/preview` (raw body) → `AssetPreview`
  - `apiClient.uploadAsset(file: Blob, name: string, taskId?: string, mode: UploadMode = "convert"): Promise<SavedAsset>`
  - `apiClient.previewAsset(file: Blob): Promise<AssetPreview>`

- [ ] **Step 1: Write failing tests**

In `src/web/lib/api-assets.test.ts`, follow the existing fetch-mock style in that file and add:

```ts
	it("sends the upload mode", async () => {
		await apiClient.uploadAsset(new Blob(["x"], { type: "image/png" }), "a", undefined, "original");
		expect(String(lastFetchUrl())).toContain("mode=original");
	});

	it("posts the file to the preview endpoint", async () => {
		await apiClient.previewAsset(new Blob(["x"], { type: "image/png" }));
		expect(String(lastFetchUrl())).toContain("/assets/preview");
	});
```

(`lastFetchUrl` = the helper or mock accessor the file already uses to read the called URL; reuse it.)

In the server asset test file, add: POST the 1x1 PNG from Task 2 to `/api/assets?mode=original` → response `compressed === false` and path ends `.png`; POST to `/api/assets?mode=bogus` → 400; POST to `/api/assets/preview` → JSON with `dataUrl` and no new file under the assets dir.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test --timeout=10000 src/web/lib/api-assets.test.ts <server asset test>`

- [ ] **Step 3: Implement**

Routes:

```ts
					"/api/assets": {
						GET: async (req: Request) => await this.handleListAssets(req),
						POST: async (req: Request) => await this.handleUploadAsset(req),
					},
					"/api/assets/preview": {
						POST: async (req: Request) => await this.handlePreviewAsset(req),
					},
```

Extract the size check + body read from `handleUploadAsset` into one private helper so both handlers share it:

```ts
	private async readAssetBody(req: Request): Promise<Uint8Array | null> {
		// A missing or non-numeric Content-Length is unknown; the body reader counts the bytes anyway.
		const declaredLength = Number(req.headers.get("content-length") ?? Number.NaN);
		if (Number.isFinite(declaredLength) && declaredLength > MAX_ASSET_BYTES) return null;
		return await this.readBodyWithLimit(req, MAX_ASSET_BYTES);
	}

	private async handleUploadAsset(req: Request): Promise<Response> {
		try {
			const url = new URL(req.url);
			const mode = url.searchParams.get("mode") ?? "convert";
			if (mode !== "convert" && mode !== "original") {
				return Response.json({ error: "mode must be convert or original" }, { status: 400 });
			}
			const bytes = await this.readAssetBody(req);
			if (!bytes) return Response.json({ error: "Image is larger than 25 MB" }, { status: 413 });
			const config = await this.core.filesystem.loadConfig();
			const saved = await saveAsset(this.assetsRoot(), {
				bytes,
				name: url.searchParams.get("name") ?? undefined,
				taskId: url.searchParams.get("taskId"),
				options: compressOptionsFromConfig(config),
				mode,
			});
			return Response.json(saved);
		} catch (error) {
			return this.assetErrorResponse(error, "Failed to save image");
		}
	}

	private async handlePreviewAsset(req: Request): Promise<Response> {
		try {
			const bytes = await this.readAssetBody(req);
			if (!bytes) return Response.json({ error: "Image is larger than 25 MB" }, { status: 413 });
			const config = await this.core.filesystem.loadConfig();
			return Response.json(await previewAsset(bytes, compressOptionsFromConfig(config)));
		} catch (error) {
			return this.assetErrorResponse(error, "Failed to preview image");
		}
	}
```

Add `previewAsset` to the import from `../core/assets.ts`.

`src/web/lib/api.ts`:

```ts
	async uploadAsset(file: Blob, name: string, taskId?: string, mode: UploadMode = "convert"): Promise<SavedAsset> {
		const params = new URLSearchParams({ name, mode });
		if (taskId) params.set("taskId", taskId);
		// Raw body upload: fetchWithRetry forces a JSON content type, so use fetch directly.
		const response = await fetch(`${API_BASE}/assets?${params.toString()}`, {
			method: "POST",
			headers: { "Content-Type": file.type || "application/octet-stream" },
			body: file,
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to upload image");
		}
		return (await response.json()) as SavedAsset;
	}

	async previewAsset(file: Blob): Promise<AssetPreview> {
		const response = await fetch(`${API_BASE}/assets/preview`, {
			method: "POST",
			headers: { "Content-Type": file.type || "application/octet-stream" },
			body: file,
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to preview image");
		}
		return (await response.json()) as AssetPreview;
	}
```

Import `AssetPreview` and `UploadMode` types alongside `SavedAsset`.

- [ ] **Step 4: Run, expect PASS** (same command as Step 2)

- [ ] **Step 5: Commit**

```bash
bunx tsc --noEmit && bun run check .
git add src/server/index.ts src/web/lib/api.ts src/web/lib/api-assets.test.ts src/test
git commit -m "BACK-712 - Add upload mode and preview endpoints

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ImageUploadDialog` and editor/picker wiring (BACK-712)

**Files:**
- Create: `src/web/components/ImageUploadDialog.tsx`
- Modify: `src/web/components/TaskMarkdownEditor.tsx` (`startUploads`, `handlePaste`, `handleDrop`, render)
- Modify: `src/web/components/AssetPickerModal.tsx:~60-80,~125` (file input handler)
- Test: `src/test/web-image-upload-dialog.test.tsx` (new), `src/test/web-task-markdown-editor.test.tsx`, `src/test/web-asset-picker.test.tsx`

**Interfaces:**
- Consumes: `apiClient.previewAsset`, `apiClient.uploadAsset(file, name, taskId, mode)`, `formatBytes` from `markdown-image-insert.ts`.
- Produces:

```ts
export interface ImageUploadDialogProps {
	files: File[];               // empty array = closed
	onConfirm: (mode: UploadMode) => void;
	onCancel: () => void;
}
```

Behavior: on open, call `previewAsset` per file in parallel. Show per file: original thumbnail (`URL.createObjectURL`), converted thumbnail (`dataUrl`), and `formatBytes(originalSize) → formatBytes(finalSize)`. Toggle buttons `Convert` / `Original` (`aria-pressed`), default `Convert`. If any preview fails, select `Original`, disable `Convert`, and show the error message of the first failure in one line. Buttons `Insert` (`onConfirm(mode)`) and `Cancel`. Revoke object URLs on close. Match the modal styling of `AssetPickerModal` (same overlay/panel classes).

- [ ] **Step 1: Write failing dialog tests** — `src/test/web-image-upload-dialog.test.tsx`. Copy the render/setup harness from `src/test/web-asset-picker.test.tsx` (it already mocks `apiClient`). Cases:

```ts
it("shows sizes from the preview and confirms Convert by default", async () => {
	previewAsset.mockResolvedValue({ dataUrl: "data:image/webp;base64,AA==", mime: "image/webp", originalSize: 2_400_000, finalSize: 310_000, compressed: true });
	const onConfirm = mock();
	render(<ImageUploadDialog files={[png]} onConfirm={onConfirm} onCancel={() => {}} />);
	expect(await screen.findByText(/2\.3 MB → 303 KB/)).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Insert" }));
	expect(onConfirm).toHaveBeenCalledWith("convert");
});

it("confirms Original after toggling", async () => { /* click "Original", then "Insert", expect "original" */ });

it("falls back to Original when preview fails", async () => {
	previewAsset.mockRejectedValue(new Error("Unsupported image type"));
	// expect Convert button disabled, text "Unsupported image type" visible, Insert -> "original"
});

it("Cancel calls onCancel and never uploads", async () => { /* expect uploadAsset not called */ });
```

Write the commented cases out fully, using the same pattern as the first case.

In `web-task-markdown-editor.test.tsx` add: pasting an image opens the dialog (find `button` "Insert"); clicking Insert calls `uploadAsset` with `"convert"`; clicking Cancel leaves the value unchanged and does not call `uploadAsset`.

In `web-asset-picker.test.tsx` update the existing upload test: choosing a file opens the dialog; Insert calls `uploadAsset(file, file.name, taskId, "convert")`.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test --timeout=10000 src/test/web-image-upload-dialog.test.tsx src/test/web-task-markdown-editor.test.tsx src/test/web-asset-picker.test.tsx`

- [ ] **Step 3: Implement the dialog** (`src/web/components/ImageUploadDialog.tsx`)

```tsx
import { useEffect, useState } from "react";
import type { AssetPreview, UploadMode } from "../../types";
import { apiClient } from "../lib/api";
import { formatBytes } from "../lib/markdown-image-insert";

export interface ImageUploadDialogProps {
	files: File[];
	onConfirm: (mode: UploadMode) => void;
	onCancel: () => void;
}

type PreviewState = { status: "loading" } | { status: "ready"; preview: AssetPreview } | { status: "error"; message: string };

export default function ImageUploadDialog({ files, onConfirm, onCancel }: ImageUploadDialogProps) {
	const [previews, setPreviews] = useState<PreviewState[]>([]);
	const [mode, setMode] = useState<UploadMode>("convert");
	const [originalUrls, setOriginalUrls] = useState<string[]>([]);

	useEffect(() => {
		if (files.length === 0) return;
		let cancelled = false;
		const urls = files.map((file) => URL.createObjectURL(file));
		setOriginalUrls(urls);
		setMode("convert");
		setPreviews(files.map(() => ({ status: "loading" })));
		files.forEach((file, index) => {
			apiClient
				.previewAsset(file)
				.then((preview): PreviewState => ({ status: "ready", preview }))
				.catch((error): PreviewState => ({ status: "error", message: error instanceof Error ? error.message : "Preview failed" }))
				.then((state) => {
					if (cancelled) return;
					setPreviews((current) => current.map((item, i) => (i === index ? state : item)));
				});
		});
		return () => {
			cancelled = true;
			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, [files]);

	const failure = previews.find((p): p is { status: "error"; message: string } => p.status === "error");
	useEffect(() => {
		if (failure) setMode("original");
	}, [failure]);

	if (files.length === 0) return null;
	const loading = previews.some((p) => p.status === "loading");

	const toggleClass = (active: boolean) =>
		`px-3 py-1 text-sm rounded-md border ${active ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"} disabled:opacity-50`;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Upload images">
			<div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl dark:bg-gray-800">
				<div className="mb-3 flex gap-2">
					<button type="button" className={toggleClass(mode === "convert")} aria-pressed={mode === "convert"} disabled={Boolean(failure)} onClick={() => setMode("convert")}>
						Convert
					</button>
					<button type="button" className={toggleClass(mode === "original")} aria-pressed={mode === "original"} onClick={() => setMode("original")}>
						Original
					</button>
				</div>
				{failure && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{failure.message}</p>}
				<ul className="max-h-[60vh] space-y-3 overflow-auto">
					{files.map((file, index) => {
						const state = previews[index];
						const ready = state?.status === "ready" ? state.preview : null;
						const src = mode === "convert" && ready ? ready.dataUrl : originalUrls[index];
						return (
							<li key={`${file.name}-${index}`} className="flex items-center gap-3">
								{src && <img src={src} alt={file.name} className="h-24 w-32 rounded object-contain bg-gray-100 dark:bg-gray-900" />}
								<div className="text-sm text-gray-700 dark:text-gray-200">
									<div className="font-medium">{file.name || "pasted image"}</div>
									<div>
										{ready ? `${formatBytes(ready.originalSize)} → ${formatBytes(ready.finalSize)}` : formatBytes(file.size)}
									</div>
								</div>
							</li>
						);
					})}
				</ul>
				<div className="mt-4 flex justify-end gap-2">
					<button type="button" className="px-3 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600" onClick={onCancel}>
						Cancel
					</button>
					<button type="button" className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50" disabled={loading && mode === "convert"} onClick={() => onConfirm(mode)}>
						Insert
					</button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Wire `TaskMarkdownEditor`**

Add state and change upload flow so paste/drop store the batch and the selection, then the dialog confirms:

```tsx
	const [pending, setPending] = useState<{ uploads: PendingUpload[]; start: number; end: number } | null>(null);
	const pendingFiles = useMemo(() => pending?.uploads.map((upload) => upload.file) ?? [], [pending]);

	const startUploads = (uploads: PendingUpload[], start: number, end: number, mode: UploadMode) => {
		const placeholders = uploads.map((upload) => uploadPlaceholder(upload.label));
		commit(insertAtSelection(valueRef.current, start, end, placeholders.join("\n")).value);
		uploads.forEach((upload, index) => {
			const marker = placeholders[index] as string;
			queueRef.current = queueRef.current.then(async () => {
				try {
					const saved = await apiClient.uploadAsset(upload.file, upload.uploadName, taskId, mode);
					commit(replaceFirst(valueRef.current, marker, imageMarkdown(fileNameFromPath(saved.path), saved.path)));
					setToast({ message: uploadToastMessage(saved), tone: "success" });
				} catch (error) {
					commit(replaceFirst(valueRef.current, marker, ""));
					setToast({ message: error instanceof Error ? error.message : "Upload failed", tone: "error" });
				}
			});
		});
	};

	const requestUploads = (uploads: PendingUpload[], textarea: HTMLTextAreaElement) => {
		setPending({ uploads, start: textarea.selectionStart, end: textarea.selectionEnd });
	};
```

In `handlePaste` and `handleDrop`, replace `startUploads(..., event.currentTarget)` with `requestUploads(..., event.currentTarget)`. Render beside `AssetPickerModal`:

```tsx
			<ImageUploadDialog
				files={pendingFiles}
				onCancel={() => setPending(null)}
				onConfirm={(mode) => {
					if (pending) startUploads(pending.uploads, pending.start, pending.end, mode);
					setPending(null);
				}}
			/>
```

Add `useMemo` to the React import and import `ImageUploadDialog` and `type UploadMode`. Include `pending !== null` in whatever drives `onOverlayChange` today (find where `pickerOpen` feeds `onOverlayChange` and OR it with `pending !== null`), so Escape in the task modal does not close the task while the dialog is open.

- [ ] **Step 5: Wire `AssetPickerModal`**

Add `const [pickedFiles, setPickedFiles] = useState<File[]>([]);`. The file input `onChange` sets `setPickedFiles(imageFilesFrom(Array.from(event.target.files ?? [])))` and clears the input value. Move the existing upload loop (around line 72) into `uploadPicked(mode: UploadMode)`, which uploads `pickedFiles` with `apiClient.uploadAsset(file, file.name, taskId, mode)`, keeps the existing `uploading`, `onUploaded`, and error handling, then calls `setPickedFiles([])`. Render `<ImageUploadDialog files={pickedFiles} onConfirm={uploadPicked} onCancel={() => setPickedFiles([])} />` inside the modal.

- [ ] **Step 6: Run, expect PASS**

Run: `bun test --timeout=10000 src/test/web-image-upload-dialog.test.tsx src/test/web-task-markdown-editor.test.tsx src/test/web-asset-picker.test.tsx`

- [ ] **Step 7: Manual check in local UI**

```bash
bun run build && bun src/cli.ts browser --no-open
```

Open the printed URL. Create a task, paste a screenshot into Description: the dialog shows both sizes, Insert adds the image, Cancel adds nothing. Repeat with Original and through the picker's Upload button. Report what you saw.

- [ ] **Step 8: Commit**

```bash
bunx tsc --noEmit && bun run check .
git add src/web/components/ImageUploadDialog.tsx src/web/components/TaskMarkdownEditor.tsx src/web/components/AssetPickerModal.tsx src/test/web-image-upload-dialog.test.tsx src/test/web-task-markdown-editor.test.tsx src/test/web-asset-picker.test.tsx
git commit -m "BACK-712 - Add image upload dialog with convert or original choice

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CLI `asset add` and MCP `asset_add` (BACK-712)

**Files:**
- Modify: `src/cli.ts` (new `asset` command group, next to `docCmd` at ~line 4721)
- Create: `src/mcp/tools/assets/index.ts`, `src/mcp/tools/assets/schemas.ts`
- Modify: `src/mcp/server.ts:29-33` (import) and where `registerDocumentTools(this, config)` is called (add `registerAssetTools(this, config)` next to it)
- Create: `src/core/asset-add.ts`
- Test: `src/test/asset-add.test.ts` (new), `src/test/mcp-assets.test.ts` (new; copy harness from an existing `src/test/mcp-documents*.test.ts`)

**Interfaces:**
- Consumes: `saveAsset`, `compressOptionsFromConfig`, `imageMarkdown`-style output.
- Produces: `addAssetFromFile(core: Core, input: { path: string; taskId?: string; original?: boolean }): Promise<SavedAsset & { markdown: string }>` in `src/core/asset-add.ts` — the one function both CLI and MCP call.

The assets root is `join(dirname(core.filesystem.docsDir), "assets")` (same as `src/server/index.ts:690`). Move that expression into one exported helper `assetsRootFor(core)` in `src/core/asset-add.ts` and make `Server.assetsRoot()` call it, so the path lives in one place.

- [ ] **Step 1: Write failing tests**

`src/test/asset-add.test.ts`: create a temp project with the same setup helper other core tests use (`grep -ln "createTestProject\|initializeProject" src/test | head -1`), write the 1x1 PNG from Task 2 to a temp file, then:

```ts
it("adds an original asset and returns markdown", async () => {
	const saved = await addAssetFromFile(core, { path: pngPath, original: true });
	expect(saved.compressed).toBe(false);
	expect(saved.path.endsWith(".png")).toBe(true);
	expect(saved.markdown).toBe(`![shot](${saved.path})`);
});

it("converts by default", async () => {
	const saved = await addAssetFromFile(core, { path: pngPath });
	expect(saved.path.endsWith(".webp")).toBe(true);
});

it("errors on a missing file", async () => {
	await expect(addAssetFromFile(core, { path: "/nope.png" })).rejects.toThrow(/not found/i);
});
```

Add a CLI test that runs `bun src/cli.ts asset add <png> --original --plain` in the temp project (copy the spawn helper from an existing CLI test) and expects stdout to contain `![`.

`src/test/mcp-assets.test.ts`: call tool `asset_add` with `{ path, original: true }` and expect the text result to contain the path and markdown.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test --timeout=10000 src/test/asset-add.test.ts src/test/mcp-assets.test.ts`

- [ ] **Step 3: Implement core helper** — `src/core/asset-add.ts`

```ts
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { SavedAsset } from "../types/index.ts";
import type { Core } from "./backlog.ts";
import { saveAsset } from "./assets.ts";
import { compressOptionsFromConfig } from "./image-compress.ts";

export function assetsRootFor(core: Core): string {
	return join(dirname(core.filesystem.docsDir), "assets");
}

export async function addAssetFromFile(
	core: Core,
	input: { path: string; taskId?: string; original?: boolean },
): Promise<SavedAsset & { markdown: string }> {
	const file = resolve(input.path);
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await readFile(file));
	} catch {
		throw new Error(`File not found: ${input.path}`);
	}
	const config = await core.filesystem.loadConfig();
	const name = basename(file, extname(file));
	const saved = await saveAsset(assetsRootFor(core), {
		bytes,
		name,
		taskId: input.taskId ?? null,
		options: compressOptionsFromConfig(config),
		mode: input.original ? "original" : "convert",
	});
	return { ...saved, markdown: `![${name}](${saved.path})` };
}
```

Confirm the `Core` class export name and `filesystem` property in `src/core/backlog.ts` before writing; adjust the import if it differs.

- [ ] **Step 4: Implement CLI** (in `src/cli.ts`, after the `doc` command group)

```ts
const assetCmd = program.command("asset").description("Manage image assets");

assetCmd
	.command("add <file>")
	.description("Add an image asset and print its markdown")
	.option("--task <taskId>", "store the image in the task's asset folder")
	.option("--original", "keep the original file instead of converting to WebP")
	.option("--plain", "print plain text output")
	.action(async (file: string, options: { task?: string; original?: boolean; plain?: boolean }) => {
		const cwd = await requireProjectRoot();
		const core = new Core(cwd);
		try {
			const saved = await addAssetFromFile(core, { path: file, taskId: options.task, original: options.original });
			console.log(`Saved: ${saved.path}`);
			console.log(`Size: ${formatAssetBytes(saved.originalSize)} -> ${formatAssetBytes(saved.finalSize)}`);
			console.log(saved.markdown);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});
```

Use the same project-root and `Core` construction lines the `doc create` action uses (copy them exactly; `requireProjectRoot` is a stand-in for that code). Add `formatAssetBytes` as a small local function in `cli.ts` only if no byte formatter exists in `src/` outside `src/web` (`grep -rn "function formatBytes" src --include=*.ts`); otherwise import it.

- [ ] **Step 5: Implement MCP tool**

`src/mcp/tools/assets/schemas.ts`:

```ts
import type { JsonSchema } from "../../validation/validators.ts";

export const assetAddSchema: JsonSchema = {
	type: "object",
	properties: {
		path: { type: "string", minLength: 1, maxLength: 1000 },
		taskId: { type: "string", minLength: 1, maxLength: 100 },
		original: { type: "boolean" },
	},
	required: ["path"],
	additionalProperties: false,
};
```

`src/mcp/tools/assets/index.ts` (follow `documents/index.ts`; check how its handlers access `core` and build the text result, and do the same):

```ts
import { addAssetFromFile } from "../../../core/asset-add.ts";
import type { BacklogConfig } from "../../../types/index.ts";
import type { McpServer } from "../../server.ts";
import type { McpToolHandler } from "../../types.ts";
import { createSimpleValidatedTool } from "../../validation/tool-wrapper.ts";
import { assetAddSchema } from "./schemas.ts";

export function registerAssetTools(server: McpServer, _config: BacklogConfig): void {
	const addAssetTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "asset_add",
			description:
				"Add an image file as a Backlog.md asset. Converts to WebP unless original is true. Returns the saved path, sizes, and a markdown image snippet to put in a task.",
			inputSchema: assetAddSchema,
			annotations: { title: "Add Asset", destructiveHint: false },
		},
		assetAddSchema,
		async (input) => {
			const args = input as { path: string; taskId?: string; original?: boolean };
			const saved = await addAssetFromFile(server, args);
			return {
				content: [
					{
						type: "text",
						text: `Saved: ${saved.path}\nSize: ${saved.originalSize} -> ${saved.finalSize} bytes\n${saved.markdown}`,
					},
				],
			};
		},
	);
	server.addTool(addAssetTool);
}
```

`McpServer` extends `Core` (verify in `src/mcp/server.ts`); if it does not, pass the core property the document handlers use.

- [ ] **Step 6: Run, expect PASS**

Run: `bun test --timeout=10000 src/test/asset-add.test.ts src/test/mcp-assets.test.ts`
Also run the existing MCP tool-list snapshot test if one exists (`grep -ln "document_list" src/test`) and update its expected tool list with `asset_add`.

- [ ] **Step 7: Commit**

```bash
bunx tsc --noEmit && bun run check .
git add src/core/asset-add.ts src/cli.ts src/server/index.ts src/mcp src/test
git commit -m "BACK-712 - Add asset add to CLI and MCP

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Random numeric task IDs (BACK-713)

**Files:**
- Modify: `src/types/index.ts` (`BacklogConfig`, near `zeroPaddedIds` line 353)
- Modify: `src/utils/prefix-config.ts:305-331`
- Modify: `src/core/backlog.ts:1538` and `src/file-system/operations.ts:1222` (task call sites only; leave draft at `:1267`)
- Modify: `src/file-system/operations.ts:~2203` (parse), `:~2253` and `:~2298` (serialize)
- Modify: `src/cli.ts` lines `178`, `196` (key lists), `5089` (`CONFIG_AVAILABLE_KEYS`), `~5272` (get), `~5441` (set)
- Modify: `src/web/components/Settings.tsx` (select next to `zeroPaddedIds`)
- Test: `src/test/id-generation.test.ts`, `src/test/config-commands.test.ts`

**Interfaces:**
- Produces:
  - `BacklogConfig.taskIdMode?: "sequential" | "random"`
  - `generateNextId(existingIds: string[], prefix: string, zeroPadding?: number, mode: "sequential" | "random" = "sequential", random: () => number = secureRandom): string`
  - config file key: `task_id_mode`

- [ ] **Step 1: Start task**

```bash
bun src/cli.ts task edit BACK-713 -s "In Progress" -a @claude
```

- [ ] **Step 2: Write failing tests** (append to `src/test/id-generation.test.ts`)

```ts
describe("generateNextId random mode", () => {
	it("returns a 6-digit id with the prefix", () => {
		const id = generateNextId(["BACK-1"], "back", undefined, "random", () => 0.5);
		expect(id).toBe("BACK-550000");
	});

	it("retries when the id exists", () => {
		const values = [0, 0.5];
		const id = generateNextId(["BACK-100000"], "back", undefined, "random", () => values.shift() ?? 0.9);
		expect(id).toBe("BACK-550000");
	});

	it("throws after 50 collisions", () => {
		expect(() => generateNextId(["BACK-100000"], "back", undefined, "random", () => 0)).toThrow(/random task ID/);
	});

	it("ignores zero padding in random mode", () => {
		expect(generateNextId([], "back", 10, "random", () => 0)).toBe("BACK-100000");
	});

	it("keeps sequential mode unchanged", () => {
		expect(generateNextId(["BACK-7"], "back", undefined, "sequential")).toBe("BACK-8");
	});
});
```

Add a core-level test (same file or `src/test/core.test.ts`, using its project setup): with `taskIdMode: "random"` saved in config, `core.createTask...` (use the create helper that test file already uses) yields an ID matching `/^[A-Z]+-\d{6}$/`; creating a subtask of it yields `<id>.1`; creating a draft keeps the sequential draft ID.

In `src/test/config-commands.test.ts`, following its existing style: `config set taskIdMode random` then `config get taskIdMode` prints `random`; `config set taskIdMode foo` exits 1; `config get taskIdMode` on a fresh project prints `sequential`.

- [ ] **Step 3: Run, expect FAIL**

Run: `bun test --timeout=10000 src/test/id-generation.test.ts src/test/config-commands.test.ts`

- [ ] **Step 4: Implement generator** (`src/utils/prefix-config.ts`)

```ts
export type TaskIdMode = "sequential" | "random";

const RANDOM_ID_MIN = 100000;
const RANDOM_ID_SPAN = 900000;
const RANDOM_ID_TRIES = 50;

function secureRandom(): number {
	const buffer = new Uint32Array(1);
	crypto.getRandomValues(buffer);
	return (buffer[0] as number) / 2 ** 32;
}

export function generateNextId(
	existingIds: string[],
	prefix: string,
	zeroPadding?: number,
	mode: TaskIdMode = "sequential",
	random: () => number = secureRandom,
): string {
	const upperPrefix = prefix.toUpperCase();
	if (mode === "random") {
		const taken = new Set(existingIds.map((id) => id.toUpperCase()));
		for (let attempt = 0; attempt < RANDOM_ID_TRIES; attempt++) {
			const id = `${upperPrefix}-${RANDOM_ID_MIN + Math.floor(random() * RANDOM_ID_SPAN)}`;
			if (!taken.has(id)) return id;
		}
		throw new Error(`Could not find a free random task ID after ${RANDOM_ID_TRIES} tries`);
	}
	// ...existing sequential body unchanged (remove its duplicate `upperPrefix` declaration)
}
```

Before relying on `toUpperCase()` matching, check how existing IDs are stored (e.g. `BACK-12` vs `back-12`) in `getExistingIdsForType`; if IDs can be zero-padded or mixed case, normalize both sides with the same helper `taskIdsEqual` uses.

Call sites:
- `src/core/backlog.ts:1538`: `return generateNextPrefixedId(allIds, prefix, config?.zeroPaddedIds, type === EntityType.Task ? (config?.taskIdMode ?? "sequential") : "sequential");`
- `src/file-system/operations.ts:1222` (draft promoted to task): `generateNextId(existingIds, taskPrefix, config?.zeroPaddedIds, config?.taskIdMode ?? "sequential")`

- [ ] **Step 5: Implement config**

`src/types/index.ts` next to `zeroPaddedIds?: number;`:

```ts
	taskIdMode?: "sequential" | "random";
```

`src/file-system/operations.ts` parse switch (next to `case "zero_padded_ids":`):

```ts
				case "task_id_mode":
					config.taskIdMode = value === "random" ? "random" : "sequential";
					break;
```

In the object at `~2253` add `taskIdMode: config.taskIdMode,`. In the serializer at `~2298` add:

```ts
			...(config.taskIdMode === "random" ? ["task_id_mode: random"] : []),
```

(Only write the key when it is `random`, so default repos see no diff.)

`src/cli.ts`: add `"taskIdMode"` to the key arrays at lines 178 and 196, append `, taskIdMode` to `CONFIG_AVAILABLE_KEYS`, and add:

```ts
				case "taskIdMode":
					console.log(config.taskIdMode ?? "sequential");
					break;
```

```ts
				case "taskIdMode": {
					if (value !== "sequential" && value !== "random") {
						console.error("taskIdMode must be sequential or random.");
						process.exit(1);
					}
					config.taskIdMode = value === "random" ? "random" : undefined;
					break;
				}
```

`src/web/components/Settings.tsx`: next to the `zeroPaddedIds` control, add a `<select>` labeled `Task ID mode` with options `Sequential` (`sequential`) and `Random` (`random`), bound to `config.taskIdMode ?? "sequential"`, using the same state/update pattern as the neighboring field.

- [ ] **Step 6: Run, expect PASS**

Run: `bun test --timeout=10000 src/test/id-generation.test.ts src/test/config-commands.test.ts src/test/prefix-config.test.ts src/test/duplicate-task-repair.test.ts`

- [ ] **Step 7: Commit**

```bash
bunx tsc --noEmit && bun run check .
git add src/types/index.ts src/utils/prefix-config.ts src/core/backlog.ts src/file-system/operations.ts src/cli.ts src/web/components/Settings.tsx src/test
git commit -m "BACK-713 - Add optional random numeric task IDs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Public docs, full verification, finalize tasks

**Files:**
- Modify: agent instruction sources and README where config keys and commands are listed (`grep -rln "zeroPaddedIds\|document_create" src/guidelines src/mcp README.md`)

- [ ] **Step 1: Document**
  - `taskIdMode` (values, default `sequential`, tasks only, subtasks stay `.1`) next to every place `zeroPaddedIds` is documented.
  - `backlog asset add <file> [--task <id>] [--original]` where CLI commands are listed.
  - `asset_add` where MCP tools are listed.

- [ ] **Step 2: Full verification**

```bash
bunx tsc --noEmit && bun run check . && bun run test
```

Expected: all pass. If any test fails, fix it before going on; report failures exactly.

- [ ] **Step 3: Simplify pass** (CLAUDE.md rule) — reread the diff (`git diff main --stat`, then each file). Remove any duplicate helper, unused export, or extra layer. Re-run Step 2 if anything changed.

- [ ] **Step 4: Finalize Backlog tasks**

Read `bun src/cli.ts instructions task-finalization`, then for each of BACK-711, BACK-712, BACK-713: check the met ACs (`--check-ac <n>`), add a final summary (`--final-summary`), and set status Done.

- [ ] **Step 5: Commit** (do not push)

```bash
git add README.md src backlog/tasks/back-711* backlog/tasks/back-712* backlog/tasks/back-713*
git commit -m "BACK-711 BACK-712 BACK-713 - Document asset add and taskIdMode

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
