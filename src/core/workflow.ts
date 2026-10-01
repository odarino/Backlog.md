import { parseTask } from "../markdown/parser.ts";
import type { BacklogConfig, Task } from "../types/index.ts";
import { normalizeTaskIdentity } from "../utils/task-path.ts";
import type { Core } from "./backlog.ts";

/** A workflow edit the caller asked for that cannot be applied, with the HTTP status that describes why. */
export class WorkflowError extends Error {
	readonly status: 400 | 404 | 409;

	constructor(message: string, status: 400 | 404 | 409) {
		super(message);
		this.name = "WorkflowError";
		this.status = status;
	}
}

/** The task files and config are saved, but the auto-commit failed. Callers must treat the change as applied. */
export class WorkflowCommitError extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "WorkflowCommitError";
	}
}

export interface WorkflowResult {
	config: BacklogConfig;
	changedTasks: number;
}

const MAX_STATUS_LENGTH = 40;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** The identity two status spellings share: the rule `getCanonicalStatus` matches by. */
export function statusKey(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, "");
}

export function validateStatusName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0) throw new WorkflowError("A status name cannot be empty", 400);
	if (trimmed.length > MAX_STATUS_LENGTH) {
		throw new WorkflowError(`A status name can have at most ${MAX_STATUS_LENGTH} characters`, 400);
	}
	if (/["\\\t\r\n]/.test(trimmed)) {
		throw new WorkflowError("A status name cannot contain quotes, backslashes, tabs, or line breaks", 400);
	}
	if (statusKey(trimmed) === "draft") throw new WorkflowError("Draft is reserved for drafts", 400);
	return trimmed;
}

/**
 * Check a status list against the `current` one. Names already in `current` (exact spelling) are kept
 * as they are, so an older config that today's rules reject can still be saved; new names must pass
 * the name rules and must not repeat any other name in the list.
 */
export function validateStatusList(statuses: string[], current: string[] = []): string[] {
	const existing = new Set(current);
	const names = statuses.map((name) => (existing.has(name) ? name : validateStatusName(name)));
	if (names.length < 2) throw new WorkflowError("A workflow needs at least 2 statuses", 400);
	const spellings = new Set<string>();
	const keys = new Map<string, string>();
	for (const name of names) {
		const key = statusKey(name);
		const earlier = keys.get(key);
		// Two spellings the current config already has are an older duplicate; anything else is new.
		const olderDuplicate = earlier !== undefined && existing.has(earlier) && existing.has(name);
		if (spellings.has(name) || (earlier !== undefined && !olderDuplicate)) {
			throw new WorkflowError(`Duplicate status: ${name}`, 400);
		}
		spellings.add(name);
		if (earlier === undefined) keys.set(key, name);
	}
	return names;
}

/** Map color keys to the configured statuses. Keys for unknown statuses are dropped, so a stale entry never blocks a save. */
export function validateStatusColors(
	colors: Record<string, string> | undefined,
	statuses: string[],
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, color] of Object.entries(colors ?? {})) {
		const status = findStatus(statuses, name);
		if (!status) continue;
		if (status in result) throw new WorkflowError(`Duplicate color for ${status}`, 400);
		if (typeof color !== "string" || !COLOR_PATTERN.test(color)) {
			throw new WorkflowError(`Invalid color for ${status}: ${color}`, 400);
		}
		result[status] = color.toLowerCase();
	}
	return result;
}

export async function countStatusUsage(core: Core): Promise<Record<string, number>> {
	const { config } = await loadWorkflow(core);
	const counts: Record<string, number> = Object.fromEntries(config.statuses.map((status) => [status, 0]));
	for (const { task } of await listWorkflowTasks(core)) {
		const status = findStatus(config.statuses, task.status ?? "");
		if (status) counts[status] = (counts[status] ?? 0) + 1;
	}
	return counts;
}

