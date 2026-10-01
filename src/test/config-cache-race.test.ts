import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { FileSystem } from "../file-system/operations.ts";
import type { BacklogConfig } from "../types/index.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

let testDir: string;
let fs: FileSystem;

const baseConfig: BacklogConfig = {
	projectName: "Race",
	statuses: ["To Do", "In Progress", "Done"],
	labels: [],
	milestones: [],
	dateFormat: "yyyy-mm-dd",
	remoteOperations: false,
	checkActiveBranches: false,
	autoCommit: false,
};

beforeEach(async () => {
	testDir = createUniqueTestDir("config-cache-race");
	fs = new FileSystem(testDir);
	await fs.ensureBacklogStructure();
	await fs.saveConfig(baseConfig);
});

afterEach(async () => {
	await safeCleanup(testDir);
});

describe("config cache", () => {
	it("keeps the saved config when an older read finishes after the save", async () => {
		const realFile = Bun.file;
		let release = () => {};
		const gate = new Promise<void>((done) => {
			release = done;
		});
		let parked = false;
		let readDone = false;
		const configPath = resolve(fs.configFilePath);
		// The first read of the config gets the old text, then waits until the save is done.
		(Bun as { file: typeof Bun.file }).file = ((path: string, options?: BlobPropertyBag) => {
			const file = realFile(path, options);
			if (parked || typeof path !== "string" || resolve(path) !== configPath) return file;
			parked = true;
			return Object.assign(Object.create(file), {
				exists: () => file.exists(),
				text: async () => {
					const text = await file.text();
					readDone = true;
					await gate;
					return text;
				},
			});
		}) as typeof Bun.file;
		const next: BacklogConfig = { ...baseConfig, statusColors: { Done: "#10b981" } };
		try {
			fs.invalidateConfigCache();
			const reader = fs.loadConfig();
			while (!readDone) await new Promise((done) => setTimeout(done, 1));
			await fs.saveConfig(next);
			release();
			const old = await reader;
			expect(old?.statusColors).toBeUndefined();
		} finally {
			release();
			(Bun as { file: typeof Bun.file }).file = realFile;
		}
		expect((await fs.loadConfig())?.statusColors).toEqual({ Done: "#10b981" });
		expect(fs.getCachedConfigContent(fs.configFilePath)).toBe(await Bun.file(fs.configFilePath).text());
	});
});
