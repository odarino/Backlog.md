# Phase 2: Asset Upload, Compression, and Image Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users add images to a task by upload, paste, or drag-drop; the server compresses them to WebP with WASM codecs and saves them under `backlog/assets/images/<task-id>/`; a picker in the editor toolbar inserts existing or new images.

**Architecture:** A core compression module (`src/core/image-compress.ts`) wraps the `@jsquash/*` WASM codecs, embedded in the compiled binary with `import … with { type: "file" }`. A core asset module (`src/core/assets.ts`) lists, saves, and claims assets with no HTTP code. Thin server routes (`GET/POST /api/assets`) call it. In the web UI, `TaskMarkdownEditor` wraps `MDEditor` for the 4 task editors and owns paste, drop, placeholders, the picker command, and toasts; `AssetPickerModal` is the picker.

**Tech Stack:** Bun 1.3.14+ (CI) / 1.4.2 (local), TypeScript, React 19, `@uiw/react-md-editor` 4.1.1, `@jsquash/jpeg` 1.6.0, `@jsquash/png` 3.1.1, `@jsquash/webp` 1.5.0, `@jsquash/resize` 2.1.1, `wasm-feature-detect` 1.9.0, Bun test + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-30-images-workflow-publish-design.md`, sections 2 and 3.

## Global Constraints

- Read `MANIFESTO.md` before starting. Do not edit it.
- Biome: tabs, double quotes. Bun test runner. `bun run check .` lints `*.ts` only (not `*.tsx`); match the surrounding style in `.tsx` files by hand.
- No subtitles or helper text under headings or labels in the UI.
- Definition of done: `bunx tsc --noEmit`, `bun run check .`, `bun test` all pass. Known pre-existing failures on the local machine (not caused by this work): config-commands "column 0", cli-json-watch launcher kill, 2x cli-pipe-output delayed pipe reader; flaky only under full-suite load: git hard-kill, content-store identity, board-tui-move, cli-dependency `--clear-deps`, server SPA fallback fail-closed. Report any other failure.
- Bundled libraries go in `devDependencies` with exact versions (no `^`). Do not change the `"configVersion": 1` line in `bun.lock`.
- Upload limit: 25 MB → `413`. Unsupported type (by magic bytes) → `415`. Decode failure → `422`. Invalid task ID → `400`.
- Config keys: `image_max_dimension` (number, default 1920, range 256–8192) and `image_quality` (number, default 0.8, range 0.1–1.0).
- Upload folders: `backlog/assets/images/<lowercase task id>/` (for example `task-12`, `draft-3`), or `backlog/assets/images/_unsorted/` when there is no task ID.
- File names: slug of the original name plus the final extension; `-1`, `-2`, … on collision; pasted images use `paste-YYYYMMDD-HHmmss`.
- Toast text: `Compressed 3.2 MB → 180 KB`, or `Saved (not compressed)`.
- Commits: do not create tasks in `backlog/`. Commit subjects `feat(assets): <summary>` or `fix(assets): <summary>`, then a blank line, then exactly these 2 lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC`
  No `--no-verify`. (The per-task `git commit` commands below show only the first trailer; add both.)
- Do not commit anything under `backlog/`.

## Changes from the spec, found during planning

1. **Spike already done.** During planning, `@jsquash/jpeg` decode → `@jsquash/resize` → `@jsquash/webp` encode ran inside a `bun build --compile` binary started from another directory: a 119 KB JPEG (1280×632) became a 14 KB WebP (640×316) in 110 ms. The compiled-binary smoke test (Task 3) keeps checking this in CI on all 6 targets.
2. **No custom EXIF reader.** `@jsquash/jpeg` decode with `{ preserveOrientation: true }` applies the EXIF orientation (tested: a 1280×632 JPEG with orientation 6 decodes to 632×1280). The option name is misleading; the test in Task 1 pins the behavior.
3. **AVIF is saved unchanged,** like GIF and SVG. The AVIF decoder is 1.2 MB of WASM, and AVIF files are already well compressed.
4. **The `_unsorted` claim runs in the server create handler,** right after `core.createTaskFromInput`. The task modal never sees the new ID (its parent owns the create call), so the client cannot do it.
5. **The picker needs the same key guard as the lightbox.** `TaskDetailsModal` has a `window` capture `keydown` listener and `Modal` has a `document` capture listener; both would take Escape from the picker. `TaskMarkdownEditor` reports an open overlay, and `TaskDetailsModal` treats it like an open lightbox.
6. **Placeholders carry a unique token:** `![Uploading my-shot.png…](uploading:<token>)`, so two uploads with the same name never replace each other's placeholder.
7. **The folder name is the lowercase task ID** (`task-12`). The `taskId` in `GET /api/assets` results is that folder name.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/image-data-polyfill.ts` | Create | Defines `globalThis.ImageData` when the Bun runtime has none (the codecs construct it) |
| `src/core/image-compress.ts` | Create | Detect type by magic bytes, decode, resize, encode WebP, keep original when not smaller |
| `src/test/image-fixtures.ts` | Create | Test/smoke helper: synthetic JPEG/PNG fixtures, EXIF orientation injection |
| `src/test/image-compress.test.ts` | Create | Compression unit tests |
| `src/types/index.ts` | Modify | `AssetEntry`, `SavedAsset`; `BacklogConfig.imageMaxDimension`, `imageQuality` |
| `src/types/wasm.d.ts` | Create | Module declaration for `*.wasm` file imports |
| `src/core/assets.ts` | Create | List, save (no-clobber), claim `_unsorted` assets; `AssetError` |
| `src/test/assets.test.ts` | Create | Asset store unit tests |
| `src/file-system/operations.ts` | Modify | Parse/serialize the 2 config keys |
| `src/server/index.ts` | Modify | `GET/POST /api/assets`, SVG headers, config validation, claim after create |
| `src/test/server-assets-upload.test.ts` | Create | Route tests, config round trip, claim on create |
| `scripts/smoke-compiled-build.ts` | Modify | Upload + fetch check against the compiled binary |
| `src/web/components/Settings.tsx` | Modify | Two number inputs |
| `src/web/lib/markdown-image-insert.ts` | Create | Pure text helpers for inserting images and placeholders |
| `src/web/lib/markdown-image-insert.test.ts` | Create | Unit tests for the helpers |
| `src/web/lib/api.ts` | Modify | `listAssets`, `uploadAsset` |
| `src/web/components/SuccessToast.tsx` | Modify | Optional `tone: "success" \| "error"` |
| `src/web/components/TaskMarkdownEditor.tsx` | Create | MDEditor wrapper: paste, drop, placeholders, toast, picker command |
| `src/web/components/AssetPickerModal.tsx` | Create | Thumbnail grid, search, multi-select, upload, insert |
| `src/web/components/TaskDetailsModal.tsx` | Modify | Use `TaskMarkdownEditor` ×4, overlay key guard |
| `src/test/web-task-markdown-editor.test.tsx` | Create | Paste/drop/placeholder component tests |
| `src/test/web-asset-picker.test.tsx` | Create | Picker component tests + Escape guard integration |
| `package.json`, `bun.lock`, `bun.nix` | Modify | New dependencies |

---

### Task 1: WASM image compression module

**Files:**
- Modify: `package.json`, `bun.lock`, `bun.nix` (via commands)
- Create: `src/types/wasm.d.ts`
- Create: `src/core/image-data-polyfill.ts`
- Create: `src/core/image-compress.ts`
- Create: `src/test/image-fixtures.ts`
- Test: `src/test/image-compress.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (from `src/core/image-compress.ts`):
  - `export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "svg" | "avif"`
  - `export interface CompressOptions { maxDimension: number; quality: number }` (quality 0.1–1.0)
  - `export interface CompressResult { bytes: Uint8Array; extension: string; mime: string; compressed: boolean }`
  - `export class UnsupportedImageError extends Error`, `export class ImageDecodeError extends Error`
  - `export const DEFAULT_IMAGE_MAX_DIMENSION = 1920`, `export const DEFAULT_IMAGE_QUALITY = 0.8`
  - `export function detectImageKind(bytes: Uint8Array): ImageKind | null`
  - `export function fitWithin(width: number, height: number, max: number): { width: number; height: number }`
  - `export function compressOptionsFromConfig(config: { imageMaxDimension?: number; imageQuality?: number } | null | undefined): CompressOptions`
  - `export async function compressImage(bytes: Uint8Array, options: CompressOptions): Promise<CompressResult>`
- Produces (from `src/test/image-fixtures.ts`): `jpegFixture(width, height, opts?: { quality?: number; noise?: number }): Promise<Uint8Array>`, `pngFixture(width, height): Promise<Uint8Array>`, `withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array`.

- [ ] **Step 1: Add the dependencies**

Run:

```bash
bun add -d @jsquash/jpeg@1.6.0 @jsquash/png@3.1.1 @jsquash/webp@1.5.0 @jsquash/resize@2.1.1 wasm-feature-detect@1.9.0
```

Then check `package.json`: the 5 entries are in `devDependencies` with exact versions (remove any `^`). Check `git diff bun.lock`: `"configVersion": 1` is still there and only the new packages were added. Then run `bun run update-nix` so `bun.nix` matches (the CI nix job builds from it). If `update-nix` fails because of the network, report it; do not edit `bun.nix` by hand.

- [ ] **Step 2: Add the `*.wasm` module declaration**

Create `src/types/wasm.d.ts` (the folder is in `tsconfig.json` `typeRoots`, next to `raw.d.ts`):

```ts
declare module "*.wasm" {
	const path: string;
	export default path;
}
```

- [ ] **Step 3: Create the ImageData polyfill**

Create `src/core/image-data-polyfill.ts`:

```ts
// The jsquash codecs construct ImageData. Some Bun versions have no global ImageData, so define a minimal one.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
	class ImageDataPolyfill {
		readonly data: Uint8ClampedArray;
		readonly width: number;
		readonly height: number;
		readonly colorSpace = "srgb";

		constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
			if (typeof dataOrWidth === "number") {
				this.width = dataOrWidth;
				this.height = widthOrHeight;
				this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
			} else {
				this.data = dataOrWidth;
				this.width = widthOrHeight;
				this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
			}
		}
	}
	(globalThis as { ImageData?: unknown }).ImageData = ImageDataPolyfill;
}
```

- [ ] **Step 4: Create the test fixtures helper**

Create `src/test/image-fixtures.ts`:

```ts
import "../core/image-data-polyfill.ts";
import encodeJpeg, { init as initJpegEncode } from "@jsquash/jpeg/encode";
import encodePng, { init as initPngEncode } from "@jsquash/png/encode";
import jpegEncodeWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm" with { type: "file" };
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };

let encodersReady: Promise<void> | null = null;

async function compileWasm(path: string): Promise<WebAssembly.Module> {
	return WebAssembly.compile(await Bun.file(path).arrayBuffer());
}

function ensureEncoders(): Promise<void> {
	encodersReady ??= (async () => {
		const [jpegModule, pngModule] = await Promise.all([compileWasm(jpegEncodeWasm), compileWasm(pngWasm)]);
		await initJpegEncode(jpegModule);
		await initPngEncode(pngModule);
	})();
	return encodersReady;
}

/** Deterministic gradient with seeded noise; noise makes the JPEG large enough to shrink. */
export function syntheticImage(width: number, height: number, noise = 24): ImageData {
	const data = new Uint8ClampedArray(width * height * 4);
	let seed = 1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			const n = noise > 0 ? (seed >>> 24) % noise : 0;
			const i = (y * width + x) * 4;
			data[i] = ((x * 255) / width + n) | 0;
			data[i + 1] = ((y * 255) / height + n) | 0;
			data[i + 2] = (((x + y) * 127) / (width + height) + n) | 0;
			data[i + 3] = 255;
		}
	}
	return new ImageData(data, width, height);
}

export async function jpegFixture(
	width: number,
	height: number,
	opts: { quality?: number; noise?: number } = {},
): Promise<Uint8Array> {
	await ensureEncoders();
	const encoded = await encodeJpeg(syntheticImage(width, height, opts.noise ?? 24), { quality: opts.quality ?? 95 });
	return new Uint8Array(encoded);
}

export async function pngFixture(width: number, height: number): Promise<Uint8Array> {
	await ensureEncoders();
	return new Uint8Array(await encodePng(syntheticImage(width, height)));
}

/** Insert an APP1 EXIF segment with one Orientation tag right after the JPEG SOI marker. */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
	const tiff = new Uint8Array([
		0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at offset 8
		0x00, 0x01, // 1 entry
		0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // tag 0x0112 Orientation, SHORT, count 1
		0x00, orientation, 0x00, 0x00, // value
		0x00, 0x00, 0x00, 0x00, // next IFD
	]);
	const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
	const length = 2 + exifHeader.length + tiff.length;
	const segment = new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...exifHeader, ...tiff]);
	const out = new Uint8Array(jpeg.length + segment.length);
	out.set(jpeg.subarray(0, 2), 0);
	out.set(segment, 2);
	out.set(jpeg.subarray(2), 2 + segment.length);
	return out;
}
```