export async function renameStatus(
	core: Core,
	from: string,
	to: string,
	autoCommit?: boolean,
): Promise<WorkflowResult> {
	return await withWorkflowLock(async () => {
		const { config } = await loadWorkflow(core);
		const source = findStatus(config.statuses, from);
		if (!source) throw new WorkflowError(`Unknown status: ${from}`, 404);
		const target = validateStatusName(to);
		const clash = findStatus(config.statuses, target);
		if (clash && clash !== source) throw new WorkflowError(`Status already exists: ${clash}`, 409);
		// The configured spelling is the identity: renaming to it (from any spelling) is a no-op.
		if (target === source) return { config, changedTasks: 0 };

		const sourceKey = statusKey(source);
		const renamed = (name: string) => (statusKey(name) === sourceKey ? target : name);
		return await applyStatusChange(core, {
			source,
			target,
			baseStatuses: config.statuses,
			buildConfig: (latest) => ({
				...latest,
				statuses: latest.statuses.map(renamed),
				...(latest.defaultStatus ? { defaultStatus: renamed(latest.defaultStatus) } : {}),
				...(latest.statusColors
					? {
							statusColors: Object.fromEntries(
								Object.entries(latest.statusColors).map(([name, color]) => [renamed(name), color]),
							),
						}
					: {}),
			}),
			message: () => `Rename status "${source}" to "${target}"`,
			autoCommit,
		});
	});
}

export async function removeStatus(
	core: Core,
	status: string,
	moveTo: string | undefined,
	autoCommit?: boolean,
): Promise<WorkflowResult> {
	return await withWorkflowLock(async () => {
		const { config } = await loadWorkflow(core);
		const removed = findStatus(config.statuses, status);
		if (!removed) throw new WorkflowError(`Unknown status: ${status}`, 404);
		if (config.statuses.length <= 2) throw new WorkflowError("A workflow needs at least 2 statuses", 400);

		const sourceKey = statusKey(removed);
		const remaining = config.statuses.filter((name) => statusKey(name) !== sourceKey);
		const used = (await listWorkflowTasks(core)).filter(
			({ task }) => statusKey(task.status ?? "") === sourceKey,
		).length;
		let target: string | undefined;
		if (used > 0) {
			if (!moveTo?.trim()) throw new WorkflowError(`Choose a status for the ${used} tasks that use ${removed}`, 400);
			target = findStatus(remaining, moveTo);
			if (!target) throw new WorkflowError(`Unknown target status: ${moveTo}`, 400);
		}

		return await applyStatusChange(core, {
			source: removed,
			target,
			baseStatuses: config.statuses,
			buildConfig: (latest) => ({
				...latest,
				statuses: latest.statuses.filter((name) => statusKey(name) !== sourceKey),
				...(latest.defaultStatus && statusKey(latest.defaultStatus) === sourceKey
					? { defaultStatus: remaining[0] }
					: {}),
				...(latest.statusColors
					? {
							statusColors: Object.fromEntries(
								Object.entries(latest.statusColors).filter(([name]) => statusKey(name) !== sourceKey),
							),
						}
					: {}),
			}),
			message: (moved) =>
				`Remove status "${removed}"${target && moved > 0 ? ` (moved ${moved} tasks to "${target}")` : ""}`,
			autoCommit,
		});
	});
}

type TaskFolder = "active" | "completed" | "archived";

interface FolderTask {
	task: Task;
	folder: TaskFolder;
}

interface RewrittenTask extends FolderTask {
	/** The file text before the rewrite, written back as-is on rollback. */
	original: string;
}

let workflowQueue: Promise<unknown> = Promise.resolve();

/** Run status changes in this process one at a time, so each one starts from the config the last one saved. */
export function withWorkflowLock<T>(operation: () => Promise<T>): Promise<T> {
	const run = workflowQueue.then(operation);
	workflowQueue = run.catch(() => undefined);
	return run;
}

function findStatus(statuses: string[], name: string): string | undefined {
	const key = statusKey(name);
	return statuses.find((status) => statusKey(status) === key);
}

async function loadWorkflow(core: Core): Promise<{ config: BacklogConfig & { statuses: string[] } }> {
	const config = await core.fs.loadConfig();
	if (!config) throw new Error("No Backlog.md config found");
	return { config: { ...config, statuses: config.statuses ?? [] } };
}

/** Every task file in `tasks/`, `completed/`, and `archive/tasks/`. Drafts are left out. */
async function listWorkflowTasks(core: Core): Promise<FolderTask[]> {
	const [active, completed, archived] = await Promise.all([
		core.fs.listTasks(),
		core.fs.listCompletedTasks(),
		core.fs.listArchivedTasks(),
	]);
	return [
		...active.map((task) => ({ task, folder: "active" as const })),
		...completed.map((task) => ({ task, folder: "completed" as const })),
		...archived.map((task) => ({ task, folder: "archived" as const })),
	];
}

function sameStatuses(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((status, index) => status === right[index]);
}

