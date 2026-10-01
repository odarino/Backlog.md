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
});
