import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import {
	countStatusUsage,
	removeStatus,
	renameStatus,
	validateStatusColors,
	validateStatusList,
	validateStatusName,
	WorkflowError,
} from "../core/workflow.ts";
import { parseTask } from "../markdown/parser.ts";
import type { BacklogConfig } from "../types/index.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let core: Core;

interface Fixtures {
	todo: string;
	inProgress: string;
	review: string[];
	completedDone: string;
	draft: string;
}

const STATUS_LINE = /^status:.*$/m;

async function setupProject(dir: string, overrides: Partial<BacklogConfig> = {}): Promise<Core> {
	const instance = new Core(dir);
	await instance.fs.ensureBacklogStructure();
	await instance.fs.saveConfig({
		projectName: "Workflow",
		statuses: ["To Do", "In Progress", "Review", "Done"],
		defaultStatus: "Review",
		statusColors: { Review: "#8b5cf6" },
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		autoCommit: false,
		...overrides,
	});
	return instance;
}

async function setStatusLine(filePath: string, status: string): Promise<void> {
	const text = await Bun.file(filePath).text();
	await Bun.write(filePath, text.replace(STATUS_LINE, `status: ${status}`));
}

async function readStatus(filePath: string): Promise<string> {
	return parseTask(await Bun.file(filePath).text()).status;
}

async function createActive(title: string, status: string): Promise<string> {
	const { task, filePath } = await core.createTaskFromInput({ title, status }, false);
	const path = filePath ?? task.filePath;
	if (!path) throw new Error(`No file path for ${title}`);
	return path;
}

async function completedPath(id: string): Promise<string> {
	const found = (await core.fs.listCompletedTasks()).find((task) => task.id === id);
	if (!found?.filePath) throw new Error(`Completed task ${id} not found`);
	return found.filePath;
}

async function archivedPath(id: string): Promise<string> {
	const found = (await core.fs.listArchivedTasks()).find((task) => task.id === id);
	if (!found?.filePath) throw new Error(`Archived task ${id} not found`);
	return found.filePath;
}

/** Active, completed, and archived tasks, two of them with Review spelled differently on disk. */
async function seedTasks(): Promise<Fixtures> {
	const todo = await createActive("Todo task", "To Do");
	const inProgress = await createActive("Progress task", "In Progress");
	const reviewA = await createActive("Review A", "Review");
	const reviewLower = await createActive("Review lower", "Review");
	await setStatusLine(reviewLower, "review");

	const { task: doneTask } = await core.createTaskFromInput({ title: "Done task", status: "Done" }, false);
	await core.completeTask(doneTask.id, false);
	const completedDone = await completedPath(doneTask.id);

	const { task: doneReview } = await core.createTaskFromInput({ title: "Completed review", status: "Done" }, false);
	await core.completeTask(doneReview.id, false);
	const completedReview = await completedPath(doneReview.id);
	await setStatusLine(completedReview, "Review");

	const { task: archived } = await core.createTaskFromInput({ title: "Archived review", status: "Review" }, false);
	await core.archiveTask(archived.id, false);
	const archivedReview = await archivedPath(archived.id);

	const { task: draftTask, filePath: draftFile } = await core.createTaskFromInput(
		{ title: "Draft task", status: "Draft" },
		false,
	);
	const draft = draftFile ?? draftTask.filePath;
	if (!draft) throw new Error("No draft path");

	return { todo, inProgress, review: [reviewA, reviewLower, completedReview, archivedReview], completedDone, draft };
}

function expectWorkflowError(fn: () => unknown, status: WorkflowError["status"]): void {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(WorkflowError);
		expect((error as WorkflowError).status).toBe(status);
		return;
	}
	throw new Error("Expected a WorkflowError");
}

async function expectRejects(
	promise: Promise<unknown>,
	status: WorkflowError["status"],
	message?: string,
): Promise<void> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(WorkflowError);
		expect((error as WorkflowError).status).toBe(status);
		if (message) expect((error as Error).message).toBe(message);
		return;
	}
	throw new Error("Expected a WorkflowError");
}