If `initJpegEncode` / `initPngEncode` print a wasm-bindgen warning about deprecated parameters, pass `{ module_or_path: module }` instead of the bare module (cast as needed) so test output stays clean. Apply the same rule in Step 7.

- [ ] **Step 5: Write the failing tests**

Create `src/test/image-compress.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import decodeWebp from "@jsquash/webp/decode";
import {
	compressImage,
	compressOptionsFromConfig,
	detectImageKind,
	fitWithin,
	ImageDecodeError,
	UnsupportedImageError,
} from "../core/image-compress.ts";
import { jpegFixture, pngFixture, withExifOrientation } from "./image-fixtures.ts";

const ascii = (text: string) => new TextEncoder().encode(text);
const webpSize = async (bytes: Uint8Array) => {
	const image = await decodeWebp(bytes.slice().buffer);
	return { width: image.width, height: image.height };
};

describe("detectImageKind", () => {
	it("detects formats by magic bytes", async () => {
		expect(detectImageKind(await jpegFixture(8, 8))).toBe("jpeg");
		expect(detectImageKind(await pngFixture(8, 8))).toBe("png");
		expect(detectImageKind(ascii("GIF89a....."))).toBe("gif");
		expect(detectImageKind(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("webp");
		expect(detectImageKind(ascii("\u0000\u0000\u0000\u001cftypavif"))).toBe("avif");
		expect(detectImageKind(ascii('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
		expect(detectImageKind(ascii("<svg viewBox='0 0 1 1'/>"))).toBe("svg");
	});

	it("returns null for anything else", () => {
		expect(detectImageKind(ascii("hello world"))).toBeNull();
		expect(detectImageKind(new Uint8Array())).toBeNull();
		expect(detectImageKind(ascii("<html><svg></svg></html>"))).toBeNull();
	});
});

describe("fitWithin", () => {
	it("keeps images that already fit", () => {
		expect(fitWithin(800, 600, 1920)).toEqual({ width: 800, height: 600 });
	});

	it("scales the longest side down to the maximum", () => {
		expect(fitWithin(4000, 2000, 1920)).toEqual({ width: 1920, height: 960 });
		expect(fitWithin(1000, 3000, 1500)).toEqual({ width: 500, height: 1500 });
	});
});

describe("compressOptionsFromConfig", () => {
	it("uses defaults when keys are missing", () => {
		expect(compressOptionsFromConfig(undefined)).toEqual({ maxDimension: 1920, quality: 0.8 });
	});

	it("clamps values to the allowed ranges", () => {
		expect(compressOptionsFromConfig({ imageMaxDimension: 10, imageQuality: 5 })).toEqual({
			maxDimension: 256,
			quality: 1,
		});
		expect(compressOptionsFromConfig({ imageMaxDimension: 99999, imageQuality: 0 })).toEqual({
			maxDimension: 8192,
			quality: 0.1,
		});
		expect(compressOptionsFromConfig({ imageMaxDimension: Number.NaN })).toEqual({ maxDimension: 1920, quality: 0.8 });
	});
});

describe("compressImage", () => {
	it("resizes a large JPEG and encodes a smaller WebP", async () => {
		const input = await jpegFixture(2400, 1600);
		const result = await compressImage(input, { maxDimension: 1920, quality: 0.8 });
		expect(result.compressed).toBe(true);
		expect(result.extension).toBe("webp");
		expect(result.mime).toBe("image/webp");
		expect(result.bytes.byteLength).toBeLessThan(input.byteLength);
		expect(await webpSize(result.bytes)).toEqual({ width: 1920, height: 1280 });
	});

	it("compresses a PNG", async () => {
		const input = await pngFixture(1200, 800);
		const result = await compressImage(input, { maxDimension: 1920, quality: 0.8 });
		expect(result.compressed).toBe(true);
		expect(await webpSize(result.bytes)).toEqual({ width: 1200, height: 800 });
	});

	it("applies the EXIF orientation of a JPEG", async () => {
		const input = withExifOrientation(await jpegFixture(1200, 600), 6);
		const result = await compressImage(input, { maxDimension: 4096, quality: 0.8 });
		expect(result.compressed).toBe(true);
		expect(await webpSize(result.bytes)).toEqual({ width: 600, height: 1200 });
	});

	it("keeps the original bytes when the WebP is not smaller", async () => {
		const input = await jpegFixture(32, 32, { quality: 5, noise: 200 });
		const result = await compressImage(input, { maxDimension: 1920, quality: 1 });
		expect(result.compressed).toBe(false);
		expect(result.extension).toBe("jpg");
		expect(result.bytes).toEqual(input);
	});

	it("passes GIF, SVG, and AVIF through unchanged", async () => {
		const gif = ascii("GIF89a-animated");
		expect(await compressImage(gif, { maxDimension: 1920, quality: 0.8 })).toEqual({
			bytes: gif,
			extension: "gif",
			mime: "image/gif",
			compressed: false,
		});
		const svg = ascii("<svg xmlns='http://www.w3.org/2000/svg'/>");
		expect((await compressImage(svg, { maxDimension: 1920, quality: 0.8 })).extension).toBe("svg");
		const avif = ascii("\u0000\u0000\u0000\u001cftypavif-data");
		expect((await compressImage(avif, { maxDimension: 1920, quality: 0.8 })).extension).toBe("avif");
	});

	it("rejects a corrupt JPEG with ImageDecodeError", async () => {
		const corrupt = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
		await expect(compressImage(corrupt, { maxDimension: 1920, quality: 0.8 })).rejects.toBeInstanceOf(ImageDecodeError);
	});

	it("rejects unknown data with UnsupportedImageError", async () => {
		await expect(compressImage(ascii("not an image"), { maxDimension: 1920, quality: 0.8 })).rejects.toBeInstanceOf(
			UnsupportedImageError,
		);
	});
});
```

The "not smaller" case depends on codec output sizes. If it does not produce `compressed: false`, change only the fixture parameters (smaller size, lower JPEG quality, more noise) until it does, and say so in the report.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun test src/test/image-compress.test.ts`
Expected: FAIL, `Cannot find module '../core/image-compress.ts'`.

- [ ] **Step 7: Implement `src/core/image-compress.ts`**

```ts
import "./image-data-polyfill.ts";
import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode";
import decodePng, { init as initPngDecode } from "@jsquash/png/decode";
import resize, { initResize } from "@jsquash/resize";
import decodeWebp, { init as initWebpDecode } from "@jsquash/webp/decode";
import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode";
import jpegDecodeWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm" with { type: "file" };
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };
import resizeWasm from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm" with { type: "file" };
import webpDecodeWasm from "@jsquash/webp/codec/dec/webp_dec.wasm" with { type: "file" };
import webpEncodeWasm from "@jsquash/webp/codec/enc/webp_enc.wasm" with { type: "file" };
import webpEncodeSimdWasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm" with { type: "file" };
import { simd } from "wasm-feature-detect";

export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "svg" | "avif";

export interface CompressOptions {
	maxDimension: number;
	quality: number;
}

export interface CompressResult {
	bytes: Uint8Array;
	extension: string;
	mime: string;
	compressed: boolean;
}

export class UnsupportedImageError extends Error {
	constructor(message = "Unsupported image type") {
		super(message);
		this.name = "UnsupportedImageError";
	}
}

export class ImageDecodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImageDecodeError";
	}
}

export const DEFAULT_IMAGE_MAX_DIMENSION = 1920;
export const DEFAULT_IMAGE_QUALITY = 0.8;

const MIME: Record<ImageKind, string> = {
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
};

const EXTENSION: Record<ImageKind, string> = {
	jpeg: "jpg",
	png: "png",
	webp: "webp",
	gif: "gif",
	svg: "svg",
	avif: "avif",
};

const SVG_START = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s/>]/i;

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}

export function detectImageKind(bytes: Uint8Array): ImageKind | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
	if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
	if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif";
	if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
	if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) {
		return "avif";
	}
	const head = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^﻿/, "").trimStart();
	return SVG_START.test(head) ? "svg" : null;
}

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= max) return { width, height };
	const scale = max / longest;
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function compressOptionsFromConfig(
	config: { imageMaxDimension?: number; imageQuality?: number } | null | undefined,
): CompressOptions {
	return {
		maxDimension: Math.round(clamp(config?.imageMaxDimension, 256, 8192, DEFAULT_IMAGE_MAX_DIMENSION)),
		quality: clamp(config?.imageQuality, 0.1, 1, DEFAULT_IMAGE_QUALITY),
	};
}

let codecsReady: Promise<void> | null = null;

async function compileWasm(path: string): Promise<WebAssembly.Module> {
	return WebAssembly.compile(await Bun.file(path).arrayBuffer());
}

// The .wasm files are embedded in the compiled binary; Bun.file reads them from the embedded paths.
function ensureCodecs(): Promise<void> {
	codecsReady ??= (async () => {
		// The WebP encoder picks its SIMD glue with the same check, so the module must match it.
		const encoderPath = (await simd()) ? webpEncodeSimdWasm : webpEncodeWasm;
		const [jpegModule, pngModule, webpDecodeModule, webpEncodeModule, resizeModule] = await Promise.all([
			compileWasm(jpegDecodeWasm),
			compileWasm(pngWasm),
			compileWasm(webpDecodeWasm),
			compileWasm(encoderPath),
			compileWasm(resizeWasm),
		]);
		await Promise.all([
			initJpegDecode(jpegModule),
			initPngDecode(pngModule),
			initWebpDecode(webpDecodeModule),
			initWebpEncode(webpEncodeModule),
			initResize(resizeModule),
		]);
	})().catch((error) => {
		codecsReady = null;
		throw error;
	});
	return codecsReady;
}

async function decode(kind: "jpeg" | "png" | "webp", bytes: Uint8Array): Promise<ImageData> {
	const buffer = bytes.slice().buffer;
	let image: ImageData | null | undefined;
	try {
		if (kind === "jpeg") {
			// Despite its name, preserveOrientation: true applies the EXIF orientation to the pixels.
			image = await decodeJpeg(buffer, { preserveOrientation: true });
		} else if (kind === "png") {
			image = await decodePng(buffer);
		} else {
			image = await decodeWebp(buffer);
		}
	} catch (error) {
		throw new ImageDecodeError(`Could not decode ${kind} image: ${error instanceof Error ? error.message : error}`);
	}
	if (!image) throw new ImageDecodeError(`Could not decode ${kind} image`);
	return image;
}

export async function compressImage(bytes: Uint8Array, options: CompressOptions): Promise<CompressResult> {
	const kind = detectImageKind(bytes);
	if (!kind) throw new UnsupportedImageError();
	const original: CompressResult = { bytes, extension: EXTENSION[kind], mime: MIME[kind], compressed: false };
	if (kind === "gif" || kind === "svg" || kind === "avif") return original;

	await ensureCodecs();
	let image = await decode(kind, bytes);
	const target = fitWithin(image.width, image.height, options.maxDimension);
	if (target.width !== image.width || target.height !== image.height) {
		image = await resize(image, target);
	}
	const encoded = new Uint8Array(await encodeWebp(image, { quality: Math.round(options.quality * 100) }));
	if (encoded.byteLength >= bytes.byteLength) return original;
	return { bytes: encoded, extension: "webp", mime: "image/webp", compressed: true };
}
```

Notes for the implementer:
- `@jsquash/jpeg` `init(module)` needs a `WebAssembly.Module` (it checks `instanceof WebAssembly.Module` when called with one argument). The PNG and resize inits are wasm-bindgen inits: if they print a "deprecated parameters" warning, pass `{ module_or_path: module }` (cast the type) so output stays clean.
- Do not load the AVIF codec.
- If TypeScript rejects an init signature, add the narrowest cast at that call and a one-line comment; do not change the design.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/test/image-compress.test.ts`
Expected: PASS, 13 tests, no warnings in the output.

