import { describe, expect, it } from "bun:test";
import {
	buildWorkflowPlan,
	hasWorkflowChanges,
	insertNewRow,
	moveRow,
	rowsFromConfig,
	validateRows,
	type WorkflowRow,
} from "./workflow-plan";

const saved = ["To Do", "In Progress", "Review", "Done"];
const colors = { "In Progress": "#f59e0b", Done: "#10b981" };
const rows = () => rowsFromConfig(saved, colors);
const withName = (list: WorkflowRow[], index: number, name: string) =>
	list.map((row, i) => (i === index ? { ...row, name } : row));

describe("rowsFromConfig", () => {
	it("keeps order and colors", () => {
		const result = rows();
		expect(result.map((r) => r.name)).toEqual(saved);
		expect(result.map((r) => r.original)).toEqual(saved);
		expect(result.map((r) => r.color)).toEqual([null, "#f59e0b", null, "#10b981"]);
		expect(new Set(result.map((r) => r.id)).size).toBe(4);
	});
});

describe("insertNewRow", () => {
	it("inserts second-to-last", () => {
		const result = insertNewRow(rows(), "Blocked", "new-1");
		expect(result.map((r) => r.name)).toEqual(["To Do", "In Progress", "Review", "Blocked", "Done"]);
		expect(result[3]).toEqual({ id: "new-1", original: null, name: "Blocked", color: null });
	});
});

describe("moveRow", () => {
	it("swaps rows and clamps at the ends", () => {
		expect(moveRow(rows(), 2, -1).map((r) => r.name)).toEqual(["To Do", "Review", "In Progress", "Done"]);
		expect(moveRow(rows(), 1, 1).map((r) => r.name)).toEqual(["To Do", "Review", "In Progress", "Done"]);
		expect(moveRow(rows(), 0, -1).map((r) => r.name)).toEqual(saved);
		expect(moveRow(rows(), 3, 1).map((r) => r.name)).toEqual(saved);
	});
});

describe("validateRows", () => {
	it("returns null for a valid list", () => {
		expect(validateRows(rows())).toBeNull();
	});
	it("rejects bad names and short lists", () => {
		expect(validateRows(withName(rows(), 1, "  "))).not.toBeNull();
		expect(validateRows(withName(rows(), 1, " draft "))).not.toBeNull();
		expect(validateRows(withName(rows(), 1, "to do"))).not.toBeNull();
		expect(validateRows(withName(rows(), 1, 'Say "hi"'))).not.toBeNull();
		expect(validateRows(withName(rows(), 1, "x".repeat(41)))).not.toBeNull();
		expect(validateRows(rows().slice(0, 1))).not.toBeNull();
	});
});

describe("buildWorkflowPlan", () => {
	it("plans a rename plus a reorder", () => {
		const reordered = moveRow(withName(rows(), 2, "QA"), 2, -1);
		const plan = buildWorkflowPlan(saved, reordered, []);
		expect(plan).toEqual({
			preAdd: null,
			removals: [],
			renames: [{ from: "Review", to: "QA" }],
			statuses: ["To Do", "QA", "In Progress", "Done"],
			statusColors: { "In Progress": "#f59e0b", Done: "#10b981" },
		});
	});
	it("passes removals through and drops their colors", () => {
		const removals = [{ status: "In Progress", moveTo: null }];
		const remaining = rows().filter((r) => r.original !== "In Progress");
		const plan = buildWorkflowPlan(saved, remaining, removals);
		expect(plan).toEqual({
			preAdd: null,
			removals,
			renames: [],
			statuses: ["To Do", "Review", "Done"],
			statusColors: { Done: "#10b981" },
		});
	});
	it("makes colors follow renamed names", () => {
		const plan = buildWorkflowPlan(saved, withName(rows(), 1, "Doing"), []);
		expect(plan).toMatchObject({ statusColors: { Doing: "#f59e0b", Done: "#10b981" } });
	});
	it("rejects a rename to another saved status", () => {
		const plan = buildWorkflowPlan(saved, withName(rows(), 2, "Done"), []);
		expect(plan).toEqual({ error: expect.any(String) });
	});
	it("allows a case-only rename", () => {
		const plan = buildWorkflowPlan(saved, withName(rows(), 0, "TO DO"), []);
		expect(plan).toMatchObject({ renames: [{ from: "To Do", to: "TO DO" }] });
	});
	it("adds new statuses first when removals could shrink the list", () => {
		const abc = ["A", "B", "C"];
		const start = rowsFromConfig(abc, undefined);
		const edited = insertNewRow(
			start.filter((r) => r.original === "C"),
			"D",
			"new-1",
		);
		const removals = [
			{ status: "A", moveTo: null },
			{ status: "B", moveTo: null },
		];
		expect(buildWorkflowPlan(abc, edited, removals)).toEqual({
			preAdd: ["D"],
			removals,
			renames: [],
			statuses: ["D", "C"],
			statusColors: {},
		});
	});
	it("has no preAdd without removals or new rows", () => {
		expect(buildWorkflowPlan(saved, insertNewRow(rows(), "X", "new-1"), [])).toMatchObject({ preAdd: null });
		expect(buildWorkflowPlan(saved, rows(), [])).toMatchObject({ preAdd: null });
	});
	it("rejects a final list below 2 statuses", () => {
		const removals = [
			{ status: "To Do", moveTo: null },
			{ status: "In Progress", moveTo: null },
			{ status: "Review", moveTo: null },
		];
		const plan = buildWorkflowPlan(saved, rows().slice(3), removals);
		expect(plan).toEqual({ error: expect.any(String) });
	});
	it("rejects a swap of two saved names", () => {
		const swapped = withName(withName(rows(), 0, "In Progress"), 1, "To Do");
		expect(buildWorkflowPlan(saved, swapped, [])).toEqual({ error: expect.any(String) });
	});
	it("rejects a rename to the name of a new row", () => {
		const added = insertNewRow(rows(), "QA", "new-1");
		expect(buildWorkflowPlan(saved, withName(added, 0, "QA"), [])).toEqual({ error: expect.any(String) });
	});
	it("returns the validation error for invalid rows", () => {
		expect(buildWorkflowPlan(saved, withName(rows(), 0, ""), [])).toEqual({ error: expect.any(String) });
	});
});

describe("hasWorkflowChanges", () => {
	it("is false for untouched rows", () => {
		expect(hasWorkflowChanges(saved, colors, rows(), [])).toBe(false);
	});
	it("is true after a rename, move, add, removal, or color change", () => {
		expect(hasWorkflowChanges(saved, colors, withName(rows(), 0, "Todo"), [])).toBe(true);
		expect(hasWorkflowChanges(saved, colors, moveRow(rows(), 0, 1), [])).toBe(true);
		expect(hasWorkflowChanges(saved, colors, insertNewRow(rows(), "X", "new-1"), [])).toBe(true);
		expect(hasWorkflowChanges(saved, colors, rows(), [{ status: "Review", moveTo: null }])).toBe(true);
		const recolored = rows().map((r, i) => (i === 0 ? { ...r, color: "#ff0000" } : r));
		expect(hasWorkflowChanges(saved, colors, recolored, [])).toBe(true);
		const cleared = rows().map((r, i) => (i === 1 ? { ...r, color: null } : r));
		expect(hasWorkflowChanges(saved, colors, cleared, [])).toBe(true);
	});
});
