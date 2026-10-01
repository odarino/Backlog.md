import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { BacklogServer } from "../server/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let testDir: string;
let server: BacklogServer | null = null;
let serverPort = 0;

const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${serverPort}${path}`, init);
const getConfig = async () => (await (await request("/api/config")).json()) as Record<string, unknown>;
const putConfig = async (patch: Record<string, unknown>) =>
	request("/api/config", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...(await getConfig()), ...patch }),
	});
const commitCount = async () => Number((await $`git rev-list --count HEAD`.cwd(testDir).text()).trim());
const gitStatus = async () => (await $`git status --porcelain`.cwd(testDir).text()).trim();
const serverGit = () => (server as unknown as { core: Core }).core.git;

beforeEach(async () => {
	testDir = createUniqueTestDir("server-workflow-git");
	await mkdir(testDir, { recursive: true });
	await $`git init -q`.cwd(testDir).quiet();
	await $`git config user.email test@example.com`.cwd(testDir).quiet();
	await $`git config user.name "Test User"`.cwd(testDir).quiet();
	const core = new Core(testDir);
	await core.filesystem.ensureBacklogStructure();
	await core.filesystem.saveConfig({
		projectName: "Workflow",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		checkActiveBranches: false,
		autoCommit: true,
	});
	await core.createTaskFromInput({ title: "One", status: "In Progress" }, false);
	await $`git add -A`.cwd(testDir).quiet();
	await $`git commit -q -m baseline`.cwd(testDir).quiet();

	server = new BacklogServer(testDir);
	await server.start(0, false);
	serverPort = server.getPort() ?? 0;
	await retry(async () => {
		if (!(await request("/api/statuses")).ok) throw new Error("Server is not ready");
	});
});

afterEach(async () => {
	await server?.stop();
	server = null;
	await safeCleanup(testDir);
});

describe("PUT /api/config with auto_commit", () => {
	it("commits config.yml once and makes no empty commit", async () => {
		const before = await commitCount();
		const response = await putConfig({ statuses: ["In Progress", "To Do", "Done"] });
		expect(response.status).toBe(200);
		expect(((await response.json()) as { statuses: string[] }).statuses).toEqual(["In Progress", "To Do", "Done"]);
		expect(await commitCount()).toBe(before + 1);
		expect((await $`git log -1 --pretty=%s`.cwd(testDir).text()).trim()).toBe("Update config");
		const committed = (await $`git show --name-only --pretty=format:`.cwd(testDir).text()).trim().split("\n");
		expect(committed).toEqual(["backlog/config.yml"]);
		expect(await gitStatus()).toBe("");

		expect((await putConfig({ statuses: ["In Progress", "To Do", "Done"] })).status).toBe(200);
		expect(await commitCount()).toBe(before + 1);
		expect(await gitStatus()).toBe("");
	});

	it("reports a failed commit and unstages config.yml", async () => {
		serverGit().commitFiles = async () => {
			throw new Error("commit failed");
		};
		const response = await putConfig({ statuses: ["In Progress", "To Do", "Done"] });
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Config saved but the commit failed: commit failed" });
		expect((await $`git diff --cached --name-only`.cwd(testDir).text()).trim()).toBe("");
		expect((await getConfig()).statuses).toEqual(["In Progress", "To Do", "Done"]);
	});
});

describe("status changes with auto_commit", () => {
	it("reports a commit failure after the files changed", async () => {
		serverGit().commitFiles = async () => {
			throw new Error("commit failed");
		};
		const response = await request("/api/statuses/rename", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ from: "In Progress", to: "Doing" }),
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Workflow changed but the commit failed: commit failed" });
		expect((await getConfig()).statuses).toEqual(["To Do", "Doing", "Done"]);
	});
});