- [ ] **Step 9: Prove the codecs load in a compiled binary**

Create a temporary file outside the repo (do not commit it), for example `$TMPDIR/codec-smoke.ts`:

```ts
import { compressImage } from "/ABSOLUTE/PATH/TO/REPO/src/core/image-compress.ts";
import { jpegFixture } from "/ABSOLUTE/PATH/TO/REPO/src/test/image-fixtures.ts";
const input = await jpegFixture(2400, 1600);
const result = await compressImage(input, { maxDimension: 1920, quality: 0.8 });
console.log(JSON.stringify({ in: input.byteLength, out: result.bytes.byteLength, compressed: result.compressed }));
```

Run: `bun build --compile $TMPDIR/codec-smoke.ts --outfile $TMPDIR/codec-smoke && cd / && $TMPDIR/codec-smoke`
Expected: one JSON line with `"compressed":true` and `out` smaller than `in`. Paste the output in the report. Delete the two temporary files.

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock bun.nix src/types/wasm.d.ts src/core/image-data-polyfill.ts src/core/image-compress.ts src/test/image-fixtures.ts src/test/image-compress.test.ts
git commit -m "feat(assets): add WASM image compression module" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC"
```

---

### Task 2: Asset store (list and save)

**Files:**
- Modify: `src/types/index.ts` (add 2 interfaces at the end)
- Create: `src/core/assets.ts`
- Test: `src/test/assets.test.ts`

**Interfaces:**
- Consumes: `compressImage`, `CompressOptions`, `ImageDecodeError`, `UnsupportedImageError` from `src/core/image-compress.ts` (Task 1); `jpegFixture` from `src/test/image-fixtures.ts` (Task 1).
- Produces:
  - In `src/types/index.ts`: `export interface AssetEntry { path: string; name: string; size: number; mtime: string; taskId: string | null }` and `export interface SavedAsset { path: string; originalSize: number; finalSize: number; compressed: boolean }`
  - In `src/core/assets.ts`:
    - `export const MAX_ASSET_BYTES = 25 * 1024 * 1024`
    - `export const UNSORTED_FOLDER = "_unsorted"`
    - `export class AssetError extends Error { readonly status: 400 | 413 | 415 | 422 }`
    - `export function assetFolderForTask(taskId?: string | null): string`
    - `export function slugifyAssetName(name: string): string`
    - `export function pasteAssetName(now?: Date): string`
    - `export async function listAssets(assetsRoot: string, taskId?: string | null): Promise<AssetEntry[]>`
    - `export async function saveAsset(assetsRoot: string, input: { bytes: Uint8Array; name?: string; taskId?: string | null; options: CompressOptions; now?: Date }): Promise<SavedAsset>`
    - internal helpers `toPublicPath(assetsRoot, filePath)` and `placeWithoutClobber(dir, stem, extension, place)` (Task 4 reuses them from the same file)

- [ ] **Step 1: Add the shared types**

At the end of `src/types/index.ts` add:

```ts
/** An image file under backlog/assets, as listed for the picker. */
export interface AssetEntry {
	/** Public URL path, e.g. /assets/images/task-12/shot.webp */
	path: string;
	name: string;
	size: number;
	/** ISO timestamp of the last modification */
	mtime: string;
	/** Folder name under images/ (lowercase task ID), or null for other locations and _unsorted */
	taskId: string | null;
}

export interface SavedAsset {
	path: string;
	originalSize: number;
	finalSize: number;
	compressed: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/test/assets.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AssetError,
	assetFolderForTask,
	listAssets,
	MAX_ASSET_BYTES,
	pasteAssetName,
	saveAsset,
	slugifyAssetName,
} from "../core/assets.ts";
import { jpegFixture } from "./image-fixtures.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

const options = { maxDimension: 1920, quality: 0.8 };
let root: string;

beforeEach(async () => {
	root = join(createUniqueTestDir("assets-store"), "assets");
	await mkdir(root, { recursive: true });
});

afterEach(async () => {
	await safeCleanup(join(root, ".."));
});

describe("names and folders", () => {
	it("slugifies original names", () => {
		expect(slugifyAssetName("My Shot.png")).toBe("my-shot");
		expect(slugifyAssetName("Ảnh chụp màn hình (2).JPG")).toBe("anh-chup-man-hinh-2");
		expect(slugifyAssetName("../../etc/passwd")).toBe("passwd");
		expect(slugifyAssetName("")).toBe("");
	});

	it("names pasted images by local time", () => {
		expect(pasteAssetName(new Date(2026, 8, 30, 14, 25, 1))).toBe("paste-20260930-142501");
	});

	it("maps task IDs to lowercase folders and rejects unsafe IDs", () => {
		expect(assetFolderForTask("TASK-12")).toBe("task-12");
		expect(assetFolderForTask("BACK-7.1")).toBe("back-7.1");
		expect(assetFolderForTask(undefined)).toBe("_unsorted");
		expect(assetFolderForTask("")).toBe("_unsorted");
		for (const bad of ["../x", "a/b", "..", ".hidden", "a b"]) {
			expect(() => assetFolderForTask(bad)).toThrow(AssetError);
		}
	});
});

describe("saveAsset", () => {
	it("compresses into the task folder and returns the public path", async () => {
		const bytes = await jpegFixture(2400, 1600);
		const saved = await saveAsset(root, { bytes, name: "My Shot.jpg", taskId: "TASK-12", options });
		expect(saved).toEqual({
			path: "/assets/images/task-12/my-shot.webp",
			originalSize: bytes.byteLength,
			finalSize: expect.any(Number),
			compressed: true,
		});
		expect(saved.finalSize).toBeLessThan(bytes.byteLength);
		expect(await readdir(join(root, "images", "task-12"))).toEqual(["my-shot.webp"]);
	});

	it("adds -1, -2 on name collisions", async () => {
		const bytes = await jpegFixture(400, 300);
		const paths = [];
		for (let i = 0; i < 3; i++) {
			paths.push((await saveAsset(root, { bytes, name: "shot.jpg", taskId: "TASK-1", options })).path);
		}
		expect(paths).toEqual([
			"/assets/images/task-1/shot.webp",
			"/assets/images/task-1/shot-1.webp",
			"/assets/images/task-1/shot-2.webp",
		]);
	});

	it("does not overwrite when two saves race for the same name", async () => {
		const bytes = await jpegFixture(400, 300);
		const results = await Promise.all(
			[0, 1, 2, 3].map(() => saveAsset(root, { bytes, name: "race.jpg", taskId: "TASK-1", options })),
		);
		expect(new Set(results.map((result) => result.path)).size).toBe(4);
		expect((await readdir(join(root, "images", "task-1"))).sort()).toEqual([
			"race-1.webp",
			"race-2.webp",
			"race-3.webp",
			"race.webp",
		]);
	});

	it("uses _unsorted without a task and a paste name without a file name", async () => {
		const bytes = await jpegFixture(400, 300);
		const saved = await saveAsset(root, { bytes, options, now: new Date(2026, 8, 30, 9, 5, 7) });
		expect(saved.path).toBe("/assets/images/_unsorted/paste-20260930-090507.webp");
	});

	it("maps errors to HTTP statuses and leaves no files behind", async () => {
		const cases: Array<[Uint8Array, number]> = [
			[new Uint8Array(MAX_ASSET_BYTES + 1), 413],
			[new TextEncoder().encode("plain text"), 415],
			[new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]), 422],
			[new Uint8Array(), 400],
		];
		for (const [bytes, status] of cases) {
			const error = await saveAsset(root, { bytes, name: "x.jpg", taskId: "TASK-1", options }).catch((e) => e);
			expect(error).toBeInstanceOf(AssetError);
			expect((error as AssetError).status).toBe(status);
		}
		const taskDir = join(root, "images", "task-1");
		expect(await readdir(taskDir).catch(() => [])).toEqual([]);
	});
});

describe("listAssets", () => {
	it("lists images recursively, current task first, then newest first", async () => {
		const write = async (rel: string, mtimeSeconds: number) => {
			const file = join(root, rel);
			await mkdir(join(file, ".."), { recursive: true });
			await writeFile(file, "x");
			await utimes(file, mtimeSeconds, mtimeSeconds);
		};
		await write("images/task-1/old.png", 1_000);
		await write("images/task-2/newest.webp", 3_000);
		await write("images/task-1/new.webp", 2_000);
		await write("images/_unsorted/loose.jpg", 2_500);
		await write("diagrams/My Chart.svg", 1_500);
		await write("images/task-1/notes.txt", 4_000);
		await write("images/task-1/.hidden.png", 4_000);
		await symlink(join(root, "images/task-1/old.png"), join(root, "images/task-1/link.png"));

		const entries = await listAssets(root, "TASK-1");
		expect(entries.map((entry) => [entry.path, entry.taskId])).toEqual([
			["/assets/images/task-1/new.webp", "task-1"],
			["/assets/images/task-1/old.png", "task-1"],
			["/assets/images/task-2/newest.webp", "task-2"],
			["/assets/images/_unsorted/loose.jpg", null],
			["/assets/diagrams/My%20Chart.svg", null],
		]);
		expect(entries[0]).toEqual({
			path: "/assets/images/task-1/new.webp",
			name: "new.webp",
			size: 1,
			mtime: new Date(2_000_000).toISOString(),
			taskId: "task-1",
		});
	});

	it("returns an empty list when the assets folder does not exist", async () => {
		expect(await listAssets(join(root, "missing"))).toEqual([]);
	});
});
```

The symlink line may fail on Windows CI without privileges. Wrap only that line: `await symlink(...).catch(() => {})`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/test/assets.test.ts`
Expected: FAIL, `Cannot find module '../core/assets.ts'`.

- [ ] **Step 4: Implement `src/core/assets.ts`**

```ts
import { link, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { AssetEntry, SavedAsset } from "../types/index.ts";
import { type CompressOptions, compressImage, ImageDecodeError, UnsupportedImageError } from "./image-compress.ts";

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const UNSORTED_FOLDER = "_unsorted";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const FOLDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class AssetError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 413 | 415 | 422,
	) {
		super(message);
		this.name = "AssetError";
	}
}

export function assetFolderForTask(taskId?: string | null): string {
	const folder = (taskId ?? "").trim().toLowerCase();
	if (!folder) return UNSORTED_FOLDER;
	if (!FOLDER_PATTERN.test(folder) || folder.includes("..")) {
		throw new AssetError(`Invalid task ID: ${taskId}`, 400);
	}
	return folder;
}

export function slugifyAssetName(name: string): string {
	const base = basename(name.replaceAll("\\", "/")).replace(/\.[^.]*$/, "");
	return base
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/gi, "d")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

export function pasteAssetName(now: Date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `paste-${date}-${time}`;
}

export function toPublicPath(assetsRoot: string, filePath: string): string {
	return `/assets/${relative(assetsRoot, filePath).split(sep).map(encodeURIComponent).join("/")}`;
}

function isExistsError(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

/**
 * Pick the first free `stem.ext`, `stem-1.ext`, … and hand it to `place`, which must fail with EEXIST
 * when the target appeared in the meantime (link, copyFile with COPYFILE_EXCL). Never overwrites.
 */
export async function placeWithoutClobber(
	dir: string,
	stem: string,
	extension: string,
	place: (target: string) => Promise<void>,
): Promise<string> {
	for (let attempt = 0; attempt < 1000; attempt++) {
		const target = join(dir, attempt === 0 ? `${stem}.${extension}` : `${stem}-${attempt}.${extension}`);
		try {
			await place(target);
			return target;
		} catch (error) {
			if (!isExistsError(error)) throw error;
		}
	}
	throw new Error(`No free file name for ${stem}.${extension}`);
}

export async function saveAsset(
	assetsRoot: string,
	input: { bytes: Uint8Array; name?: string; taskId?: string | null; options: CompressOptions; now?: Date },
): Promise<SavedAsset> {
	if (input.bytes.byteLength > MAX_ASSET_BYTES) throw new AssetError("Image is larger than 25 MB", 413);
	if (input.bytes.byteLength === 0) throw new AssetError("Empty upload", 400);
	const folder = assetFolderForTask(input.taskId);

	let result: Awaited<ReturnType<typeof compressImage>>;
	try {
		result = await compressImage(input.bytes, input.options);
	} catch (error) {
		if (error instanceof UnsupportedImageError) throw new AssetError(error.message, 415);
		if (error instanceof ImageDecodeError) throw new AssetError(error.message, 422);
		throw error;
	}

	const dir = join(assetsRoot, "images", folder);
	await mkdir(dir, { recursive: true });
	const stem = slugifyAssetName(input.name ?? "") || pasteAssetName(input.now);
	const temp = join(dir, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
	await writeFile(temp, result.bytes, { flag: "wx" });
	try {
		const target = await placeWithoutClobber(dir, stem, result.extension, (candidate) => link(temp, candidate));
		return {
			path: toPublicPath(assetsRoot, target),
			originalSize: input.bytes.byteLength,
			finalSize: result.bytes.byteLength,
			compressed: result.compressed,
		};
	} finally {
		await unlink(temp).catch(() => {});
	}
}

export async function listAssets(assetsRoot: string, taskId?: string | null): Promise<AssetEntry[]> {
	const currentFolder = taskId ? assetFolderForTask(taskId) : null;
	const entries: AssetEntry[] = [];

	const walk = async (dir: string): Promise<void> => {
		let items: import("node:fs").Dirent[];
		try {
			items = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const item of items) {
			if (item.name.startsWith(".")) continue;
			const fullPath = join(dir, item.name);
			if (item.isDirectory()) {
				await walk(fullPath);
				continue;
			}
			// Symlinks report neither isFile nor isDirectory here, so they are skipped.
			if (!item.isFile() || !IMAGE_EXTENSIONS.has(extname(item.name).slice(1).toLowerCase())) continue;
			const info = await stat(fullPath);
			const parts = relative(assetsRoot, fullPath).split(sep);
			const owner = parts[0] === "images" && parts.length > 2 ? (parts[1] ?? null) : null;
			entries.push({
				path: toPublicPath(assetsRoot, fullPath),
				name: item.name,
				size: info.size,
				mtime: info.mtime.toISOString(),
				taskId: owner && owner !== UNSORTED_FOLDER ? owner : null,
			});
		}
	};

	await walk(assetsRoot);
	const rank = (entry: AssetEntry) => (currentFolder !== null && entry.taskId === currentFolder ? 0 : 1);
	return entries.sort(
		(a, b) => rank(a) - rank(b) || b.mtime.localeCompare(a.mtime) || a.path.localeCompare(b.path),
	);
}
```

