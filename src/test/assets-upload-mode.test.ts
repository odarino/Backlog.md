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
		const saved = await saveAsset(root, {
			bytes: PNG,
			name: "shot",
			taskId: null,
			options: compressOptionsFromConfig(null),
			mode: "original",
		});
		expect(saved.path.endsWith(".png")).toBe(true);
		expect(saved.compressed).toBe(false);
		expect(saved.finalSize).toBe(PNG.byteLength);
		const file = join(root, saved.path.replace(/^.*?assets\//, ""));
		expect(new Uint8Array(await readFile(file))).toEqual(PNG);
	});

	it("rejects unknown bytes in original mode with 415", async () => {
		await expect(
			saveAsset(root, {
				bytes: new Uint8Array([1, 2, 3]),
				taskId: null,
				options: compressOptionsFromConfig(null),
				mode: "original",
			}),
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
