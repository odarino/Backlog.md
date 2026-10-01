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
		expect(slugifyAssetName(`${"a".repeat(79)} b.png`)).toBe("a".repeat(79));
		expect(slugifyAssetName("con.png")).toBe("con-image");
		expect(slugifyAssetName("COM1.png")).toBe("com1-image");
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
		const cases: Array<[Uint8Array, 400 | 413 | 415 | 422]> = [
			[new Uint8Array(MAX_ASSET_BYTES + 1), 413],
			[new TextEncoder().encode("plain text"), 415],
			[new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]), 422],
			[new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]), 422],
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
		await symlink(join(root, "images/task-1/old.png"), join(root, "images/task-1/link.png")).catch(() => {});

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