Notes:
- `link` gives a no-clobber rename: it fails with `EEXIST` when the name is taken. If `link` fails with `EPERM`/`ENOTSUP` on some file system, report it — do not silently switch to `rename`.
- Keep `toPublicPath` and `placeWithoutClobber` exported only because Task 4 in the same module uses them; if Biome or the reviewer flags unused exports, keep them module-local and let Task 4 use them in place.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/test/assets.test.ts src/test/image-compress.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/core/assets.ts src/test/assets.test.ts
git commit -m "feat(assets): add asset store with no-clobber saves and listing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC"
```

---

### Task 3: Config keys, server routes, Settings fields, compiled smoke check

**Files:**
- Modify: `src/types/index.ts` (`BacklogConfig`, near `maxColumnWidth?: number`)
- Modify: `src/file-system/operations.ts` (`parseConfig` switch near `:2131`, its return literal near `:2176-2203`, `serializeConfig` near `:2239`)
- Modify: `src/server/index.ts` (routes near `:444`, `handleAssetRequest` `:660-705`, `handleUpdateConfig` `:1508-1534`)
- Modify: `src/web/components/Settings.tsx` (after the Max Column Width input, `:389-404`)
- Modify: `scripts/smoke-compiled-build.ts` (inside the browser `try` block, after the stylesheet checks near `:262`)
- Test: `src/test/server-assets-upload.test.ts`

**Interfaces:**
- Consumes: `listAssets`, `saveAsset`, `AssetError`, `MAX_ASSET_BYTES` (Task 2); `compressOptionsFromConfig` (Task 1); `jpegFixture` (Task 1).
- Produces:
  - `BacklogConfig.imageMaxDimension?: number`, `BacklogConfig.imageQuality?: number`
  - `GET /api/assets?taskId=<id>` → `200 AssetEntry[]` (`400` on invalid taskId)
  - `POST /api/assets?taskId=<id>&name=<original name>` with the raw file as the body → `200 SavedAsset`, or `{ error }` with `400 | 413 | 415 | 422`
  - Server private helpers `assetsRoot(): string` and `assetErrorResponse(error, fallback): Response` (Task 4 uses `assetsRoot()`)

- [ ] **Step 1: Write the failing tests**

Create `src/test/server-assets-upload.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import decodeWebp from "@jsquash/webp/decode";
import { FileSystem } from "../file-system/operations.ts";
import { BacklogServer } from "../server/index.ts";
import { jpegFixture } from "./image-fixtures.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let server: BacklogServer | null = null;
let serverPort = 0;
let filesystem: FileSystem;

const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${serverPort}${path}`, init);
const upload = (query: string, body: BodyInit, type = "image/jpeg") =>
	request(`/api/assets?${query}`, { method: "POST", headers: { "Content-Type": type }, body });

beforeEach(async () => {
	TEST_DIR = createUniqueTestDir("server-assets-upload");
	filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Assets",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		autoCommit: false,
	});
	server = new BacklogServer(TEST_DIR);
	await server.start(0, false);
	serverPort = server.getPort() ?? 0;
	await retry(async () => {
		expect((await request("/api/assets")).status).toBe(200);
	});
});

afterEach(async () => {
	if (server) {
		await server.stop();
		server = null;
	}
	await safeCleanup(TEST_DIR);
});

describe("asset upload API", () => {
	it("lists nothing at first", async () => {
		expect(await (await request("/api/assets")).json()).toEqual([]);
	});

	it("compresses an upload, serves it, and lists it", async () => {
		const bytes = await jpegFixture(2400, 1600);
		const response = await upload("taskId=TASK-3&name=Screen%20Shot.jpg", bytes);
		expect(response.status).toBe(200);
		const saved = await response.json();
		expect(saved).toMatchObject({ path: "/assets/images/task-3/screen-shot.webp", compressed: true });

		const served = await request(saved.path);
		expect(served.status).toBe(200);
		expect(served.headers.get("content-type")).toBe("image/webp");

		const listed = await (await request("/api/assets?taskId=TASK-3")).json();
		expect(listed.map((entry: { path: string }) => entry.path)).toEqual([saved.path]);
	});

	it("uses the configured quality and size limits", async () => {
		await filesystem.saveConfig({ ...(await filesystem.loadConfig())!, imageMaxDimension: 300, imageQuality: 0.5 });
		const saved = await (await upload("taskId=TASK-3&name=a.jpg", await jpegFixture(1200, 800))).json();
		const webp = await (await request(saved.path)).arrayBuffer();
		// The server runs in this process, so the WebP decoder is already initialized by the upload.
		const image = await decodeWebp(webp);
		expect([image.width, image.height]).toEqual([300, 200]);
	});

	it("rejects bad input with the right status", async () => {
		expect((await upload("taskId=TASK-3", new TextEncoder().encode("hello"), "text/plain")).status).toBe(415);
		expect((await upload("taskId=TASK-3", new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2]))).status).toBe(422);
		expect((await upload("taskId=..%2Fx", await jpegFixture(64, 64))).status).toBe(400);
		expect((await request("/api/assets?taskId=a%2Fb")).status).toBe(400);
		const tooBig = await upload("taskId=TASK-3", new Uint8Array(25 * 1024 * 1024 + 1));
		expect(tooBig.status).toBe(413);
		expect(await tooBig.json()).toEqual({ error: "Image is larger than 25 MB" });
	});

	it("serves SVG files sandboxed", async () => {
		const assetsRoot = join(dirname(filesystem.docsDir), "assets");
		await mkdir(join(assetsRoot, "images"), { recursive: true });
		await writeFile(join(assetsRoot, "images", "x.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
		const response = await request("/assets/images/x.svg");
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

describe("image config keys", () => {
	it("round-trip through config.yml", async () => {
		const config = (await filesystem.loadConfig())!;
		await filesystem.saveConfig({ ...config, imageMaxDimension: 2560, imageQuality: 0.65 });
		const reloaded = await new FileSystem(TEST_DIR).loadConfig();
		expect(reloaded?.imageMaxDimension).toBe(2560);
		expect(reloaded?.imageQuality).toBe(0.65);
	});

	it("are validated by the config API", async () => {
		const config = await (await request("/api/config")).json();
		const put = (body: unknown) =>
			request("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		expect((await put({ ...config, imageMaxDimension: 100 })).status).toBe(400);
		expect((await put({ ...config, imageQuality: 1.5 })).status).toBe(400);
		expect((await put({ ...config, imageMaxDimension: 1024, imageQuality: 0.7 })).status).toBe(200);
	});
});
```

If `server.start(0, false)` or `getPort()` differ from `src/test/server-drafts-endpoint.test.ts`, copy that file's setup exactly instead.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/test/server-assets-upload.test.ts`
Expected: FAIL (the `/api/assets` route returns 404, so `beforeEach` retry fails).

- [ ] **Step 3: Add the config keys**

In `src/types/index.ts`, inside `BacklogConfig`, after `maxColumnWidth?: number;` add:

```ts
	imageMaxDimension?: number;
	imageQuality?: number;
```

In `src/file-system/operations.ts`:
1. In the `parseConfig` switch, next to `case "max_column_width":`, add:

```ts
				case "image_max_dimension":
					config.imageMaxDimension = Number.parseInt(value, 10);
					break;
				case "image_quality":
					config.imageQuality = Number.parseFloat(value);
					break;
```

2. In the object literal that `parseConfig` returns, next to `maxColumnWidth: config.maxColumnWidth,`, add:

```ts
			imageMaxDimension: config.imageMaxDimension,
			imageQuality: config.imageQuality,
```

3. In `serializeConfig`, next to the `max_column_width` line, add:

```ts
			...(Number.isFinite(config.imageMaxDimension) ? [`image_max_dimension: ${config.imageMaxDimension}`] : []),
			...(Number.isFinite(config.imageQuality) ? [`image_quality: ${config.imageQuality}`] : []),
```

Match the exact shape of the neighboring lines (variable names, indentation).

- [ ] **Step 4: Add the server routes and helpers**

In `src/server/index.ts`:

1. Imports (merge with existing imports; `dirname`/`join` are probably already imported):

```ts
import { AssetError, listAssets, MAX_ASSET_BYTES, saveAsset } from "../core/assets.ts";
import { compressOptionsFromConfig } from "../core/image-compress.ts";
```

2. In `serveOptions.routes`, right after the `"/api/config"` entry, add:

```ts
					"/api/assets": {
						GET: async (req: Request) => await this.handleListAssets(req),
						POST: async (req: Request) => await this.handleUploadAsset(req),
					},
```

3. Add these methods next to `handleAssetRequest`:

```ts
	private assetsRoot(): string {
		return join(dirname(this.core.filesystem.docsDir), "assets");
	}

	private assetErrorResponse(error: unknown, fallback: string): Response {
		if (error instanceof AssetError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		console.error(fallback, error);
		return Response.json({ error: fallback }, { status: 500 });
	}

	private async handleListAssets(req: Request): Promise<Response> {
		try {
			const taskId = new URL(req.url).searchParams.get("taskId");
			return Response.json(await listAssets(this.assetsRoot(), taskId));
		} catch (error) {
			return this.assetErrorResponse(error, "Failed to list assets");
		}
	}

	private async handleUploadAsset(req: Request): Promise<Response> {
		const declaredLength = Number(req.headers.get("content-length") ?? "0");
		if (declaredLength > MAX_ASSET_BYTES) {
			return Response.json({ error: "Image is larger than 25 MB" }, { status: 413 });
		}
		try {
			const url = new URL(req.url);
			const bytes = new Uint8Array(await req.arrayBuffer());
			const config = await this.core.filesystem.loadConfig();
			const saved = await saveAsset(this.assetsRoot(), {
				bytes,
				name: url.searchParams.get("name") ?? undefined,
				taskId: url.searchParams.get("taskId"),
				options: compressOptionsFromConfig(config),
			});
			return Response.json(saved);
		} catch (error) {
			return this.assetErrorResponse(error, "Failed to save image");
		}
	}
```

4. In `handleAssetRequest`, replace the three lines that compute `docsDir` / `backlogRoot` / `assetsRoot` with `const assetsRoot = this.assetsRoot();`, and replace the final `return new Response(file, { headers: { "Content-Type": mime } });` with:

