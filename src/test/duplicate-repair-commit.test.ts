import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import {
	commitDuplicateTaskIdRepair,
	type DuplicateRepairChange,
	getDuplicateRepairCommitOptions,
} from "../core/duplicate-task-repair.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task } from "../types/index.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

let testDir: string;
let remoteDir: string;
let otherDir: string;
let core: Core;

function makeTask(id: string, title: string): Task {
	return {
		id,
		title,
		status: "To Do",
		assignee: [],
		createdDate: "2026-01-01",
		labels: [],
		dependencies: [],
		description: `${title} body`,
	};
}

async function configureIdentity(directory: string): Promise<void> {
	await $`git config user.email test@example.com`.cwd(directory).quiet();
	await $`git config user.name Test`.cwd(directory).quiet();
	await $`git config commit.gpgsign false`.cwd(directory).quiet();
}

/** Repairs the committed TASK-1/TASK-01 duplicate in the working tree and returns the renames. */
async function repairWorkingTree(): Promise<DuplicateRepairChange[]> {
	const plan = await core.previewDuplicateTaskIdRepair();
	const result = await core.repairDuplicateTaskIds(plan.fingerprint);
	expect(result.changes).toHaveLength(1);
	return result.changes;
}

/** Commits a change to the remote from a second clone, so the local branch falls behind. */
async function pushFromOtherClone(edit: (directory: string) => Promise<void>): Promise<void> {
	await $`git clone -q ${remoteDir} ${otherDir}`.quiet();
	await configureIdentity(otherDir);
	await edit(otherDir);
	await $`git add -A`.cwd(otherDir).quiet();
	await $`git commit -q -m remote-change`.cwd(otherDir).quiet();
	await $`git push -q origin main`.cwd(otherDir).quiet();
}

beforeEach(async () => {
	testDir = createUniqueTestDir("duplicate-repair-commit");
	remoteDir = createUniqueTestDir("duplicate-repair-commit-remote");
	otherDir = createUniqueTestDir("duplicate-repair-commit-other");
	await mkdir(testDir, { recursive: true });
	await mkdir(remoteDir, { recursive: true });
	await $`git init -q --bare -b main`.cwd(remoteDir).quiet();
	await $`git init -q -b main`.cwd(testDir).quiet();
	await configureIdentity(testDir);

	core = new Core(testDir);
	await core.filesystem.ensureBacklogStructure();
	await core.filesystem.saveConfig({
		projectName: "Duplicate repair commit",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		checkActiveBranches: false,
		autoCommit: false,
	});
	await Bun.write(join(core.filesystem.tasksDir, "task-1 - Alpha.md"), serializeTask(makeTask("TASK-1", "Alpha")));
	await Bun.write(join(core.filesystem.tasksDir, "task-01 - Beta.md"), serializeTask(makeTask("TASK-01", "Beta")));
	await $`git add -A`.cwd(testDir).quiet();
	await $`git commit -q -m initial`.cwd(testDir).quiet();
	await $`git remote add origin ${remoteDir}`.cwd(testDir).quiet();
	await $`git push -q -u origin main`.cwd(testDir).quiet();
});

afterEach(async () => {
	core.disposeSearchService();
	core.disposeContentStore();
	await safeCleanup(testDir);
	await safeCleanup(remoteDir);
	await safeCleanup(otherDir);
});

