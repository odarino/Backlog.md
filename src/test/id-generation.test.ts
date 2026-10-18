import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task } from "../types/index.ts";
import { generateNextId } from "../utils/prefix-config.ts";

const TEST_DIR = join(tmpdir(), "backlog-id-gen-test");

describe("Task ID Generation with Archives", () => {
	let core: Core;
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(TEST_DIR);
		core = new Core(testDir);
		await initializeTestProject(core, "Test Project", false);
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("should not reuse IDs from archived tasks", async () => {
		// Create tasks 1-5
		await core.createTaskFromInput({ title: "Task 1" }, false);
		await core.createTaskFromInput({ title: "Task 2" }, false);
		await core.createTaskFromInput({ title: "Task 3" }, false);
		await core.createTaskFromInput({ title: "Task 4" }, false);
		await core.createTaskFromInput({ title: "Task 5" }, false);

		// Archive all tasks
		await core.archiveTask("task-1", false);
		await core.archiveTask("task-2", false);
		await core.archiveTask("task-3", false);
		await core.archiveTask("task-4", false);
		await core.archiveTask("task-5", false);

		// Verify tasks directory has no active tasks
		const activeTasks = await core.fs.listTasks();
		expect(activeTasks.length).toBe(0);

		// Create new task - should be TASK-6 (archived IDs are never reused)
		const result = await core.createTaskFromInput({ title: "Task After Archive" }, false);
		expect(result.task.id).toBe("TASK-6");

		// Verify the task was created with correct ID
		const newTask = await core.getTask("task-6");
		expect(newTask).not.toBeNull();
		expect(newTask?.title).toBe("Task After Archive");
	});

	it("should consider completed and archived tasks for ID generation", async () => {
		// Create tasks 1-3
		await core.createTaskFromInput({ title: "Task 1", status: "Todo" }, false);
		await core.createTaskFromInput({ title: "Task 2", status: "Done" }, false);
		await core.createTaskFromInput({ title: "Task 3", status: "Todo" }, false);

		// Archive task-1 (its ID is not reused)
		await core.archiveTask("task-1", false);

		// Complete task-2 (moves to completed directory, ID cannot be reused)
		await core.completeTask("task-2", false);

		// Keep task-3 active
		const activeTasks = await core.fs.listTasks();
		expect(activeTasks.length).toBe(1);
		expect(activeTasks[0]?.id).toBe("TASK-3");

		// Create new task - should be TASK-4 (max of active 3 + completed 2 is 3, so next is 4)
		const result = await core.createTaskFromInput({ title: "Task 4" }, false);
		expect(result.task.id).toBe("TASK-4");

		// Verify archived task still exists
		const archivedTasks = await core.fs.listArchivedTasks();
		expect(archivedTasks.some((t) => t.id === "TASK-1")).toBe(true);

		// Verify completed task still exists
		const completedTasks = await core.fs.listCompletedTasks();
		expect(completedTasks.some((t) => t.id === "TASK-2")).toBe(true);
	});

	it("should handle subtasks correctly with archived parents", async () => {
		// Create parent task-1
		await core.createTaskFromInput({ title: "Parent Task" }, false);

		// Create subtasks
		const subtask1 = await core.createTaskFromInput({ title: "Subtask 1", parentTaskId: "task-1" }, false);
		const subtask2 = await core.createTaskFromInput({ title: "Subtask 2", parentTaskId: "task-1" }, false);

		expect(subtask1.task.id).toBe("TASK-1.1");
		expect(subtask2.task.id).toBe("TASK-1.2");

		// Archive parent and all subtasks
		await core.archiveTask("task-1", false);
		await core.archiveTask("task-1.1", false);
		await core.archiveTask("task-1.2", false);

		// Create new parent task - should be TASK-2 (archived parent ID is not reused)
		const newParent = await core.createTaskFromInput({ title: "New Parent" }, false);
		expect(newParent.task.id).toBe("TASK-2");

		// Create subtask of new parent (TASK-2) - should be TASK-2.1
		const newSubtask = await core.createTaskFromInput({ title: "New Subtask", parentTaskId: "task-2" }, false);
		expect(newSubtask.task.id).toBe("TASK-2.1");
	});

	it("should work with zero-padded IDs and not reuse archived IDs", async () => {
		// Update config to use zero-padded IDs
		const config = await core.fs.loadConfig();
		if (config) {
			config.zeroPaddedIds = 3;
			await core.fs.saveConfig(config);
		}

		// Create and archive tasks with padding
		await core.createTaskFromInput({ title: "Task 1" }, false);
		const task1 = await core.getTask("task-001");
		expect(task1?.id).toBe("TASK-001");

		await core.archiveTask("task-001", false);

		// Create new task - should not reuse archived ID (TASK-001)
		const result = await core.createTaskFromInput({ title: "Task 2" }, false);
		expect(result.task.id).toBe("TASK-002");
	});

	it("should detect existing subtasks with different casing (legacy data)", async () => {
		// Create parent task via Core (will be uppercase TASK-1)
		await core.createTaskFromInput({ title: "Parent Task" }, false);

		// Simulate legacy lowercase subtask by directly writing to filesystem
		// This represents a file created before the uppercase ID change
		const tasksDir = core.fs.tasksDir;
		const legacySubtask: Task = {
			id: "task-1.1", // Lowercase - legacy format
			title: "Legacy Subtask",
			status: "To Do",
			assignee: [],
			createdDate: "2025-01-01",
			labels: [],
			dependencies: [],
			parentTaskId: "task-1",
		};
		const content = serializeTask(legacySubtask);
		await Bun.write(join(tasksDir, "task-1.1 - Legacy Subtask.md"), content);

		// Create new subtask via Core - should detect the legacy subtask and get TASK-1.2
		// BUG: Currently returns TASK-1.1 due to case-sensitive startsWith() check
		const newSubtask = await core.createTaskFromInput({ title: "New Subtask", parentTaskId: "task-1" }, false);
		expect(newSubtask.task.id).toBe("TASK-1.2");
	});
});