```ts
			const headers: Record<string, string> = { "Content-Type": mime };
			if (ext === "svg") {
				// An uploaded SVG opened directly must not run scripts in the app origin.
				headers["Content-Security-Policy"] = "sandbox";
				headers["X-Content-Type-Options"] = "nosniff";
			}
			return new Response(file, { headers });
```

5. In `handleUpdateConfig`, after the existing `defaultPort` range check, add:

```ts
			if (
				updatedConfig.imageMaxDimension !== undefined &&
				!(Number.isInteger(updatedConfig.imageMaxDimension) &&
					updatedConfig.imageMaxDimension >= 256 &&
					updatedConfig.imageMaxDimension <= 8192)
			) {
				return Response.json({ error: "Image max dimension must be between 256 and 8192" }, { status: 400 });
			}
			if (
				updatedConfig.imageQuality !== undefined &&
				!(typeof updatedConfig.imageQuality === "number" &&
					updatedConfig.imageQuality >= 0.1 &&
					updatedConfig.imageQuality <= 1)
			) {
				return Response.json({ error: "Image quality must be between 0.1 and 1" }, { status: 400 });
			}
```

Match the variable name the handler uses for the parsed body (the explorer saw `updatedConfig`) and its response style.

- [ ] **Step 5: Run the server tests**

Run: `bun test src/test/server-assets-upload.test.ts src/test/server-assets.test.ts`
Expected: PASS (the existing `server-assets.test.ts` proves `/assets/*` still works).

- [ ] **Step 6: Add the Settings fields**

In `src/web/components/Settings.tsx`, after the Max Column Width input block, add two blocks that copy its markup and classes exactly, without the helper `<p>`:

```tsx
							<div>
								<label htmlFor="imageMaxDimension" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
									Image Max Dimension
								</label>
								<input
									id="imageMaxDimension"
									type="number"
									min="256"
									max="8192"
									step="1"
									value={config.imageMaxDimension ?? 1920}
									onChange={(e) => handleInputChange('imageMaxDimension', parseInt(e.target.value) || 1920)}
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200"
								/>
							</div>

							<div>
								<label htmlFor="imageQuality" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
									Image Quality
								</label>
								<input
									id="imageQuality"
									type="number"
									min="0.1"
									max="1"
									step="0.05"
									value={config.imageQuality ?? 0.8}
									onChange={(e) => handleInputChange('imageQuality', parseFloat(e.target.value) || 0.8)}
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200"
								/>
							</div>
```

If `handleInputChange` is typed to known keys, the new `BacklogConfig` fields make these calls type-check. Keep the indentation of the surrounding blocks.

- [ ] **Step 7: Add the compiled-binary smoke check**

In `scripts/smoke-compiled-build.ts`, add an import at the top:

```ts
import { jpegFixture } from "../src/test/image-fixtures.ts";
```

Inside the browser `try` block, after the stylesheet assertions, add:

```ts
	const uploadBytes = await jpegFixture(2400, 1600);
	const uploadResponse = await fetchWithTimeout(`${baseUrl}/api/assets?taskId=TASK-1&name=smoke.jpg`, {
		method: "POST",
		headers: { "Content-Type": "image/jpeg" },
		body: uploadBytes,
	});
	assert(uploadResponse.status === 200, `Asset upload returned ${uploadResponse.status}.`);
	const uploaded = (await uploadResponse.json()) as { path: string; compressed: boolean; finalSize: number };
	assert(uploaded.compressed && uploaded.finalSize < uploadBytes.byteLength, "Compiled binary did not compress the upload.");
	const uploadedFile = await fetchWithTimeout(`${baseUrl}${uploaded.path}`);
	assert(uploadedFile.headers.get("content-type") === "image/webp", "Uploaded asset is not served as WebP.");
```

If `fetchWithTimeout` accepts only a URL, extend it with an optional `init?: RequestInit` parameter passed to `fetch`. Then run the smoke test locally:

Run: `bun run build && bun scripts/smoke-compiled-build.ts dist/backlog "$(node -p 'require("./package.json").version')"`
Expected: the script finishes without an assertion error. Paste the last lines of output in the report.

- [ ] **Step 8: Type check and commit**

Run: `bunx tsc --noEmit && bun run check . && bun test src/test/server-assets-upload.test.ts src/test/server-assets.test.ts src/test/assets.test.ts`
Expected: all clean and PASS.

```bash
git add src/types/index.ts src/file-system/operations.ts src/server/index.ts src/web/components/Settings.tsx scripts/smoke-compiled-build.ts src/test/server-assets-upload.test.ts
git commit -m "feat(assets): add asset upload API, image config keys, and compiled smoke check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC"
```

---

### Task 4: Claim `_unsorted` assets when a task is created

**Files:**
- Modify: `src/core/assets.ts` (add `findUnsortedAssetLinks`, `claimUnsortedAssets`)
- Modify: `src/server/index.ts` (`handleCreateTask`, near `:1024` `return Response.json(createdTask, { status: 201 });`)
- Test: `src/test/assets-claim.test.ts`

**Interfaces:**
- Consumes: `assetFolderForTask`, `placeWithoutClobber`, `toPublicPath`, `UNSORTED_FOLDER` (Task 2); server `assetsRoot()` (Task 3); `Core.editTaskOrDraft(taskId: string, input: TaskUpdateInput): Promise<{ task: Task; cleanedTaskIds: string[] }>` and `FileSystem.listTasks(): Promise<Task[]>`, `FileSystem.listDrafts(): Promise<Task[]>` (existing).
- Produces:
  - `export function findUnsortedAssetLinks(markdown: string): string[]`
  - `export async function claimUnsortedAssets(core: AssetClaimCore, assetsRoot: string, task: Task): Promise<Task>` where `export interface AssetClaimCore { filesystem: { listTasks(): Promise<Task[]>; listDrafts(): Promise<Task[]> }; editTaskOrDraft(taskId: string, input: TaskUpdateInput): Promise<{ task: Task }> }`

- [ ] **Step 1: Write the failing tests**

Create `src/test/assets-claim.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { claimUnsortedAssets, findUnsortedAssetLinks } from "../core/assets.ts";
import { Core } from "../core/backlog.ts";
import { FileSystem } from "../file-system/operations.ts";
import { BacklogServer } from "../server/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let core: Core;
let assetsRoot: string;

const unsorted = async (name: string) => {
	await mkdir(join(assetsRoot, "images", "_unsorted"), { recursive: true });
	await writeFile(join(assetsRoot, "images", "_unsorted", name), `bytes of ${name}`);
	return `/assets/images/_unsorted/${name}`;
};

beforeEach(async () => {
	TEST_DIR = createUniqueTestDir("assets-claim");
	const filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Claim",
		statuses: ["To Do", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		autoCommit: false,
	});
	core = new Core(TEST_DIR);
	assetsRoot = join(dirname(core.filesystem.docsDir), "assets");
});

afterEach(async () => {
	await safeCleanup(TEST_DIR);
});

describe("findUnsortedAssetLinks", () => {
	it("finds each _unsorted link once", () => {
		const md = "![a](/assets/images/_unsorted/a.webp) and ![a](/assets/images/_unsorted/a.webp)\n![b](/assets/images/task-1/b.webp)";
		expect(findUnsortedAssetLinks(md)).toEqual(["/assets/images/_unsorted/a.webp"]);
	});
});

describe("claimUnsortedAssets", () => {
	it("moves linked files into the task folder and rewrites every field", async () => {
		const shot = await unsorted("shot.webp");
		const { task } = await core.createTaskFromInput({
			title: "With image",
			description: `See ![shot](${shot})`,
			implementationNotes: `Again ${shot}`,
		});
		const claimed = await claimUnsortedAssets(core, assetsRoot, task);
		const folder = task.id.toLowerCase();
		expect(claimed.description).toBe(`See ![shot](/assets/images/${folder}/shot.webp)`);
		expect(claimed.implementationNotes).toBe(`Again /assets/images/${folder}/shot.webp`);
		expect(await readdir(join(assetsRoot, "images", "_unsorted"))).toEqual([]);
		expect(await readdir(join(assetsRoot, "images", folder))).toEqual(["shot.webp"]);
		const onDisk = await core.filesystem.loadTask(task.id);
		expect(onDisk?.description).toContain(`/assets/images/${folder}/shot.webp`);
	});

	it("copies instead of moving when another saved task links the same file", async () => {
		const shared = await unsorted("shared.webp");
		await core.createTaskFromInput({ title: "Other", description: `![x](${shared})` });
		const { task } = await core.createTaskFromInput({ title: "Mine", description: `![x](${shared})` });
		const claimed = await claimUnsortedAssets(core, assetsRoot, task);
		expect(claimed.description).toContain(`/assets/images/${task.id.toLowerCase()}/shared.webp`);
		expect(await readdir(join(assetsRoot, "images", "_unsorted"))).toEqual(["shared.webp"]);
	});

	it("leaves links to missing files unchanged and returns the task as is without links", async () => {
		const { task } = await core.createTaskFromInput({
			title: "Missing",
			description: "![gone](/assets/images/_unsorted/gone.webp)",
		});
		expect((await claimUnsortedAssets(core, assetsRoot, task)).description).toBe(
			"![gone](/assets/images/_unsorted/gone.webp)",
		);
		const { task: plain } = await core.createTaskFromInput({ title: "Plain", description: "no images" });
		expect(await claimUnsortedAssets(core, assetsRoot, plain)).toBe(plain);
	});

	it("uses the draft ID folder for drafts", async () => {
		const shot = await unsorted("d.webp");
		const { task: draft } = await core.createTaskFromInput({ title: "Draft", status: "Draft", description: `![d](${shot})` });
		const claimed = await claimUnsortedAssets(core, assetsRoot, draft);
		expect(claimed.description).toBe(`![d](/assets/images/${draft.id.toLowerCase()}/d.webp)`);
	});
});

describe("POST /api/tasks", () => {
	let server: BacklogServer | null = null;

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
	});

	it("returns the created task with claimed asset links", async () => {
		const shot = await unsorted("new.webp");
		server = new BacklogServer(TEST_DIR);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		await retry(async () => expect((await fetch(`${base}/api/assets`)).status).toBe(200));
		const response = await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "From web", description: `![n](${shot})` }),
		});
		expect(response.status).toBe(201);
		const created = await response.json();
		expect(created.description).toBe(`![n](/assets/images/${created.id.toLowerCase()}/new.webp)`);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/test/assets-claim.test.ts`
Expected: FAIL, `findUnsortedAssetLinks` / `claimUnsortedAssets` are not exported.

- [ ] **Step 3: Implement the claim in `src/core/assets.ts`**

Update the imports: add `import { constants } from "node:fs";`, add `copyFile` to the existing `node:fs/promises` import (`link`, `mkdir`, `stat`, `unlink` are already there), and add `Task` and `TaskUpdateInput` to the existing `import type … from "../types/index.ts"`.

Add:

```ts
const UNSORTED_LINK = /\/assets\/images\/_unsorted\/[^\s)"'<>]+/g;
const CLAIMABLE_FIELDS = ["description", "implementationPlan", "implementationNotes", "finalSummary"] as const;

export interface AssetClaimCore {
	filesystem: { listTasks(): Promise<Task[]>; listDrafts(): Promise<Task[]> };
	editTaskOrDraft(taskId: string, input: TaskUpdateInput): Promise<{ task: Task }>;
}

export function findUnsortedAssetLinks(markdown: string): string[] {
	return [...new Set(markdown.match(UNSORTED_LINK) ?? [])];
}

async function fileExists(path: string): Promise<boolean> {
	return stat(path).then(
		(info) => info.isFile(),
		() => false,
	);
}

/**
 * Move images uploaded before the task had an ID from images/_unsorted/ into images/<task-id>/ and
 * rewrite the links. A file that another saved task or draft also links is copied, not moved.
 */
export async function claimUnsortedAssets(core: AssetClaimCore, assetsRoot: string, task: Task): Promise<Task> {
	const links = new Set(CLAIMABLE_FIELDS.flatMap((field) => findUnsortedAssetLinks(task[field] ?? "")));
	if (links.size === 0) return task;

	const others = [...(await core.filesystem.listTasks()), ...(await core.filesystem.listDrafts())].filter(
		(other) => other.id !== task.id,
	);
	const dir = join(assetsRoot, "images", assetFolderForTask(task.id));
	const replacements = new Map<string, string>();

	for (const linkPath of links) {
		const relPath = decodeURIComponent(linkPath.slice("/assets/".length));
		if (relPath.split("/").includes("..")) continue;
		const source = join(assetsRoot, ...relPath.split("/"));
		if (!(await fileExists(source))) continue;
		const shared = others.some((other) => CLAIMABLE_FIELDS.some((field) => (other[field] ?? "").includes(linkPath)));
		await mkdir(dir, { recursive: true });
		const extension = extname(source).slice(1);
		const target = await placeWithoutClobber(dir, basename(source, extname(source)), extension, (candidate) =>
			shared ? copyFile(source, candidate, constants.COPYFILE_EXCL) : link(source, candidate),
		);
		if (!shared) await unlink(source);
		replacements.set(linkPath, toPublicPath(assetsRoot, target));
	}
	if (replacements.size === 0) return task;

	const input: TaskUpdateInput = {};
	for (const field of CLAIMABLE_FIELDS) {
		const current = task[field];
		if (!current) continue;
		let next = current;
		for (const [from, to] of replacements) next = next.split(from).join(to);
		if (next !== current) input[field] = next;
	}
	const { task: updated } = await core.editTaskOrDraft(task.id, input);
	return updated;
}
```

