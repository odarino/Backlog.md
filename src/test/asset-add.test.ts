import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { addAssetFromFile } from "../core/asset-add.ts";
import { Core } from "../core/backlog.ts";
import { pngFixture } from "./image-fixtures.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();

let TEST_DIR: string;
let core: Core;
let pngPath: string;

describe("asset add", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("asset-add");
		await mkdir(TEST_DIR, { recursive: true });
		core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "Asset Project");
		pngPath = join(TEST_DIR, "shot.png");
		await writeFile(pngPath, await pngFixture(300, 150));
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

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

	it("prints markdown from the CLI", async () => {
		const result = await $`bun ${CLI_PATH} asset add ${pngPath} --original`.cwd(TEST_DIR).quiet();
		expect(result.stdout.toString()).toContain("![");
	});
});
