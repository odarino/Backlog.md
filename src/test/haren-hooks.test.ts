import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { runHarenHook } from "../haren/hooks.ts";
import { loadState } from "../haren/sync.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

let dir: string;
let core: Core;
let env: { root: string; dataDir: string };

const plan = (tasks: { key: string; title: string; description: string; dependencies: string[] }[]) => ({
	hook: "after-plan",
	module: "checkout",
	tasksFile: "/x/tasks.md",
	tasks: tasks.map((t, i) => ({ ...t, number: i + 1 })),
});

beforeEach(async () => {
	dir = createUniqueTestDir("haren-hooks");
	await mkdir(dir, { recursive: true });
	core = new Core(dir);
	await initializeFilesystemTestProject(core, "Shop");
	env = { root: dir, dataDir: join(dir, ".data") };
});
afterEach(async () => {
	await safeCleanup(dir);
});

describe("after-plan", () => {
	it("creates labeled tasks with mapped dependencies, then updates and archives", async () => {
		const r = await runHarenHook(
			"after-plan",
			plan([
				{ key: "task-1-api", title: "API", description: "endpoints", dependencies: [] },
				{ key: "task-2-ui", title: "UI", description: "screen", dependencies: ["task-1-api"] },
			]),
			env,
		);
		expect(r.messages.join("\n")).toContain("Synced 2 tasks for checkout");
		const state = await loadState(env.dataDir);
		const apiId = state.tasks["checkout/task-1-api"]?.backlogId as string;
		const uiId = state.tasks["checkout/task-2-ui"]?.backlogId as string;
		const tasks = await core.filesystem.listTasks();
		const ui = tasks.find((t) => t.id === uiId);
		expect(ui?.labels).toContain("haren:checkout/task-2-ui");
		expect(ui?.dependencies).toEqual([apiId]);
		expect(ui?.status).toBe("To Do");

		await runHarenHook(
			"after-plan",
			plan([{ key: "task-1-api", title: "API v2", description: "endpoints", dependencies: [] }]),
			env,
		);
		const after = await core.filesystem.listTasks();
		expect(after.find((t) => t.id === apiId)?.title).toBe("API v2");
		expect(after.find((t) => t.id === uiId)).toBeUndefined();
		expect((await loadState(env.dataDir)).tasks["checkout/task-2-ui"]).toBeUndefined();
	});
});

describe("after-plan robustness", () => {
	const twoTaskPlan = plan([
		{ key: "task-1-api", title: "API", description: "", dependencies: [] },
		{ key: "task-2-ui", title: "UI", description: "", dependencies: ["task-1-api"] },
	]);
	it("recreates a task deleted from the board and links dependents to it", async () => {
		await runHarenHook(
			"after-plan",
			plan([{ key: "task-1-api", title: "API", description: "", dependencies: [] }]),
			env,
		);
		const oldId = (await loadState(env.dataDir)).tasks["checkout/task-1-api"]?.backlogId as string;
		await rm(join(dir, "backlog", "tasks", "task-1 - API.md"));
		const r = await runHarenHook("after-plan", twoTaskPlan, env);
		expect(r.messages.join("\n")).toContain(`Recreated checkout/task-1-api: ${oldId} was missing on the board`);
		const state = await loadState(env.dataDir);
		const apiId = state.tasks["checkout/task-1-api"]?.backlogId as string;
		const uiId = state.tasks["checkout/task-2-ui"]?.backlogId as string;
		const tasks = await core.filesystem.listTasks();
		expect(tasks.find((t) => t.id === uiId)?.dependencies).toEqual([apiId]);
	});
	it("does not abort when a mapped task was archived on the board", async () => {
		await runHarenHook(
			"after-plan",
			plan([{ key: "task-1-api", title: "API", description: "", dependencies: [] }]),
			env,
		);
		const oldId = (await loadState(env.dataDir)).tasks["checkout/task-1-api"]?.backlogId as string;
		await core.archiveTask(oldId, false);
		const r = await runHarenHook("after-plan", twoTaskPlan, env);
		expect(r.messages.join("\n")).toContain(`Recreated checkout/task-1-api: ${oldId} was missing on the board`);
		const state = await loadState(env.dataDir);
		expect(state.tasks["checkout/task-1-api"]).toBeDefined();
		expect(state.tasks["checkout/task-2-ui"]).toBeDefined();
	});
	it("drops a removed task that is already gone from the board", async () => {
		await runHarenHook(
			"after-plan",
			plan([{ key: "task-1-api", title: "API", description: "", dependencies: [] }]),
			env,
		);
		const id = (await loadState(env.dataDir)).tasks["checkout/task-1-api"]?.backlogId as string;
		await core.archiveTask(id, false);
		const r = await runHarenHook("after-plan", plan([]), env);
		expect(r.messages.join("\n")).toContain(`${id} already missing; dropped checkout/task-1-api`);
	});
	it("links a forward reference on the first sync", async () => {
		await runHarenHook(
			"after-plan",
			plan([
				{ key: "task-2-ui", title: "UI", description: "", dependencies: ["task-1-api"] },
				{ key: "task-1-api", title: "API", description: "", dependencies: [] },
			]),
			env,
		);
		const state = await loadState(env.dataDir);
		const apiId = state.tasks["checkout/task-1-api"]?.backlogId as string;
		const uiId = state.tasks["checkout/task-2-ui"]?.backlogId as string;
		expect((await core.filesystem.listTasks()).find((t) => t.id === uiId)?.dependencies).toEqual([apiId]);
	});
});

