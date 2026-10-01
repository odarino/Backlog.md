import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Core } from "../core/backlog.ts";
import type { Task } from "../types/index.ts";
import { buildTaskCloneInput } from "../utils/task-clone.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

function fullTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "TASK-7",
		title: "X",
		status: "In Progress",
		assignee: ["@alex"],
		reporter: "@rep",
		createdDate: "2026-01-01",
		updatedDate: "2026-01-02",
		dueDate: "2026-02-01",
		labels: ["a", "b"],
		milestone: "m-1",
		dependencies: ["TASK-1"],
		references: ["ref1"],
		documentation: ["doc1"],
		modifiedFiles: ["src/a.ts"],
		description: "Desc",
		implementationPlan: "Plan",
		implementationNotes: "Notes",
		finalSummary: "Summary",
		acceptanceCriteriaItems: [
			{ index: 1, text: "AC one", checked: true },
			{ index: 2, text: "AC two", checked: false },
		],
		definitionOfDoneItems: [
			{ index: 1, text: "DoD one", checked: true },
			{ index: 2, text: "DoD two", checked: false },
		],
		parentTaskId: "TASK-3",
		priority: "high",
		type: "bug",
		project: "web",
		ordinal: 5,
		...overrides,
	};
}

describe("buildTaskCloneInput", () => {
	it("prefixes the title and lets an override win", () => {
		expect(buildTaskCloneInput(fullTask()).title).toBe("Copy of X");
		expect(buildTaskCloneInput(fullTask(), { title: "Other" }).title).toBe("Other");
	});

	it("leaves status undefined for a normal task and Draft for a draft in any case", () => {
		expect(buildTaskCloneInput(fullTask()).status).toBeUndefined();
		expect(buildTaskCloneInput(fullTask({ status: "Draft" })).status).toBe("Draft");
		expect(buildTaskCloneInput(fullTask({ status: "dRaFt" })).status).toBe("Draft");
	});

	it("copies the carried fields", () => {
		const task = fullTask();
		const input = buildTaskCloneInput(task);
		expect(input.description).toBe(task.description);
		expect(input.implementationPlan).toBe(task.implementationPlan);
		expect(input.labels).toEqual(task.labels);
		expect(input.priority).toBe(task.priority);
		expect(input.type).toBe(task.type);
		expect(input.project).toBe(task.project);
		expect(input.milestone).toBe(task.milestone);
		expect(input.assignee).toEqual(task.assignee);
		expect(input.dependencies).toEqual(task.dependencies);
		expect(input.parentTaskId).toBe(task.parentTaskId);
		expect(input.references).toEqual(task.references);
		expect(input.documentation).toEqual(task.documentation);
		expect(input.modifiedFiles).toEqual(task.modifiedFiles);
	});

	it("copies acceptance criteria unchecked", () => {
		expect(buildTaskCloneInput(fullTask()).acceptanceCriteria).toEqual([
			{ text: "AC one", checked: false },
			{ text: "AC two", checked: false },
		]);
	});

	it("copies Definition of Done texts and disables defaults", () => {
		const input = buildTaskCloneInput(fullTask());
		expect(input.definitionOfDoneAdd).toEqual(["DoD one", "DoD two"]);
		expect(input.disableDefinitionOfDoneDefaults).toBe(true);
	});

	it("disables defaults even when the source has no Definition of Done items", () => {
		const input = buildTaskCloneInput(fullTask({ definitionOfDoneItems: undefined }));
		expect(input.definitionOfDoneAdd).toEqual([]);
		expect(input.disableDefinitionOfDoneDefaults).toBe(true);
	});

	it("keeps undefined optional fields undefined", () => {
		const input = buildTaskCloneInput(
			fullTask({ references: undefined, documentation: undefined, modifiedFiles: undefined }),
		);
		expect(input.references).toBeUndefined();
		expect(input.documentation).toBeUndefined();
		expect(input.modifiedFiles).toBeUndefined();
	});

	it("omits fields that are not cloned", () => {
		const input = buildTaskCloneInput(fullTask());
		for (const key of [
			"implementationNotes",
			"finalSummary",
			"ordinal",
			"id",
			"createdDate",
			"updatedDate",
			"dueDate",
			"comments",
		]) {
			expect(Object.hasOwn(input, key)).toBe(false);
		}
	});

	it("returns new arrays", () => {
		const task = fullTask();
		const input = buildTaskCloneInput(task);
		input.labels?.push("z");
		input.assignee?.push("@z");
		input.dependencies?.push("TASK-9");
		input.references?.push("r");
		input.documentation?.push("d");
		input.modifiedFiles?.push("f");
		expect(task.labels).toEqual(["a", "b"]);
		expect(task.assignee).toEqual(["@alex"]);
		expect(task.dependencies).toEqual(["TASK-1"]);
		expect(task.references).toEqual(["ref1"]);
		expect(task.documentation).toEqual(["doc1"]);
		expect(task.modifiedFiles).toEqual(["src/a.ts"]);
	});
});

