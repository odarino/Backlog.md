import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FileSystem } from "../file-system/operations.ts";
import type { BacklogConfig } from "../types/index.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let filesystem: FileSystem;

const loadBase = async (): Promise<BacklogConfig> => {
	const config = await filesystem.loadConfig();
	if (!config) throw new Error("config missing");
	return config;
};

beforeEach(async () => {
	TEST_DIR = createUniqueTestDir("config-status-colors");
	filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Colors",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		autoCommit: false,
	});
});

afterEach(async () => {
	await safeCleanup(TEST_DIR);
});

describe("status_colors config key", () => {
	it("round-trips status_colors as a JSON-quoted flow map", async () => {
		const base = await loadBase();
		await filesystem.saveConfig({
			...base,
			statuses: ["To Do", "In Progress", "Done"],
			statusColors: { "In Progress": "#f59e0b", Done: "#10b981" },
		});
		const text = await Bun.file(filesystem.configFilePath).text();
		expect(text).toContain('status_colors: {"In Progress":"#f59e0b","Done":"#10b981"}');
		const reloaded = await new FileSystem(TEST_DIR).loadConfig();
		expect(reloaded?.statusColors).toEqual({ "In Progress": "#f59e0b", Done: "#10b981" });
	});

	it("omits status_colors when empty or missing", async () => {
		const base = await loadBase();
		await filesystem.saveConfig({ ...base, statusColors: {} });
		expect(await Bun.file(filesystem.configFilePath).text()).not.toContain("status_colors");
		expect((await new FileSystem(TEST_DIR).loadConfig())?.statusColors).toBeUndefined();
	});

	it("reads a block-style status_colors map written by hand", async () => {
		const path = filesystem.configFilePath;
		const text = await Bun.file(path).text();
		await Bun.write(path, `${text.trimEnd()}\nstatus_colors:\n  "To Do": "#64748b"\n  Done: "#10B981"\n`);
		expect((await new FileSystem(TEST_DIR).loadConfig())?.statusColors).toEqual({
			"To Do": "#64748b",
			Done: "#10B981",
		});
	});

	it("ignores a malformed status_colors value", async () => {
		const path = filesystem.configFilePath;
		await Bun.write(path, `${(await Bun.file(path).text()).trimEnd()}\nstatus_colors: [1, 2]\n`);
		expect((await new FileSystem(TEST_DIR).loadConfig())?.statusColors).toBeUndefined();
	});

	it("writes statuses and default_status with JSON quoting", async () => {
		const base = await loadBase();
		await filesystem.saveConfig({ ...base, statuses: ["To Do", "Wait: QA", "Done"], defaultStatus: "Wait: QA" });
		const text = await Bun.file(filesystem.configFilePath).text();
		expect(text).toContain('statuses: ["To Do", "Wait: QA", "Done"]');
		expect(text).toContain('default_status: "Wait: QA"');
		const reloaded = await new FileSystem(TEST_DIR).loadConfig();
		expect(reloaded?.statuses).toEqual(["To Do", "Wait: QA", "Done"]);
		expect(reloaded?.defaultStatus).toBe("Wait: QA");
	});
});