describe("workflow validation", () => {
	it("validateStatusName trims a valid name", () => {
		expect(validateStatusName("  QA  ")).toBe("QA");
	});

	it("validateStatusName rejects invalid names with 400", () => {
		for (const name of ["", "a".repeat(41), 'a"b', "a\\b", "a\nb", "a\tb", "Draft", " draft "]) {
			expectWorkflowError(() => validateStatusName(name), 400);
		}
	});

	it("validateStatusList needs 2 unique statuses", () => {
		expectWorkflowError(() => validateStatusList(["Only"]), 400);
		expectWorkflowError(() => validateStatusList(["To Do", "todo"]), 400);
		expect(validateStatusList(["To Do", "Done"])).toEqual(["To Do", "Done"]);
	});

	it("validateStatusColors maps keys to canonical statuses and lowercases values", () => {
		const statuses = ["To Do", "Review", "Done"];
		expect(validateStatusColors({ review: "#8B5CF6" }, statuses)).toEqual({ Review: "#8b5cf6" });
		expect(validateStatusColors(undefined, statuses)).toEqual({});
		expectWorkflowError(() => validateStatusColors({ Nope: "#000000" }, statuses), 400);
		expectWorkflowError(() => validateStatusColors({ Review: "red" }, statuses), 400);
	});
});