describe("Core.cloneTask", () => {
	let dir: string;
	let core: Core;

	beforeEach(async () => {
		dir = createUniqueTestDir("task-clone");
		core = new Core(dir);
		await core.fs.ensureBacklogStructure();
		await core.fs.saveConfig({
			projectName: "Clone",
			statuses: ["To Do", "In Progress", "Done"],
			defaultStatus: "To Do",
			labels: [],
			milestones: [],
			dateFormat: "YYYY-MM-DD",
			remoteOperations: false,
			autoCommit: false,
			definitionOfDone: ["Tests pass"],
		});
	});

	afterEach(async () => {
		await safeCleanup(dir);
	});

	it("clones a normal task with reset state", async () => {
		const { task: source } = await core.createTaskFromInput(
			{
				title: "Source",
				status: "In Progress",
				labels: ["one"],
				acceptanceCriteria: [
					{ text: "First", checked: true },
					{ text: "Second", checked: false },
				],
				implementationNotes: "x",
			},
			false,
		);
		const { task } = await core.cloneTask(source.id);
		expect(task.id).not.toBe(source.id);
		expect(task.title).toBe("Copy of Source");
		expect(task.status).toBe("To Do");
		expect(task.labels).toEqual(["one"]);
		expect(task.acceptanceCriteriaItems?.map((item) => [item.text, item.checked])).toEqual([
			["First", false],
			["Second", false],
		]);
		expect(task.definitionOfDoneItems?.map((item) => [item.text, item.checked])).toEqual(
			(source.definitionOfDoneItems ?? []).map((item) => [item.text, false]),
		);
		expect(task.definitionOfDoneItems?.filter((item) => item.text === "Tests pass")).toHaveLength(1);
		expect(task.implementationNotes).toBeUndefined();
	});

	it("clones a completed task", async () => {
		const { task: source } = await core.createTaskFromInput({ title: "Finished", status: "Done" }, false);
		await core.completeTask(source.id, false);
		const { task } = await core.cloneTask(source.id);
		expect(task.title).toBe("Copy of Finished");
		expect(task.id).not.toBe(source.id);
	});

	it("clones a draft into a draft", async () => {
		const { task: source } = await core.createTaskFromInput({ title: "Idea", status: "Draft" }, false);
		const { task } = await core.cloneTask(source.id);
		expect(task.id.startsWith("DRAFT-")).toBe(true);
		expect(task.id).not.toBe(source.id);
		expect(task.title).toBe("Copy of Idea");
	});

	it("uses the title override", async () => {
		const { task: source } = await core.createTaskFromInput({ title: "Source" }, false);
		const { task } = await core.cloneTask(source.id, { title: "Other" });
		expect(task.title).toBe("Other");
	});

	it("rejects an unknown id", async () => {
		await expect(core.cloneTask("TASK-999")).rejects.toThrow("Task not found: TASK-999");
	});

	it("rejects an archived task", async () => {
		const { task: source } = await core.createTaskFromInput({ title: "Gone", status: "To Do" }, false);
		await core.archiveTask(source.id, false);
		await expect(core.cloneTask(source.id)).rejects.toThrow(`Task not found: ${source.id}`);
	});
});