If `TaskUpdateInput` does not accept one of the 4 field names, read its definition in `src/types/index.ts` (around line 140) and use its exact names; the Task field names are `description`, `implementationPlan`, `implementationNotes`, `finalSummary`.

- [ ] **Step 4: Call it from the create handler**

In `src/server/index.ts` `handleCreateTask`, replace `return Response.json(createdTask, { status: 201 });` with:

```ts
			const finalTask = await claimUnsortedAssets(this.core, this.assetsRoot(), createdTask).catch((error) => {
				// The task exists; a failed claim must not turn the create into an error.
				console.error("Failed to claim unsorted assets", error);
				return createdTask;
			});
			return Response.json(finalTask, { status: 201 });
```

Add `claimUnsortedAssets` to the existing `../core/assets.ts` import. If TypeScript says `this.core` does not match `AssetClaimCore`, check the real signatures of `editTaskOrDraft` (`src/core/backlog.ts:2691`) and `listTasks`/`listDrafts` (`src/file-system/operations.ts:948`, `:1316`) and adjust the interface to them (for example optional extra parameters).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/test/assets-claim.test.ts src/test/assets.test.ts src/test/server-assets-upload.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/assets.ts src/server/index.ts src/test/assets-claim.test.ts
git commit -m "feat(assets): claim unsorted uploads into the new task folder on create" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC"
```

---

### Task 5: Web helpers and API client methods

**Files:**
- Create: `src/web/lib/markdown-image-insert.ts`
- Test: `src/web/lib/markdown-image-insert.test.ts`
- Modify: `src/web/lib/api.ts` (add 2 methods to `ApiClient`, next to `fetchConfig` near `:432`)

**Interfaces:**
- Consumes: `AssetEntry`, `SavedAsset` from `src/types/index.ts` (Task 2); `POST/GET /api/assets` (Task 3).
- Produces:
  - `export function imageMarkdown(name: string, path: string): string`
  - `export function insertAtSelection(value: string, start: number, end: number, text: string): { value: string; cursor: number }`
  - `export function uploadPlaceholder(name: string): string`
  - `export function replaceFirst(value: string, search: string, replacement: string): string`
  - `export function imageFilesFrom(files: FileList | File[] | null | undefined): File[]`
  - `export function formatBytes(bytes: number): string`
  - `export function uploadToastMessage(saved: SavedAsset): string`
  - `export function fileNameFromPath(path: string): string`
  - `apiClient.listAssets(taskId?: string): Promise<AssetEntry[]>`
  - `apiClient.uploadAsset(file: Blob, name: string, taskId?: string): Promise<SavedAsset>`

- [ ] **Step 1: Write the failing tests**

Create `src/web/lib/markdown-image-insert.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	fileNameFromPath,
	formatBytes,
	imageFilesFrom,
	imageMarkdown,
	insertAtSelection,
	replaceFirst,
	uploadPlaceholder,
	uploadToastMessage,
} from "./markdown-image-insert";

describe("imageMarkdown", () => {
	it("uses the name without extension as alt text", () => {
		expect(imageMarkdown("my-shot.webp", "/assets/images/task-1/my-shot.webp")).toBe(
			"![my-shot](/assets/images/task-1/my-shot.webp)",
		);
	});

	it("strips characters that would break the alt text", () => {
		expect(imageMarkdown("a]b[c\\d.png", "/x.png")).toBe("![abcd](/x.png)");
	});
});

describe("insertAtSelection", () => {
	it("inserts at the cursor and replaces a selection", () => {
		expect(insertAtSelection("hello world", 5, 5, "!")).toEqual({ value: "hello! world", cursor: 6 });
		expect(insertAtSelection("hello world", 6, 11, "there")).toEqual({ value: "hello there", cursor: 11 });
	});

	it("clamps out-of-range positions", () => {
		expect(insertAtSelection("abc", 10, 20, "!")).toEqual({ value: "abc!", cursor: 4 });
		expect(insertAtSelection("abc", 2, 1, "!")).toEqual({ value: "ab!c", cursor: 3 });
	});
});

describe("placeholders", () => {
	it("creates unique placeholders for the same name", () => {
		const a = uploadPlaceholder("shot.png");
		const b = uploadPlaceholder("shot.png");
		expect(a).not.toBe(b);
		expect(a).toMatch(/^!\[Uploading shot\.png…\]\(uploading:[a-z0-9-]+\)$/);
	});

	it("replaces only the first occurrence and ignores missing text", () => {
		expect(replaceFirst("x P y P", "P", "Q")).toBe("x Q y P");
		expect(replaceFirst("abc", "zzz", "Q")).toBe("abc");
	});
});

describe("imageFilesFrom", () => {
	it("keeps image files only", () => {
		const png = new File(["x"], "a.png", { type: "image/png" });
		const txt = new File(["x"], "a.txt", { type: "text/plain" });
		expect(imageFilesFrom([png, txt])).toEqual([png]);
		expect(imageFilesFrom(null)).toEqual([]);
	});
});

describe("toast text", () => {
	it("formats sizes", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(180 * 1024)).toBe("180 KB");
		expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2 MB");
	});

	it("describes the upload result", () => {
		expect(
			uploadToastMessage({ path: "/x", originalSize: 3.2 * 1024 * 1024, finalSize: 180 * 1024, compressed: true }),
		).toBe("Compressed 3.2 MB → 180 KB");
		expect(uploadToastMessage({ path: "/x", originalSize: 10, finalSize: 10, compressed: false })).toBe(
			"Saved (not compressed)",
		);
	});

	it("reads the file name from a public path", () => {
		expect(fileNameFromPath("/assets/images/task-1/My%20Chart.svg")).toBe("My Chart.svg");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/web/lib/markdown-image-insert.test.ts`
Expected: FAIL, `Cannot find module './markdown-image-insert'`.

- [ ] **Step 3: Implement the helpers**

Create `src/web/lib/markdown-image-insert.ts`:

```ts
import type { SavedAsset } from "../../types";

const ALT_UNSAFE = /[[\]\\]/g;
let placeholderCounter = 0;

export function imageMarkdown(name: string, path: string): string {
	const alt = name.replace(/\.[^.]*$/, "").replace(ALT_UNSAFE, "").trim();
	return `![${alt}](${path})`;
}

export function insertAtSelection(
	value: string,
	start: number,
	end: number,
	text: string,
): { value: string; cursor: number } {
	const from = Math.max(0, Math.min(start, value.length));
	const to = Math.max(from, Math.min(end, value.length));
	return { value: value.slice(0, from) + text + value.slice(to), cursor: from + text.length };
}

export function uploadPlaceholder(name: string): string {
	placeholderCounter += 1;
	return `![Uploading ${name.replace(ALT_UNSAFE, "")}…](uploading:${Date.now().toString(36)}-${placeholderCounter})`;
}

export function replaceFirst(value: string, search: string, replacement: string): string {
	const index = value.indexOf(search);
	return index < 0 ? value : value.slice(0, index) + replacement + value.slice(index + search.length);
}

export function imageFilesFrom(files: FileList | File[] | null | undefined): File[] {
	return Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function uploadToastMessage(saved: SavedAsset): string {
	return saved.compressed
		? `Compressed ${formatBytes(saved.originalSize)} → ${formatBytes(saved.finalSize)}`
		: "Saved (not compressed)";
}

export function fileNameFromPath(path: string): string {
	return decodeURIComponent(path.split("/").pop() ?? path);
}
```

If the web code imports shared types from a different path than `../../types` (check `src/web/lib/api.ts` imports), use that path.

- [ ] **Step 4: Add the API client methods**

In `src/web/lib/api.ts`, add `AssetEntry` and `SavedAsset` to the existing type import from the types module, and add to `ApiClient` next to `fetchConfig`:

```ts
	async listAssets(taskId?: string): Promise<AssetEntry[]> {
		const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
		return this.fetchJson<AssetEntry[]>(`${API_BASE}/assets${query}`);
	}

	async uploadAsset(file: Blob, name: string, taskId?: string): Promise<SavedAsset> {
		const params = new URLSearchParams({ name });
		if (taskId) params.set("taskId", taskId);
		// Raw body upload: fetchWithRetry forces a JSON content type, so use fetch directly.
		const response = await fetch(`${API_BASE}/assets?${params.toString()}`, {
			method: "POST",
			headers: { "Content-Type": file.type || "application/octet-stream" },
			body: file,
		});
		if (!response.ok) {
			throw await ApiError.fromResponse(response);
		}
		return (await response.json()) as SavedAsset;
	}
```

Check the signature of `ApiError.fromResponse` (`src/web/lib/api.ts:92`): if it is not async, drop the `await`; if it needs a fallback message argument, pass `"Failed to upload image"`.

- [ ] **Step 5: Run the tests and type check**

Run: `bun test src/web/lib/markdown-image-insert.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/web/lib/markdown-image-insert.ts src/web/lib/markdown-image-insert.test.ts src/web/lib/api.ts
git commit -m "feat(assets): add web helpers and API client methods for image uploads" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC"
```

---

### Task 6: `TaskMarkdownEditor` with paste and drag-drop uploads

**Files:**
- Modify: `src/web/components/SuccessToast.tsx`
- Create: `src/web/components/TaskMarkdownEditor.tsx`
- Modify: `src/web/components/TaskDetailsModal.tsx` (the 4 `<MDEditor` blocks at about `:1299`, `:1620`, `:1644`, `:1718`, and the `MDEditor` import at `:8`)
- Test: `src/test/web-task-markdown-editor.test.tsx`

**Interfaces:**
- Consumes: helpers from `src/web/lib/markdown-image-insert.ts` and `apiClient.uploadAsset` (Task 5).
- Produces:
  - `SuccessToast` prop `tone?: "success" | "error"` (default `"success"`).
  - `export default function TaskMarkdownEditor(props: { value: string; onChange: (value: string) => void; taskId?: string; height: number; colorMode: string; placeholder?: string; onOverlayChange?: (open: boolean) => void }): JSX.Element` — Task 7 adds the picker and uses `onOverlayChange`; in this task the prop exists but nothing calls it yet.

- [ ] **Step 1: Write the failing tests**

Create `src/test/web-task-markdown-editor.test.tsx`. Copy the `setupDom`, `afterEach`, and `activeRoot`/`activeDom` pattern from `src/test/web-image-zoom-scope.test.tsx` (including the `ResizeObserver` and `matchMedia` stubs), then add:

```tsx
import { useState } from "react";
import TaskMarkdownEditor from "../web/components/TaskMarkdownEditor";
import { apiClient } from "../web/lib/api";

function Harness({ onValue, taskId }: { onValue: (value: string) => void; taskId?: string }) {
	const [value, setValue] = useState("Hello ");
	return (
		<TaskMarkdownEditor
			value={value}
			onChange={(next) => {
				setValue(next);
				onValue(next);
			}}
			taskId={taskId}
			height={200}
			colorMode="light"
		/>
	);
}

const renderEditor = async (onValue: (value: string) => void, taskId?: string) => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(<Harness onValue={onValue} taskId={taskId} />);
	});
	const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
	textarea.setSelectionRange(6, 6);
	return { container, textarea };
};

