import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { lstat, mkdir, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AssetClaimCore, claimUnsortedAssets, findUnsortedAssetLinks } from "../core/assets.ts";
import { Core } from "../core/backlog.ts";
import { FileSystem } from "../file-system/operations.ts";
import { BacklogServer } from "../server/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let core: Core;
let assetsRoot: string;

const exists = (path: string) =>
	lstat(path).then(
		() => true,
		() => false,
	);
const taskFolderFiles = (id: string) => readdir(join(assetsRoot, "images", id.toLowerCase())).catch(() => []);

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
	it("does not match a link that contains a backslash or runs into other text", () => {
		expect(findUnsortedAssetLinks("![x](/assets/images/_unsorted/..\\..\\secret.txt)")).toEqual([]);
		expect(findUnsortedAssetLinks("![x](/assets/images/_unsorted/a.webp\\b)")).toEqual([]);
		expect(findUnsortedAssetLinks("<img src='/assets/images/_unsorted/a.webp'>")).toEqual([
			"/assets/images/_unsorted/a.webp",
		]);
	});

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

	it("skips links that leave _unsorted and leaves the files and the link text alone", async () => {
		const unsortedDir = join(assetsRoot, "images", "_unsorted");
		await mkdir(unsortedDir, { recursive: true });
		// On POSIX this is a file named "..\\..\\secret.txt" inside _unsorted; on Windows it is assets/secret.txt.
		// Either way the claim must not touch it.
		const backslashed = join(unsortedDir, "..\\..\\secret.txt");
		await writeFile(backslashed, "secret");
		const outside = join(assetsRoot, "outside.txt");
		await writeFile(outside, "outside");
		const description = [
			"![a](/assets/images/_unsorted/..%5C..%5Csecret.txt)",
			"![b](/assets/images/_unsorted/..\\..\\secret.txt)",
			"![c](/assets/images/_unsorted/%2e%2e/%2e%2e/outside.txt)",
			"![d](/assets/images/_unsorted/../../outside.txt)",
			"![e](/assets/images/_unsorted/.%2F..%2F..%2Foutside.txt)",
		].join("\n");
		const { task } = await core.createTaskFromInput({ title: "Traversal", description });
		const claimed = await claimUnsortedAssets(core, assetsRoot, task);
		expect(claimed.description).toBe(description);
		expect(await exists(backslashed)).toBe(true);
		expect(await exists(outside)).toBe(true);
		expect(await taskFolderFiles(task.id)).toEqual([]);
	});

	it("does not move a symlink in _unsorted that points outside", async () => {
		const unsortedDir = join(assetsRoot, "images", "_unsorted");
		await mkdir(unsortedDir, { recursive: true });
		const outside = join(assetsRoot, "private.webp");
		await writeFile(outside, "private");
		const linked = join(unsortedDir, "linked.webp");
		// Windows CI without symlink privileges cannot create it; the test then only checks the link text.
		await symlink(outside, linked).catch(() => {});
		const description = "![l](/assets/images/_unsorted/linked.webp)";
		const { task } = await core.createTaskFromInput({ title: "Symlink", description });
		const claimed = await claimUnsortedAssets(core, assetsRoot, task);
		expect(claimed.description).toBe(description);
		expect(await stat(outside).then((info) => info.isFile())).toBe(true);
		expect(await taskFolderFiles(task.id)).toEqual([]);
	});

	it("keeps every source and removes placed files when the task update fails", async () => {
		const one = await unsorted("one.webp");
		const two = await unsorted("two.webp");
		const { task } = await core.createTaskFromInput({ title: "Fails", description: `![1](${one}) ![2](${two})` });
		const failing: AssetClaimCore = {
			filesystem: core.filesystem,
			editTaskOrDraft: async () => {
				throw new Error("disk full");
			},
		};
		await expect(claimUnsortedAssets(failing, assetsRoot, task)).rejects.toThrow("disk full");
		expect((await readdir(join(assetsRoot, "images", "_unsorted"))).sort()).toEqual(["one.webp", "two.webp"]);
		expect(await taskFolderFiles(task.id)).toEqual([]);
	});

	it("skips a link with a malformed escape and still claims the others", async () => {
		await unsorted("100%.png");
		const valid = await unsorted("ok.webp");
		const { task } = await core.createTaskFromInput({
			title: "Malformed",
			description: `![m](/assets/images/_unsorted/100%.png) ![v](${valid})`,
		});
		const claimed = await claimUnsortedAssets(core, assetsRoot, task);
		const folder = task.id.toLowerCase();
		expect(claimed.description).toBe(`![m](/assets/images/_unsorted/100%.png) ![v](/assets/images/${folder}/ok.webp)`);
		expect(await readdir(join(assetsRoot, "images", "_unsorted"))).toEqual(["100%.png"]);
	});

	it("copies instead of moving when a completed task links the same file", async () => {
		const shared = await unsorted("done.webp");
		const { task: other } = await core.createTaskFromInput({ title: "Done one", description: `![x](${shared})` });
		expect(await core.completeTask(other.id)).toBe(true);
		const { task } = await core.createTaskFromInput({ title: "Mine", description: `![x](${shared})` });
		const claimed = await claimUnsortedAssets(core, assetsRoot, task);
		expect(claimed.description).toContain(`/assets/images/${task.id.toLowerCase()}/done.webp`);
		expect(await readdir(join(assetsRoot, "images", "_unsorted"))).toEqual(["done.webp"]);
	});

	it("matches a link only up to its end, not as a prefix of a longer name", async () => {
		const short = await unsorted("a.webp");
		const long = await unsorted("a.webp.png");
		// Another task links only the longer name, so only that file is shared.
		await core.createTaskFromInput({ title: "Other", description: `![l](${long})` });
		const { task } = await core.createTaskFromInput({ title: "Both", description: `![s](${short}) ![l](${long})` });
		const claimed = await claimUnsortedAssets(core, assetsRoot, task);
		const folder = task.id.toLowerCase();
		expect(claimed.description).toBe(`![s](/assets/images/${folder}/a.webp) ![l](/assets/images/${folder}/a.webp.png)`);
		expect(await readdir(join(assetsRoot, "images", "_unsorted"))).toEqual(["a.webp.png"]);
		expect((await taskFolderFiles(task.id)).sort()).toEqual(["a.webp", "a.webp.png"]);
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
