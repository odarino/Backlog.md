import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DEFAULT_BOARD_MAP,
	diffBoard,
	keyFromLabels,
	labelFor,
	loadState,
	readConfig,
	rebuildState,
	type SyncState,
	saveState,
	splitKey,
} from "../haren/sync.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

const config = readConfig(undefined);
const base: SyncState = {
	version: 1,
	tasks: {
		"checkout/task-1-cart": {
			backlogId: "back-1",
			lastSynced: { status: "To Do", title: "Cart", description: "d" },
		},
	},
};

describe("haren sync helpers", () => {
	it("builds and reads labels and keys", () => {
		expect(labelFor("checkout/task-1-cart")).toBe("haren:checkout/task-1-cart");
		expect(keyFromLabels(["x", "haren:checkout/task-1-cart"])).toBe("checkout/task-1-cart");
		expect(keyFromLabels(["x"])).toBeUndefined();
		expect(splitKey("checkout/task-1-cart")).toEqual({ module: "checkout", feature: "task-1-cart" });
	});
	it("merges config over defaults", () => {
		expect(config.boardMap).toEqual(DEFAULT_BOARD_MAP);
		const c = readConfig(JSON.stringify({ boardMap: { Review: "evaluating" } }));
		expect(c.boardMap.Review).toBe("evaluating");
		expect(c.boardMap["To Do"]).toBe("pending");
		expect(readConfig("not json").statusMap.pending).toBe("To Do");
	});
});

describe("diffBoard", () => {
	it("returns a status update when the board moved a task", () => {
		const r = diffBoard(
			base,
			[{ id: "back-1", title: "Cart", status: "In Progress", description: "d", labels: [] }],
			config,
		);
		expect(r.updates).toEqual([{ module: "checkout", feature: "task-1-cart", status: "in-progress" }]);
		expect(r.state.tasks["checkout/task-1-cart"]?.lastSynced.status).toBe("In Progress");
		expect(base.tasks["checkout/task-1-cart"]?.lastSynced.status).toBe("To Do");
	});
	it("reports unmapped statuses, haren-owned edits, and missing tasks", () => {
		const r = diffBoard(
			base,
			[{ id: "back-1", title: "Renamed", status: "Review", description: "d", labels: [] }],
			config,
		);
		expect(r.updates).toEqual([]);
		expect(r.messages.join("\n")).toContain('Board status "Review"');
		expect(r.messages.join("\n")).toContain("haren owns these fields");
		expect(diffBoard(base, [], config).messages[0]).toContain("missing on the board");
	});
	it("is quiet when nothing changed", () => {
		const r = diffBoard(base, [{ id: "back-1", title: "Cart", status: "To Do", description: "d", labels: [] }], config);
		expect(r).toMatchObject({ updates: [], messages: [] });
	});
});

describe("state file", () => {
	let dir: string;
	beforeEach(async () => {
		dir = createUniqueTestDir("haren-sync");
		await mkdir(dir, { recursive: true });
	});
	afterEach(async () => {
		await safeCleanup(dir);
	});
	it("round-trips and tolerates a missing or corrupt file", async () => {
		expect(await loadState(dir)).toEqual({ version: 1, tasks: {} });
		await saveState(dir, base);
		expect(await loadState(dir)).toEqual(base);
		await writeFile(join(dir, "state.json"), "{");
		expect(await loadState(dir)).toEqual({ version: 1, tasks: {} });
	});
	it("rebuilds missing entries from labels", () => {
		const r = rebuildState({ version: 1, tasks: {} }, [
			{ id: "back-9", title: "T", status: "To Do", description: "x", labels: ["haren:m/task-2-t"] },
			{ id: "back-10", title: "U", status: "To Do", labels: [] },
		]);
		expect(r.tasks["m/task-2-t"]).toEqual({
			backlogId: "back-9",
			lastSynced: { status: "To Do", title: "T", description: "x" },
		});
		expect(Object.keys(r.tasks)).toEqual(["m/task-2-t"]);
	});
});