const pasteFiles = async (target: HTMLTextAreaElement, files: File[]) => {
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", { value: { files, types: ["Files"], getData: () => "" } });
	await act(async () => {
		target.dispatchEvent(event);
	});
	return event;
};

const flush = async () => {
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});
};

describe("TaskMarkdownEditor uploads", () => {
	const originalUpload = apiClient.uploadAsset.bind(apiClient);
	afterEach(() => {
		apiClient.uploadAsset = originalUpload;
	});

	it("inserts a placeholder at the cursor, then the uploaded image link and a toast", async () => {
		const calls: Array<[string, string | undefined]> = [];
		apiClient.uploadAsset = async (_file, name, taskId) => {
			calls.push([name, taskId]);
			return { path: "/assets/images/task-5/paste-1.webp", originalSize: 3_355_443, finalSize: 184_320, compressed: true };
		};
		const values: string[] = [];
		const { container, textarea } = await renderEditor((value) => values.push(value), "TASK-5");

		const event = await pasteFiles(textarea, [new File(["x"], "image.png", { type: "image/png" })]);
		expect(event.defaultPrevented).toBe(true);
		expect(values[0]).toMatch(/^Hello !\[Uploading pasted image…\]\(uploading:[a-z0-9-]+\)$/);

		await flush();
		expect(values.at(-1)).toBe("Hello ![paste-1](/assets/images/task-5/paste-1.webp)");
		expect(calls).toEqual([["", "TASK-5"]]);
		expect(container.textContent).toContain("Compressed 3.2 MB → 180 KB");
	});

	it("removes the placeholder and shows the error when the upload fails", async () => {
		apiClient.uploadAsset = async () => {
			throw new Error("Image is larger than 25 MB");
		};
		const values: string[] = [];
		const { container, textarea } = await renderEditor((value) => values.push(value));
		await pasteFiles(textarea, [new File(["x"], "big.png", { type: "image/png" })]);
		await flush();
		expect(values.at(-1)).toBe("Hello ");
		expect(container.textContent).toContain("Image is larger than 25 MB");
	});

	it("uploads several files in order, each replacing its own placeholder", async () => {
		const order: string[] = [];
		apiClient.uploadAsset = async (file) => {
			const name = (file as File).name;
			order.push(name);
			return { path: `/assets/images/_unsorted/${name.replace(".png", ".webp")}`, originalSize: 10, finalSize: 5, compressed: true };
		};
		const values: string[] = [];
		const { textarea } = await renderEditor((value) => values.push(value));
		const drop = new window.Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", {
			value: {
				files: [new File(["x"], "one.png", { type: "image/png" }), new File(["x"], "two.png", { type: "image/png" })],
				types: ["Files"],
			},
		});
		await act(async () => {
			textarea.dispatchEvent(drop);
		});
		await flush();
		await flush();
		expect(order).toEqual(["one.png", "two.png"]);
		expect(values.at(-1)).toBe(
			"Hello ![one](/assets/images/_unsorted/one.webp)\n![two](/assets/images/_unsorted/two.webp)",
		);
	});

	it("leaves a text paste alone", async () => {
		let uploads = 0;
		apiClient.uploadAsset = async () => {
			uploads += 1;
			throw new Error("should not upload");
		};
		const values: string[] = [];
		const { textarea } = await renderEditor((value) => values.push(value));
		const event = await pasteFiles(textarea, []);
		expect(event.defaultPrevented).toBe(false);
		expect(values).toEqual([]);
		expect(uploads).toBe(0);
	});
});
```

For a drop, the upload name is the file's own name (`one.png`), so the server slugs it; for a paste, the name is `""`, so the server uses `paste-YYYYMMDD-HHmmss`. The alt text always comes from the saved file name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/test/web-task-markdown-editor.test.tsx`
Expected: FAIL, `Cannot find module '../web/components/TaskMarkdownEditor'`.

- [ ] **Step 3: Add the `tone` prop to `SuccessToast`**

In `src/web/components/SuccessToast.tsx`, add `tone?: "success" | "error";` to the props, default it to `"success"` in the destructuring, and pick the color classes from it:

```tsx
	const colors =
		tone === "error"
			? "bg-red-600 dark:bg-red-700 border-red-500 dark:border-red-600"
			: "bg-green-500 dark:bg-green-600 border-green-400 dark:border-green-500";
```

Use `colors` in place of the green `bg-*`/`border-*` classes on the outer `div`, and add `role={tone === "error" ? "alert" : "status"}` to it. Keep every other class and the dismiss button unchanged.

- [ ] **Step 4: Implement `TaskMarkdownEditor`**

Create `src/web/components/TaskMarkdownEditor.tsx`:

```tsx
import MDEditor from "@uiw/react-md-editor";
import { type ClipboardEvent, type DragEvent, useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/api";
import {
	fileNameFromPath,
	imageFilesFrom,
	imageMarkdown,
	insertAtSelection,
	replaceFirst,
	uploadPlaceholder,
	uploadToastMessage,
} from "../lib/markdown-image-insert";
import { SuccessToast } from "./SuccessToast";

interface Props {
	value: string;
	onChange: (value: string) => void;
	taskId?: string;
	height: number;
	colorMode: string;
	placeholder?: string;
	onOverlayChange?: (open: boolean) => void;
}

interface Toast {
	message: string;
	tone: "success" | "error";
}

interface PendingUpload {
	file: File;
	uploadName: string;
	label: string;
}

export default function TaskMarkdownEditor({ value, onChange, taskId, height, colorMode, placeholder }: Props) {
	// Uploads finish after later keystrokes, so edits always start from the latest value.
	const valueRef = useRef(value);
	valueRef.current = value;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const queueRef = useRef<Promise<void>>(Promise.resolve());
	const [toast, setToast] = useState<Toast | null>(null);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 3000);
		return () => window.clearTimeout(timer);
	}, [toast]);

	const commit = (next: string) => {
		valueRef.current = next;
		onChangeRef.current(next);
	};

	const startUploads = (uploads: PendingUpload[], textarea: HTMLTextAreaElement) => {
		const placeholders = uploads.map((upload) => uploadPlaceholder(upload.label));
		commit(
			insertAtSelection(valueRef.current, textarea.selectionStart, textarea.selectionEnd, placeholders.join("\n")).value,
		);
		uploads.forEach((upload, index) => {
			const marker = placeholders[index] as string;
			queueRef.current = queueRef.current.then(async () => {
				try {
					const saved = await apiClient.uploadAsset(upload.file, upload.uploadName, taskId);
					commit(replaceFirst(valueRef.current, marker, imageMarkdown(fileNameFromPath(saved.path), saved.path)));
					setToast({ message: uploadToastMessage(saved), tone: "success" });
				} catch (error) {
					commit(replaceFirst(valueRef.current, marker, ""));
					setToast({ message: error instanceof Error ? error.message : "Upload failed", tone: "error" });
				}
			});
		});
	};

	const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = imageFilesFrom(event.clipboardData?.files);
		if (files.length === 0) return;
		event.preventDefault();
		startUploads(
			files.map((file) => ({ file, uploadName: "", label: "pasted image" })),
			event.currentTarget,
		);
	};

	const handleDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
		if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
	};

	const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
		const files = imageFilesFrom(event.dataTransfer?.files);
		if (files.length === 0) return;
		event.preventDefault();
		startUploads(
			files.map((file) => ({ file, uploadName: file.name, label: file.name })),
			event.currentTarget,
		);
	};

	return (
		<>
			<MDEditor
				value={value}
				onChange={(next) => commit(next || "")}
				preview="edit"
				height={height}
				data-color-mode={colorMode}
				textareaProps={{
					...(placeholder ? { placeholder } : {}),
					onPaste: handlePaste,
					onDragOver: handleDragOver,
					onDrop: handleDrop,
				}}
			/>
			{toast && <SuccessToast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
		</>
	);
}
```

`onOverlayChange` is part of the props for Task 7 and is not destructured yet (to satisfy `noUnusedLocals`/`noUnusedParameters`). If `data-color-mode` needs a narrower type than `string`, use the type of `theme` from `useTheme()`.

The `drop` test stubs `dataTransfer` without `selectionStart` changes; the jsdom textarea keeps the selection set by `setSelectionRange(6, 6)`.

- [ ] **Step 5: Run the component tests**

Run: `bun test src/test/web-task-markdown-editor.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Use it in `TaskDetailsModal`**

In `src/web/components/TaskDetailsModal.tsx`:
1. Replace `import MDEditor from "@uiw/react-md-editor";` with `import TaskMarkdownEditor from './TaskMarkdownEditor';` (match the quote style of the neighboring component imports). If `MDEditor` is still used elsewhere in the file, keep that import too.
2. Replace each of the 4 `<MDEditor … />` blocks:

```tsx
                <TaskMarkdownEditor
                  value={description}
                  onChange={setDescription}
                  taskId={task?.id}
                  height={320}
                  colorMode={theme}
                />
```

```tsx
                <TaskMarkdownEditor value={plan} onChange={setPlan} taskId={task?.id} height={280} colorMode={theme} />
```

```tsx
                <TaskMarkdownEditor value={notes} onChange={setNotes} taskId={task?.id} height={280} colorMode={theme} />
```

```tsx
                  <TaskMarkdownEditor
                    value={finalSummary}
                    onChange={setFinalSummary}
                    taskId={task?.id}
                    height={220}
                    colorMode={theme}
                    placeholder="PR-style summary of what was implemented (write when task is complete)"
                  />
```

Keep the wrapping `div`s and indentation of each site. The state setters accept a string, which matches `onChange: (value: string) => void`.

- [ ] **Step 7: Run the related tests**

Run: `bun test src/test/web-task-markdown-editor.test.tsx src/test/web-task-details-image-zoom.test.tsx src/test/web-task-details-modal-keyboard-shortcuts.test.tsx src/test/web-task-readiness-badge.test.tsx && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/web/components/SuccessToast.tsx src/web/components/TaskMarkdownEditor.tsx src/web/components/TaskDetailsModal.tsx src/test/web-task-markdown-editor.test.tsx
git commit -m "feat(assets): upload pasted and dropped images from the task editors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC"
```

---

### Task 7: Asset picker and toolbar command

**Files:**
- Create: `src/web/components/AssetPickerModal.tsx`
- Modify: `src/web/components/TaskMarkdownEditor.tsx`
- Modify: `src/web/components/TaskDetailsModal.tsx` (the `lightboxOpen` state/ref and `suspendKeyHandling` added in phase 1; the 4 `TaskMarkdownEditor` sites)
- Test: `src/test/web-asset-picker.test.tsx`

**Interfaces:**
- Consumes: `apiClient.listAssets`, `apiClient.uploadAsset`, `imageMarkdown`, `insertAtSelection`, `uploadToastMessage` (Task 5); `Modal` (existing); `TaskMarkdownEditor` (Task 6).
- Produces:
  - `export default function AssetPickerModal(props: { isOpen: boolean; taskId?: string; onClose: () => void; onInsert: (markdown: string) => void; onUploaded?: (saved: SavedAsset) => void }): JSX.Element | null`
  - `TaskMarkdownEditor` calls `onOverlayChange(true)` when the picker opens and `onOverlayChange(false)` when it closes or the editor unmounts while it is open.
  - The toolbar button has `aria-label="Insert image from assets"`.

- [ ] **Step 1: Write the failing tests**

Create `src/test/web-asset-picker.test.tsx`. Copy the `setupDom`/`afterEach` pattern from `src/test/web-image-zoom-scope.test.tsx`, then add:

```tsx
import AssetPickerModal from "../web/components/AssetPickerModal";
import { apiClient } from "../web/lib/api";
import type { AssetEntry } from "../types";

const assets: AssetEntry[] = [
	{ path: "/assets/images/task-5/new.webp", name: "new.webp", size: 10, mtime: "2026-09-30T10:00:00.000Z", taskId: "task-5" },
	{ path: "/assets/images/task-5/old.webp", name: "old.webp", size: 10, mtime: "2026-09-29T10:00:00.000Z", taskId: "task-5" },
	{ path: "/assets/images/task-9/other.webp", name: "other.webp", size: 10, mtime: "2026-09-30T11:00:00.000Z", taskId: "task-9" },
];

const renderPicker = async (onInsert: (markdown: string) => void, onClose = () => {}) => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(<AssetPickerModal isOpen={true} taskId="TASK-5" onClose={onClose} onInsert={onInsert} />);
		await Promise.resolve();
	});
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});
	return container;
};