describe("duplicate repair commit and push", () => {
	it("commits only the renamed task files and keeps unrelated changes out", async () => {
		const changes = await repairWorkingTree();
		await Bun.write(join(testDir, "staged.txt"), "staged");
		await $`git add staged.txt`.cwd(testDir).quiet();
		await Bun.write(join(core.filesystem.tasksDir, "task-1 - Alpha.md"), "unstaged edit");

		const options = await getDuplicateRepairCommitOptions(core, changes);
		expect(options).toEqual({
			repository: true,
			upstream: "origin/main",
			message: "Repair duplicate task IDs\n\nTASK-01 -> TASK-2 (Beta)",
		});
		const result = await commitDuplicateTaskIdRepair(core, changes, options.message, false);

		expect(result).toEqual({ commit: expect.any(String), pushedTo: null, pulled: false });
		const committed = (await $`git show --no-renames --name-status --format= HEAD`.cwd(testDir).text())
			.trim()
			.split("\n");
		expect(committed.sort()).toEqual(["A\tbacklog/tasks/task-2 - Beta.md", "D\tbacklog/tasks/task-01 - Beta.md"]);
		expect(await $`git log -1 --format=%B`.cwd(testDir).text()).toContain("TASK-01 -> TASK-2 (Beta)");
		expect((await $`git diff --cached --name-only`.cwd(testDir).text()).trim()).toBe("staged.txt");
		expect((await $`git diff --name-only`.cwd(testDir).text()).trim()).toBe("backlog/tasks/task-1 - Alpha.md");
		// Committing again finds nothing new.
		expect((await commitDuplicateTaskIdRepair(core, changes, "again", false)).commit).toBeNull();
	});

	it("pushes the repair commit to the upstream", async () => {
		const changes = await repairWorkingTree();
		const result = await commitDuplicateTaskIdRepair(core, changes, "Repair", true);

		expect(result).toEqual({ commit: expect.any(String), pushedTo: "origin/main", pulled: false });
		expect((await $`git rev-parse main`.cwd(remoteDir).text()).trim()).toBe(result.commit ?? "");
	});

	it("commits locally and reports why when the branch has no upstream", async () => {
		await $`git branch --unset-upstream`.cwd(testDir).quiet();
		const changes = await repairWorkingTree();

		expect((await getDuplicateRepairCommitOptions(core, changes)).upstream).toBeNull();
		const result = await commitDuplicateTaskIdRepair(core, changes, "Repair", true);
		expect(result.commit).toEqual(expect.any(String));
		expect(result.pushedTo).toBeNull();
		expect(result.pushError).toBe("The current branch has no upstream.");
	});

	it("pulls once and pushes again when the remote is ahead", async () => {
		await $`git config pull.ff only`.cwd(testDir).quiet();
		await $`git config pull.rebase true`.cwd(testDir).quiet();
		await pushFromOtherClone(async (directory) => {
			await Bun.write(join(directory, "remote.txt"), "remote");
		});
		const changes = await repairWorkingTree();

		const result = await commitDuplicateTaskIdRepair(core, changes, "Repair", true);
		expect(result).toEqual({ commit: expect.any(String), pushedTo: "origin/main", pulled: true });
		expect(await Bun.file(join(testDir, "remote.txt")).text()).toBe("remote");
		const remoteLog = await $`git log --format=%s main`.cwd(remoteDir).text();
		expect(remoteLog).toContain("Repair");
		expect(remoteLog).toContain("remote-change");
	});

	it("aborts a conflicting pull and keeps the commit local", async () => {
		await pushFromOtherClone(async (directory) => {
			await Bun.write(join(directory, "backlog/tasks/task-01 - Beta.md"), "edited on the remote");
		});
		const changes = await repairWorkingTree();

		const result = await commitDuplicateTaskIdRepair(core, changes, "Repair", true);
		expect(result.commit).toEqual(expect.any(String));
		expect(result.pushedTo).toBeNull();
		expect(result.pushError).toContain("git pull");
		expect((await $`git rev-parse HEAD`.cwd(testDir).text()).trim()).toBe(result.commit ?? "");
		expect(await Bun.file(join(testDir, ".git/MERGE_HEAD")).exists()).toBe(false);
		expect((await $`git status --porcelain`.cwd(testDir).text()).trim()).toBe("");
	});

	it("does not pull when the remote declines the push for another reason", async () => {
		await Bun.write(join(remoteDir, "hooks/pre-receive"), "#!/bin/sh\necho protected branch >&2\nexit 1\n");
		await $`chmod +x ${join(remoteDir, "hooks/pre-receive")}`.quiet();
		const changes = await repairWorkingTree();
		const headBefore = (await $`git rev-parse HEAD`.cwd(testDir).text()).trim();

		const result = await commitDuplicateTaskIdRepair(core, changes, "Repair", true);
		expect(result.pulled).toBe(false);
		expect(result.pushError).toContain("protected branch");
		expect(result.pushError).not.toContain("git pull");
		expect((await $`git rev-parse HEAD~1`.cwd(testDir).text()).trim()).toBe(headBefore);
	});

	it("refuses paths outside the backlog directory", async () => {
		await expect(
			commitDuplicateTaskIdRepair(core, [{ sourcePath: "../outside.md", targetPath: "README.md" }], "Repair", false),
		).rejects.toThrow("outside the backlog directory");
	});
});