describe("project resolution", () => {
	it("does not walk up to a parent project", async () => {
		const child = join(dir, "child");
		await mkdir(child, { recursive: true });
		const r = await runHarenHook(
			"session-start",
			{ hook: "session-start" },
			{ root: child, dataDir: join(dir, ".d3") },
		);
		expect(r.messages[0]).toContain("No Backlog.md project found");
	});
	it("reports a missing root", async () => {
		const r = await runHarenHook("session-start", { hook: "session-start" }, { dataDir: join(dir, ".d4") });
		expect(r.messages[0]).toContain("No Backlog.md project found");
	});
});

describe("on-task-status and session-start", () => {
	it("pushes haren status to the board and pulls board changes back", async () => {
		await runHarenHook(
			"after-plan",
			plan([{ key: "task-1-api", title: "API", description: "", dependencies: [] }]),
			env,
		);
		const id = (await loadState(env.dataDir)).tasks["checkout/task-1-api"]?.backlogId as string;

		await runHarenHook(
			"on-task-status",
			{ hook: "on-task-status", module: "checkout", feature: "task-1-api", status: "in-progress" },
			env,
		);
		expect((await core.filesystem.listTasks()).find((t) => t.id === id)?.status).toBe("In Progress");
		expect((await runHarenHook("session-start", { hook: "session-start" }, env)).updates).toEqual([]);

		await core.updateTaskFromInput(id, { status: "Done" }, false);
		const r = await runHarenHook("session-start", { hook: "session-start" }, env);
		expect(r.updates).toEqual([{ module: "checkout", feature: "task-1-api", status: "passing" }]);
		expect((await runHarenHook("session-start", { hook: "session-start" }, env)).updates).toEqual([]);
	});
	it("rebuilds state from labels when the state file is lost", async () => {
		await runHarenHook(
			"after-plan",
			plan([{ key: "task-1-api", title: "API", description: "", dependencies: [] }]),
			env,
		);
		const id = (await loadState(env.dataDir)).tasks["checkout/task-1-api"]?.backlogId as string;
		const fresh = { root: dir, dataDir: join(dir, ".data2") };
		await runHarenHook(
			"on-task-status",
			{ hook: "on-task-status", module: "checkout", feature: "task-1-api", status: "passing" },
			fresh,
		);
		expect((await core.filesystem.listTasks()).find((t) => t.id === id)?.status).toBe("Done");
	});
	it("reports a missing project and an unknown key without throwing", async () => {
		// Outside the repo: findBacklogRoot walks up and would find this repo's backlog/ otherwise.
		const empty = await mkdtemp(join(tmpdir(), "haren-empty-"));
		const r = await runHarenHook(
			"session-start",
			{ hook: "session-start" },
			{ root: empty, dataDir: join(empty, ".d") },
		);
		expect(r.messages[0]).toContain("No Backlog.md project found");
		await safeCleanup(empty);
		const u = await runHarenHook(
			"on-task-status",
			{ hook: "on-task-status", module: "m", feature: "f", status: "passing" },
			env,
		);
		expect(u.messages[0]).toContain("No board task for m/f");
	});
	it("reports a missing data dir", async () => {
		const r = await runHarenHook("session-start", { hook: "session-start" }, { root: dir });
		expect(r.messages[0]).toContain("HAREN_PLUGIN_DATA is not set");
	});
	it("rejects an unknown hook", async () => {
		await expect(runHarenHook("on-deploy", {}, env)).rejects.toThrow("Unknown haren hook: on-deploy");
	});
});