/**
 * Rewrite the status of every task in `source` (when there is a target), then save the config,
 * refresh any content store, and commit. Before the config is saved, the change is checked against
 * the files again: no task may still use `source`, and the statuses on disk must be the ones the
 * change started from. Any failure up to the config save puts every rewritten file back and leaves
 * the config as it was.
 */
async function applyStatusChange(
	core: Core,
	change: {
		source: string;
		target: string | undefined;
		baseStatuses: string[];
		/** Builds the config to save from the one read just before the save. */
		buildConfig: (latest: BacklogConfig & { statuses: string[] }) => BacklogConfig;
		message: (changedTasks: number) => string;
		autoCommit: boolean | undefined;
	},
): Promise<WorkflowResult> {
	const { source, target } = change;
	const sourceKey = statusKey(source);
	// A task already in the target spelling is done, which matters for a case-only rename.
	const usesSource = (status = "") => statusKey(status) === sourceKey && status !== target;
	const rewritten: RewrittenTask[] = [];
	let nextConfig: BacklogConfig;
	try {
		if (target) {
			for (const candidate of (await listWorkflowTasks(core)).filter(({ task }) => usesSource(task.status))) {
				const result = await rewriteTaskStatus(core, candidate, usesSource, target);
				if (result) rewritten.push(result);
			}
		}
		if ((await listWorkflowTasks(core)).some(({ task }) => usesSource(task.status))) {
			throw new WorkflowError(`Tasks started using ${source} while saving. Reload and try again.`, 409);
		}
		core.fs.invalidateConfigCache();
		const latest = await loadWorkflow(core);
		if (!sameStatuses(latest.config.statuses, change.baseStatuses)) {
			throw new WorkflowError("The workflow changed while saving. Reload and try again.", 409);
		}
		nextConfig = change.buildConfig(latest.config);
		await core.fs.saveConfig(nextConfig);
	} catch (error) {
		const unrestored = await restoreTasks(core, rewritten);
		if (unrestored.length > 0 && error instanceof Error) {
			error.message = `${error.message}; could not restore: ${unrestored.join(", ")}`;
		}
		throw error;
	}

	if (rewritten.length > 0) {
		try {
			await core.refreshTasksInContentStore(rewritten.map(({ task }) => task));
		} catch (error) {
			// The files and config are saved; a stale in-process view must not block the commit.
			console.error("Could not refresh the task view after the status change:", error);
		}
	}

	if (await core.shouldAutoCommit(change.autoCommit)) {
		const paths = [...rewritten.map(({ task }) => task.filePath as string), core.fs.configFilePath];
		try {
			await core.git.addFiles(paths);
			await core.git.commitFiles(change.message(rewritten.length), paths);
		} catch (error) {
			try {
				await core.git.resetPaths(paths);
			} catch {
				// Keep the commit error; it is the one the caller can act on.
			}
			throw new WorkflowCommitError(error);
		}
	}

	return { config: (await core.fs.loadConfig()) ?? nextConfig, changedTasks: rewritten.length };
}

/**
 * Change only the status of one task file, under its lock. The file is re-read there so a
 * concurrent edit is kept; a task whose status changed since the scan is skipped.
 */
async function rewriteTaskStatus(
	core: Core,
	{ task, folder }: FolderTask,
	usesSource: (status?: string) => boolean,
	target: string,
): Promise<RewrittenTask | undefined> {
	const filePath = task.filePath as string;
	return await core.fs.withTaskLock({ id: task.id, filePath }, async () => {
		const original = await Bun.file(filePath).text();
		const parsed = parseTask(original);
		if (!usesSource(parsed.status)) return undefined;
		const current = folder === "active" ? normalizeTaskIdentity(parsed) : parsed;
		const updated: Task = { ...current, status: target, filePath };
		await core.fs.saveTask(updated);
		return { task: updated, folder, original };
	});
}

/** Best effort: write each rewritten file's original text back under its lock. Returns the paths that failed. */
async function restoreTasks(core: Core, rewritten: RewrittenTask[]): Promise<string[]> {
	const unrestored: string[] = [];
	for (const { task, original } of rewritten) {
		const filePath = task.filePath as string;
		try {
			await core.fs.withTaskLock({ id: task.id, filePath }, async () => {
				await Bun.write(filePath, original);
			});
		} catch {
			unrestored.push(filePath);
		}
	}
	return unrestored;
}