describe("workflow status changes", () => {
	let fixtures: Fixtures;

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-workflow-core");
		core = await setupProject(TEST_DIR);
		fixtures = await seedTasks();
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("countStatusUsage counts every folder by normalized status", async () => {
		expect(await countStatusUsage(core)).toEqual({ "To Do": 1, "In Progress": 1, Review: 4, Done: 1 });
	});

	it("renameStatus rewrites tasks in every folder and updates the config", async () => {
		const before = await Promise.all(fixtures.review.map((path) => Bun.file(path).text()));
		const draftBefore = await Bun.file(fixtures.draft).text();

		const result = await renameStatus(core, "Review", "QA");

		expect(result.changedTasks).toBe(4);
		for (const path of fixtures.review) {
			expect(existsSync(path)).toBe(true);
			expect(await readStatus(path)).toBe("QA");
		}
		const after = await Promise.all(fixtures.review.map((path) => Bun.file(path).text()));
		expect(after).toEqual(before.map((text) => text.replace(STATUS_LINE, "status: QA")));
		expect(await readStatus(fixtures.todo)).toBe("To Do");
		expect(await Bun.file(fixtures.draft).text()).toBe(draftBefore);

		const reloaded = await new Core(TEST_DIR).fs.loadConfig();
		expect(reloaded?.statuses).toEqual(["To Do", "In Progress", "QA", "Done"]);
		expect(reloaded?.defaultStatus).toBe("QA");
		expect(reloaded?.statusColors).toEqual({ QA: "#8b5cf6" });
		expect(result.config.statuses).toEqual(["To Do", "In Progress", "QA", "Done"]);
	});

	it("renameStatus rejects an unknown source and an existing target", async () => {
		await expectRejects(renameStatus(core, "Nope", "QA"), 404, "Unknown status: Nope");
		await expectRejects(renameStatus(core, "Review", "done"), 409, "Status already exists: Done");
	});

	it("renameStatus allows a case-only rename", async () => {
		const result = await renameStatus(core, "In Progress", "In progress");
		expect(result.changedTasks).toBe(1);
		expect(result.config.statuses).toEqual(["To Do", "In progress", "Review", "Done"]);
		expect(await readStatus(fixtures.inProgress)).toBe("In progress");
	});

	it("renameStatus to the same name changes nothing", async () => {
		const configBefore = await Bun.file(core.fs.configFilePath).text();
		const result = await renameStatus(core, "Review", "Review");
		expect(result.changedTasks).toBe(0);
		expect(await Bun.file(core.fs.configFilePath).text()).toBe(configBefore);
	});

	it("renameStatus from a non-canonical spelling to the configured spelling changes nothing", async () => {
		const configBefore = await Bun.file(core.fs.configFilePath).text();
		const result = await renameStatus(core, "review", "Review");
		expect(result.changedTasks).toBe(0);
		expect(await Bun.file(core.fs.configFilePath).text()).toBe(configBefore);
		expect(await readStatus(fixtures.review[1] as string)).toBe("review");
	});

	it("renameStatus to a new spelling of the same status rewrites the tasks", async () => {
		const result = await renameStatus(core, "Review", "review");
		// The file already spelled "review" needs no write.
		expect(result.changedTasks).toBe(3);
		expect(result.config.statuses).toEqual(["To Do", "In Progress", "review", "Done"]);
		expect(await readStatus(fixtures.review[0] as string)).toBe("review");
	});

	it("refreshes an existing content store with the rewritten active tasks", async () => {
		const store = await core.getContentStore();
		try {
			await renameStatus(core, "Review", "QA");
			const statuses = store.getTasks().map((task) => task.status);
			expect(statuses).not.toContain("Review");
			expect(statuses).not.toContain("review");
			expect(statuses.filter((status) => status === "QA")).toHaveLength(2);
		} finally {
			core.disposeContentStore();
		}
	});

	it("renameStatus does not run onStatusChange", async () => {
		const marker = join(TEST_DIR, "called");
		const config = await core.fs.loadConfig();
		if (!config) throw new Error("config missing");
		await core.fs.saveConfig({ ...config, onStatusChange: `echo "x" > "${marker}"` });

		// Positive control: a normal status change runs the callback.
		await core.updateTaskFromInput(parseTask(await Bun.file(fixtures.todo).text()).id, { status: "In Progress" });
		expect(existsSync(marker)).toBe(true);
		await Bun.file(marker).delete();

		await renameStatus(core, "Review", "QA");
		expect(existsSync(marker)).toBe(false);
	});

	it("removeStatus moves tasks and drops the status, default, and color", async () => {
		const result = await removeStatus(core, "Review", "In Progress");
		expect(result.changedTasks).toBe(4);
		for (const path of fixtures.review) {
			expect(await readStatus(path)).toBe("In Progress");
		}
		const reloaded = await new Core(TEST_DIR).fs.loadConfig();
		expect(reloaded?.statuses).toEqual(["To Do", "In Progress", "Done"]);
		expect(reloaded?.defaultStatus).toBe("To Do");
		expect(reloaded?.statusColors).toBeUndefined();
	});

	it("removeStatus moves tasks to the canonical spelling of the target", async () => {
		await removeStatus(core, "Review", "in progress");
		expect(await readStatus(fixtures.review[0] as string)).toBe("In Progress");
	});

	it("removeStatus validates the target and the minimum status count", async () => {
		await expectRejects(removeStatus(core, "Nope", undefined), 404, "Unknown status: Nope");
		await expectRejects(
			removeStatus(core, "Review", undefined),
			400,
			"Choose a status for the 4 tasks that use Review",
		);
		await expectRejects(removeStatus(core, "Review", "Review"), 400, "Unknown target status: Review");
		await expectRejects(removeStatus(core, "Review", "Nope"), 400, "Unknown target status: Nope");

		const config = await core.fs.loadConfig();
		if (!config) throw new Error("config missing");
		await core.fs.saveConfig({ ...config, statuses: ["Review", "Done"] });
		await expectRejects(removeStatus(core, "Done", "Review"), 400, "A workflow needs at least 2 statuses");
	});

	it("removeStatus removes an unused status without a target", async () => {
		const config = await core.fs.loadConfig();
		if (!config) throw new Error("config missing");
		await core.fs.saveConfig({ ...config, statuses: ["Unused", ...(config.statuses ?? [])] });

		const result = await removeStatus(core, "Unused", undefined);
		expect(result.changedTasks).toBe(0);
		expect(result.config.statuses).toEqual(["To Do", "In Progress", "Review", "Done"]);
	});

	it("rolls back task files and keeps the config when the config save fails", async () => {
		const paths = [...fixtures.review, fixtures.todo, fixtures.completedDone];
		const textsBefore = await Promise.all(paths.map((path) => Bun.file(path).text()));
		const configBefore = await Bun.file(core.fs.configFilePath).text();
		const originalSave = core.fs.saveConfig;
		core.fs.saveConfig = async () => {
			throw new Error("disk full");
		};
		try {
			await expect(renameStatus(core, "Review", "QA")).rejects.toThrow("disk full");
		} finally {
			core.fs.saveConfig = originalSave;
		}

		const textsAfter = await Promise.all(paths.map((path) => Bun.file(path).text()));
		expect(textsAfter).toEqual(textsBefore);
		expect(await Bun.file(core.fs.configFilePath).text()).toBe(configBefore);
		expect((await core.fs.loadConfig())?.statuses).toEqual(["To Do", "In Progress", "Review", "Done"]);
	});

	it("rolls back earlier task files when a task write fails partway", async () => {
		const textsBefore = await Promise.all(fixtures.review.map((path) => Bun.file(path).text()));
		const configBefore = await Bun.file(core.fs.configFilePath).text();
		const originalSaveTask = core.fs.saveTask;
		let calls = 0;
		core.fs.saveTask = async (task) => {
			calls += 1;
			if (calls === 3) throw new Error("write failed");
			return await originalSaveTask.call(core.fs, task);
		};
		try {
			await expect(renameStatus(core, "Review", "QA")).rejects.toThrow("write failed");
		} finally {
			core.fs.saveTask = originalSaveTask;
		}

		expect(calls).toBe(3);
		const textsAfter = await Promise.all(fixtures.review.map((path) => Bun.file(path).text()));
		expect(textsAfter).toEqual(textsBefore);
		expect(await Bun.file(core.fs.configFilePath).text()).toBe(configBefore);
	});

	it("names the files it could not restore in the rethrown error", async () => {
		const originalSaveTask = core.fs.saveTask;
		const originalLock = core.fs.withTaskLock;
		let calls = 0;
		let failed = false;
		core.fs.saveTask = async (task) => {
			calls += 1;
			if (calls === 2) {
				failed = true;
				throw new Error("write failed");
			}
			return await originalSaveTask.call(core.fs, task);
		};
		core.fs.withTaskLock = (async (task, fn) => {
			if (failed) throw new Error("lock busy");
			return await originalLock.call(core.fs, task, fn);
		}) as typeof originalLock;
		let message = "";
		try {
			await renameStatus(core, "Review", "QA");
		} catch (error) {
			message = (error as Error).message;
		} finally {
			core.fs.saveTask = originalSaveTask;
			core.fs.withTaskLock = originalLock;
		}

		const rewrittenPath = (
			await Promise.all(fixtures.review.map(async (path) => ((await readStatus(path)) === "QA" ? path : null)))
		).find((path) => path !== null);
		expect(rewrittenPath).toBeDefined();
		expect(message).toBe(`write failed; could not restore: ${rewrittenPath}`);
	});

	it("serializes concurrent renames so every task status stays in the config", async () => {
		const results = await Promise.allSettled([
			renameStatus(core, "Review", "QA"),
			renameStatus(core, "Review", "Check"),
		]);

		const fulfilled = results.filter((result) => result.status === "fulfilled");
		const rejected = results.filter((result) => result.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(WorkflowError);

		const statuses = (await new Core(TEST_DIR).fs.loadConfig())?.statuses ?? [];
		for (const path of [...fixtures.review, fixtures.todo, fixtures.inProgress, fixtures.completedDone]) {
			expect(statuses).toContain(await readStatus(path));
		}
	});

	it("rolls back and returns 409 when the config changes on disk during the change", async () => {
		const textsBefore = await Promise.all(fixtures.review.map((path) => Bun.file(path).text()));
		const configPath = core.fs.configFilePath;
		const originalSaveTask = core.fs.saveTask;
		let edited = "";
		core.fs.saveTask = async (task) => {
			if (!edited) {
				// Another process (for example the CLI) adds a status while the task files are rewritten.
				edited = (await Bun.file(configPath).text()).replace(
					/^statuses:.*$/m,
					'statuses: ["To Do", "In Progress", "Review", "Blocked", "Done"]',
				);
				await Bun.write(configPath, edited);
			}
			return await originalSaveTask.call(core.fs, task);
		};
		try {
			await expectRejects(
				renameStatus(core, "Review", "QA"),
				409,
				"The workflow changed while saving. Reload and try again.",
			);
		} finally {
			core.fs.saveTask = originalSaveTask;
		}

		const textsAfter = await Promise.all(fixtures.review.map((path) => Bun.file(path).text()));
		expect(textsAfter).toEqual(textsBefore);
		expect(await Bun.file(configPath).text()).toBe(edited);
	});

	it("removeStatus returns 409 when a task starts using the status during the change", async () => {
		const config = await core.fs.loadConfig();
		if (!config) throw new Error("config missing");
		await core.fs.saveConfig({ ...config, statuses: ["Unused", ...(config.statuses ?? [])] });
		const configBefore = await Bun.file(core.fs.configFilePath).text();
		const originalListTasks = core.fs.listTasks;
		let calls = 0;
		core.fs.listTasks = async (filter) => {
			const tasks = await originalListTasks.call(core.fs, filter);
			calls += 1;
			// Right after the usage check, another writer moves a task into the status being removed.
			if (calls === 1) await setStatusLine(fixtures.todo, "Unused");
			return tasks;
		};
		try {
			await expectRejects(
				removeStatus(core, "Unused", undefined),
				409,
				"Tasks started using Unused while saving. Reload and try again.",
			);
		} finally {
			core.fs.listTasks = originalListTasks;
		}
		expect(await Bun.file(core.fs.configFilePath).text()).toBe(configBefore);
	});
});

describe("workflow auto-commit", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-workflow-commit");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init`.cwd(TEST_DIR).quiet();
		await $`git config user.email test@example.com`.cwd(TEST_DIR).quiet();
		await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
		core = await setupProject(TEST_DIR, { autoCommit: true });
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("commits the rewritten task files and the config in one commit", async () => {
		const fixtures = await seedTasks();
		await $`git add -A`.cwd(TEST_DIR).quiet();
		await $`git commit -m baseline`.cwd(TEST_DIR).quiet();
		const countBefore = Number((await $`git rev-list --count HEAD`.cwd(TEST_DIR).text()).trim());

		await renameStatus(core, "Review", "QA");

		const countAfter = Number((await $`git rev-list --count HEAD`.cwd(TEST_DIR).text()).trim());
		expect(countAfter).toBe(countBefore + 1);
		const message = (await $`git log -1 --pretty=%s`.cwd(TEST_DIR).text()).trim();
		expect(message).toBe('Rename status "Review" to "QA"');
		const committed = (await $`git show --no-renames --name-only --pretty=format:`.cwd(TEST_DIR).text())
			.trim()
			.split("\n");
		expect(committed).toContain("backlog/config.yml");
		for (const folder of ["backlog/tasks", "backlog/completed", "backlog/archive/tasks"]) {
			expect(committed.some((path) => dirname(path) === folder)).toBe(true);
		}
		expect(committed).toHaveLength(fixtures.review.length + 1);
	});

	it("names the number of moved files in the remove commit", async () => {
		await seedTasks();
		await $`git add -A`.cwd(TEST_DIR).quiet();
		await $`git commit -m baseline`.cwd(TEST_DIR).quiet();

		await removeStatus(core, "Review", "In Progress");

		const message = (await $`git log -1 --pretty=%s`.cwd(TEST_DIR).text()).trim();
		expect(message).toBe('Remove status "Review" (moved 4 tasks to "In Progress")');
	});

	it("unstages its paths when the commit fails", async () => {
		await seedTasks();
		await $`git add -A`.cwd(TEST_DIR).quiet();
		await $`git commit -m baseline`.cwd(TEST_DIR).quiet();
		const originalCommit = core.git.commitFiles;
		core.git.commitFiles = async () => {
			throw new Error("commit failed");
		};
		try {
			await expect(renameStatus(core, "Review", "QA")).rejects.toThrow("commit failed");
		} finally {
			core.git.commitFiles = originalCommit;
		}

		expect((await $`git diff --cached --name-only`.cwd(TEST_DIR).text()).trim()).toBe("");
	});
});