const tile = (name: string) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find((button) =>
		button.textContent?.includes(name),
	) as HTMLButtonElement;

const click = async (element: Element, type = "click") => {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
	});
};

describe("AssetPickerModal", () => {
	const originalList = apiClient.listAssets.bind(apiClient);
	const originalUpload = apiClient.uploadAsset.bind(apiClient);
	afterEach(() => {
		apiClient.listAssets = originalList;
		apiClient.uploadAsset = originalUpload;
	});

	it("groups this task's images first and filters by name", async () => {
		apiClient.listAssets = async () => assets;
		await renderPicker(() => {});
		const headings = Array.from(document.querySelectorAll("h3")).map((heading) => heading.textContent);
		expect(headings).toEqual(["This task", "All assets"]);
		const search = document.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			setter?.call(search, "oth");
			search.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		expect(document.querySelectorAll("button[aria-pressed]")).toHaveLength(1);
	});

	it("inserts selected images in selection order and closes", async () => {
		apiClient.listAssets = async () => assets;
		const inserted: string[] = [];
		let closed = 0;
		await renderPicker((markdown) => inserted.push(markdown), () => {
			closed += 1;
		});
		await click(tile("other.webp"));
		await click(tile("new.webp"));
		expect(tile("other.webp").getAttribute("aria-pressed")).toBe("true");
		const insert = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Insert (2)");
		await click(insert as HTMLButtonElement);
		expect(inserted).toEqual([
			"![other](/assets/images/task-9/other.webp)\n![new](/assets/images/task-5/new.webp)",
		]);
		expect(closed).toBe(1);
	});

	it("inserts one image on double-click", async () => {
		apiClient.listAssets = async () => assets;
		const inserted: string[] = [];
		await renderPicker((markdown) => inserted.push(markdown));
		await click(tile("old.webp"), "dblclick");
		expect(inserted).toEqual(["![old](/assets/images/task-5/old.webp)"]);
	});

	it("uploads files and selects the new images", async () => {
		let listed = [...assets];
		apiClient.listAssets = async () => listed;
		apiClient.uploadAsset = async (_file, name) => {
			const saved = { path: `/assets/images/task-5/${name.replace(".png", ".webp")}`, originalSize: 10, finalSize: 5, compressed: true };
			listed = [{ path: saved.path, name: name.replace(".png", ".webp"), size: 5, mtime: "2026-09-30T12:00:00.000Z", taskId: "task-5" }, ...listed];
			return saved;
		};
		await renderPicker(() => {});
		const input = document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, "files", { value: [new File(["x"], "fresh.png", { type: "image/png" })] });
		await act(async () => {
			input.dispatchEvent(new window.Event("change", { bubbles: true }));
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});
		await act(async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});
		expect(tile("fresh.webp").getAttribute("aria-pressed")).toBe("true");
	});
});
```

Add one integration test in the same file for the key guard. Reuse the `TaskDetailsModal` render from `src/test/web-task-details-image-zoom.test.tsx` (same providers, a task with a description), stub `apiClient.listAssets = async () => assets`, click the `Edit` button, click `button[aria-label="Insert image from assets"]`, then dispatch a `keydown` Escape on `document.activeElement ?? document.body` and wait one tick. Assert: the picker is closed (no `input[type="search"]`), the modal is still in edit mode (a `Save` button is present), and `onClose` of the task modal was not called.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/test/web-asset-picker.test.tsx`
Expected: FAIL, `Cannot find module '../web/components/AssetPickerModal'`.

- [ ] **Step 3: Implement `AssetPickerModal`**

Create `src/web/components/AssetPickerModal.tsx`:

```tsx
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetEntry, SavedAsset } from "../../types";
import { apiClient } from "../lib/api";
import { imageMarkdown } from "../lib/markdown-image-insert";
import Modal from "./Modal";

interface Props {
	isOpen: boolean;
	taskId?: string;
	onClose: () => void;
	onInsert: (markdown: string) => void;
	onUploaded?: (saved: SavedAsset) => void;
}

export default function AssetPickerModal({ isOpen, taskId, onClose, onInsert, onUploaded }: Props) {
	const [assets, setAssets] = useState<AssetEntry[]>([]);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const currentFolder = taskId?.toLowerCase() ?? null;

	const reload = async () => {
		try {
			setAssets(await apiClient.listAssets(taskId));
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : "Failed to load images");
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the picker opens or the task changes.
	useEffect(() => {
		if (!isOpen) return;
		setQuery("");
		setSelected([]);
		setError(null);
		void reload();
	}, [isOpen, taskId]);

	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle ? assets.filter((asset) => asset.name.toLowerCase().includes(needle)) : assets;
	}, [assets, query]);
	const mine = visible.filter((asset) => currentFolder !== null && asset.taskId === currentFolder);
	const others = visible.filter((asset) => !(currentFolder !== null && asset.taskId === currentFolder));

	const toggle = (path: string) =>
		setSelected((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path]));

	const insert = (paths: string[]) => {
		const byPath = new Map(assets.map((asset) => [asset.path, asset]));
		const markdown = paths
			.map((path) => byPath.get(path))
			.filter((asset): asset is AssetEntry => Boolean(asset))
			.map((asset) => imageMarkdown(asset.name, asset.path))
			.join("\n");
		if (markdown) onInsert(markdown);
		onClose();
	};

	const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.currentTarget.files ?? []);
		event.currentTarget.value = "";
		if (files.length === 0) return;
		setUploading(true);
		setError(null);
		const added: string[] = [];
		for (const file of files) {
			try {
				const saved = await apiClient.uploadAsset(file, file.name, taskId);
				added.push(saved.path);
				onUploaded?.(saved);
			} catch (uploadError) {
				setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
			}
		}
		await reload();
		setSelected((current) => [...added, ...current.filter((path) => !added.includes(path))]);
		setUploading(false);
	};

	if (!isOpen) return null;

	const renderGroup = (title: string, items: AssetEntry[]) =>
		items.length > 0 && (
			<section className="mb-4">
				<h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{items.map((asset) => {
						const isSelected = selected.includes(asset.path);
						return (
							<button
								key={asset.path}
								type="button"
								aria-pressed={isSelected}
								onClick={() => toggle(asset.path)}
								onDoubleClick={() => insert([asset.path])}
								className={`overflow-hidden rounded-lg border text-left transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
									isSelected
										? "border-blue-500 ring-2 ring-blue-500"
										: "border-gray-200 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500"
								}`}
							>
								<img src={asset.path} alt={asset.name} loading="lazy" className="h-24 w-full bg-gray-100 object-cover dark:bg-gray-900" />
								<span className="block truncate px-2 py-1 text-xs text-gray-700 dark:text-gray-300">{asset.name}</span>
							</button>
						);
					})}
				</div>
			</section>
		);

	return createPortal(
		<Modal
			isOpen={true}
			onClose={onClose}
			title="Images"
			maxWidthClass="max-w-3xl"
			actions={
				<div className="flex items-center gap-2">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						multiple
						className="hidden"
						onChange={(event) => void handleFiles(event)}
					/>
					<button
						type="button"
						disabled={uploading}
						onClick={() => fileInputRef.current?.click()}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
					>
						{uploading ? "Uploading…" : "Upload"}
					</button>
					<button
						type="button"
						disabled={selected.length === 0}
						onClick={() => insert(selected)}
						className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{selected.length > 0 ? `Insert (${selected.length})` : "Insert"}
					</button>
				</div>
			}
		>
			<input
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search"
				aria-label="Search images"
				className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
			/>
			{error && (
				<div role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
					{error}
				</div>
			)}
			{renderGroup("This task", mine)}
			{renderGroup("All assets", others)}
		</Modal>,
		document.body,
	);
}
```

Check `Modal`'s props in `src/web/components/Modal.tsx` (`title`, `maxWidthClass`, `actions` exist). The search input's `placeholder="Search"` is an input placeholder, not helper text.

- [ ] **Step 4: Add the toolbar command and overlay reporting to `TaskMarkdownEditor`**

In `src/web/components/TaskMarkdownEditor.tsx`:

1. Change the MDEditor import to `import MDEditor, { commands as mdCommands, type ICommand } from "@uiw/react-md-editor";` and add `import AssetPickerModal from "./AssetPickerModal";`. Destructure `onOverlayChange` from props.

2. Add state and refs inside the component:

```tsx
	const [pickerOpen, setPickerOpen] = useState(false);
	const selectionRef = useRef({ start: value.length, end: value.length });
	const onOverlayChangeRef = useRef(onOverlayChange);
	onOverlayChangeRef.current = onOverlayChange;
	const pickerOpenRef = useRef(false);

	useEffect(() => {
		pickerOpenRef.current = pickerOpen;
		onOverlayChangeRef.current?.(pickerOpen);
	}, [pickerOpen]);

	// If the editor unmounts while the picker is open, the parent must not stay in "overlay open".
	useEffect(
		() => () => {
			if (pickerOpenRef.current) onOverlayChangeRef.current?.(false);
		},
		[],
	);
```

The first effect also runs once on mount with `false`; that is harmless because `false` is the parent's initial value.

3. Add the command (inside the component, so it closes over `setPickerOpen`):

```tsx
	const pickerCommand: ICommand = {
		name: "asset-picker",
		keyCommand: "asset-picker",
		buttonProps: { "aria-label": "Insert image from assets", title: "Insert image from assets" },
		icon: (
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
				<rect x="3" y="3" width="18" height="18" rx="2" />
				<circle cx="8.5" cy="8.5" r="1.5" />
				<path d="M21 15l-5-5L5 21" />
			</svg>
		),
		execute: (state) => {
			selectionRef.current = { start: state.selection.start, end: state.selection.end };
			setPickerOpen(true);
		},
	};
```

4. Pass `commands={[...mdCommands.getCommands(), mdCommands.divider, pickerCommand]}` to `MDEditor`.

5. Render the picker after the toast:

```tsx
			<AssetPickerModal
				isOpen={pickerOpen}
				taskId={taskId}
				onClose={() => setPickerOpen(false)}
				onInsert={(markdown) => {
					const { start, end } = selectionRef.current;
					commit(insertAtSelection(valueRef.current, start, end, markdown).value);
				}}
				onUploaded={(saved) => setToast({ message: uploadToastMessage(saved), tone: "success" })}
			/>
```

- [ ] **Step 5: Treat the picker like the lightbox in `TaskDetailsModal`**

In `src/web/components/TaskDetailsModal.tsx`, next to `const [lightboxOpen, setLightboxOpen] = useState(false);`:

```tsx
  const [editorOverlayOpen, setEditorOverlayOpen] = useState(false);
  const overlayOpen = lightboxOpen || editorOverlayOpen;
```

Then:
- Change `suspendKeyHandling={lightboxOpen}` to `suspendKeyHandling={overlayOpen}`.
- Change the phase-1 ref so the `window` `onKey` guard covers both: `lightboxOpenRef.current = lightboxOpen;` becomes `overlayOpenRef.current = overlayOpen;` (rename the ref to `overlayOpenRef` at its declaration and at the `if (… .current) return;` line in `onKey`).
- Pass `onOverlayChange={setEditorOverlayOpen}` to each of the 4 `TaskMarkdownEditor` elements.

- [ ] **Step 6: Run the tests**

Run: `bun test src/test/web-asset-picker.test.tsx src/test/web-task-markdown-editor.test.tsx src/test/web-task-details-image-zoom.test.tsx src/test/web-task-details-modal-keyboard-shortcuts.test.tsx && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Definition of done**

Run: `bunx tsc --noEmit && bun run check . && bun test`
Expected: clean type check and lint; only the known pre-existing failures listed in Global Constraints.

- [ ] **Step 8: Commit**

```bash
git add src/web/components/AssetPickerModal.tsx src/web/components/TaskMarkdownEditor.tsx src/web/components/TaskDetailsModal.tsx src/test/web-asset-picker.test.tsx
git commit -m "feat(assets): add image picker to the task editor toolbar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013yqnsg7HFt3E7RreoDQSUC"
```

---

## Notes for later phases

- Phase 4 README "Fork features" must mention the 2 config keys and that AVIF, GIF, and SVG are saved unchanged.
- An "unused assets" report can build on `listAssets` plus `findUnsortedAssetLinks`-style scanning; it is out of scope now.