import { initializeTestProject } from "./test-utils.ts";

describe("generateNextId random mode", () => {
	it("returns a 6-digit id with the prefix", () => {
		const id = generateNextId(["BACK-1"], "back", undefined, "random", () => 0.5);
		expect(id).toBe("BACK-550000");
	});

	it("retries when the id exists", () => {
		const values = [0, 0.5];
		const id = generateNextId(["BACK-100000"], "back", undefined, "random", () => values.shift() ?? 0.9);
		expect(id).toBe("BACK-550000");
	});

	it("treats lower-case existing ids as taken", () => {
		const values = [0, 0.5];
		const id = generateNextId(["back-100000"], "back", undefined, "random", () => values.shift() ?? 0.9);
		expect(id).toBe("BACK-550000");
	});

	it("throws after 50 collisions", () => {
		expect(() => generateNextId(["BACK-100000"], "back", undefined, "random", () => 0)).toThrow(/random task ID/);
	});

	it("ignores zero padding in random mode", () => {
		expect(generateNextId([], "back", 10, "random", () => 0)).toBe("BACK-100000");
	});

	it("keeps sequential mode unchanged", () => {
		expect(generateNextId(["BACK-7"], "back", undefined, "sequential")).toBe("BACK-8");
	});
});

describe("Core random task IDs", () => {
	let core: Core;
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(TEST_DIR);
		core = new Core(testDir);
		await initializeTestProject(core, "Test Project", false);
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("config missing");
		await core.filesystem.saveConfig({ ...config, taskIdMode: "random" });
		core.filesystem.invalidateConfigCache();
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("creates random task ids, dotted subtasks and sequential drafts", async () => {
		const { task } = await core.createTaskFromInput({ title: "Random" }, false);
		expect(task.id).toMatch(/^[A-Z]+-\d{6}$/);
		const sub = await core.createTaskFromInput({ title: "Sub", parentTaskId: task.id }, false);
		expect(sub.task.id).toBe(`${task.id}.1`);
		const draft = await core.createTaskFromInput({ title: "Draft", status: "Draft" }, false);
		expect(draft.task.id).toMatch(/^DRAFT-\d{1,3}$/);
	});
});
