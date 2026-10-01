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
		const md =
			"![a](/assets/images/_unsorted/a.webp) and ![a](/assets/images/_unsorted/a.webp)\n![b](/assets/images/task-1/b.webp)";
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
		const { task: draft } = await core.createTaskFromInput({
			title: "Draft",
			status: "Draft",
			description: `![d](${shot})`,
		});
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
