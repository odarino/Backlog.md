import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Core } from "../core/backlog.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

describe("ID allocation never reuses archived task IDs", () => {
	let core: Core;
	let testDir: string;

	beforeEach(async () => {
		testDir = createUniqueTestDir("archived-id-reuse");
		core = new Core(testDir);
		await initializeFilesystemTestProject(core, "Archived ID Reuse");
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("gives a new task an ID that differs from the archived highest ID", async () => {
		const first = await core.createTaskFromInput({ title: "One" }, false);
		const second = await core.createTaskFromInput({ title: "Two" }, false);
		await core.archiveTask(second.task.id, false);

		const created = await core.createTaskFromInput({ title: "Three" }, false);
		expect(created.task.id).not.toBe(second.task.id);
		expect(created.task.id).not.toBe(first.task.id);
		expect(created.task.id).toBe("TASK-3");
	});

	it("does not reuse an archived subtask ID", async () => {
		const parent = await core.createTaskFromInput({ title: "Parent" }, false);
		const sub = await core.createTaskFromInput({ title: "Sub", parentTaskId: parent.task.id }, false);
		await core.archiveTask(sub.task.id, false);

		const next = await core.createTaskFromInput({ title: "Sub 2", parentTaskId: parent.task.id }, false);
		expect(next.task.id).not.toBe(sub.task.id);
	});

	it("does not reuse a completed task ID", async () => {
		await core.createTaskFromInput({ title: "One" }, false);
		const second = await core.createTaskFromInput({ title: "Two" }, false);
		await core.completeTask(second.task.id, false);

		const created = await core.createTaskFromInput({ title: "Three" }, false);
		expect(created.task.id).toBe("TASK-3");
	});
});
