import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();
let dir: string;

beforeEach(async () => {
	dir = createUniqueTestDir("haren-hook-cli");
	await mkdir(dir, { recursive: true });
	await initializeFilesystemTestProject(new Core(dir), "Shop");
});
afterEach(async () => {
	await safeCleanup(dir);
});

describe("backlog haren-hook", () => {
	it("is hidden from help", async () => {
		const out = await $`bun ${CLI_PATH} --help`.cwd(dir).quiet().nothrow();
		expect(out.stdout.toString()).not.toContain("haren-hook");
	});
	it("runs a hook from stdin and prints JSON only", async () => {
		const payload = JSON.stringify({
			hook: "after-plan",
			module: "m",
			tasksFile: "/x",
			tasks: [{ key: "task-1-a", number: 1, title: "A", description: "", dependencies: [] }],
		});
		const out = await $`echo ${payload} | bun ${CLI_PATH} haren-hook after-plan`
			.cwd(dir)
			.env({ ...process.env, HAREN_ROOT: dir, HAREN_PLUGIN_DATA: join(dir, ".data") })
			.quiet();
		const result = JSON.parse(out.stdout.toString());
		expect(result.messages[0]).toContain("Synced 1 tasks for m");
	});
	it("fails with exit 1 on an unknown hook", async () => {
		const out = await $`echo {} | bun ${CLI_PATH} haren-hook nope`
			.cwd(dir)
			.env({ ...process.env, HAREN_ROOT: dir, HAREN_PLUGIN_DATA: join(dir, ".data") })
			.quiet()
			.nothrow();
		expect(out.exitCode).toBe(1);
		expect(out.stderr.toString()).toContain("Unknown haren hook");
	});
});
