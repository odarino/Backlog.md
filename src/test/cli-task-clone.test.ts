import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;

describe("CLI task clone", () => {
	const cliPath = getTestCliPath();

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-task-clone");
		await mkdir(TEST_DIR, { recursive: true });
		const core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "Clone CLI Project");
		await $`bun ${cliPath} task create "Source" --desc "Body"`.cwd(TEST_DIR).quiet();
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("clones a task and prints the new ID and file", async () => {
		const result = await $`bun ${cliPath} task clone TASK-1`.cwd(TEST_DIR).quiet();
		const out = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		expect(out).toContain("Created task TASK-2");
		expect(out).toContain("File: ");
		const core = new Core(TEST_DIR);
		expect((await core.getTask("TASK-2"))?.title).toStartWith("Copy of");
	});

	it("sets the title with --title", async () => {
		const result = await $`bun ${cliPath} task clone TASK-1 --title "Custom"`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		const core = new Core(TEST_DIR);
		expect((await core.getTask("TASK-2"))?.title).toBe("Custom");
	});

	it("prints plain details with --plain", async () => {
		const result = await $`bun ${cliPath} task clone TASK-1 --plain`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Task TASK-2 - Copy of Source");
	});

	it("fails for an unknown ID", async () => {
		const result = await $`bun ${cliPath} task clone TASK-99`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Task not found: TASK-99");
	});

	it("fails for an empty title", async () => {
		const result = await $`bun ${cliPath} task clone TASK-1 --title ""`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("error: missing required argument 'title'");
	});

	it("resolves a bare ID to the task even when a draft shares the number", async () => {
		await $`bun ${cliPath} task create "Drafty" --draft`.cwd(TEST_DIR).quiet();
		const result = await $`bun ${cliPath} task clone 1`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Created task TASK-2");
	});

	it("clones a draft as a draft", async () => {
		await $`bun ${cliPath} task create "Drafty" --draft`.cwd(TEST_DIR).quiet();
		const result = await $`bun ${cliPath} task clone DRAFT-1`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Created draft DRAFT-2");
	});
});
