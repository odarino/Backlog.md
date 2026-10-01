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

export function validateStatusList(statuses: string[]): string[] {
	const names = statuses.map(validateStatusName);
	if (names.length < 2) throw new WorkflowError("A workflow needs at least 2 statuses", 400);
	const seen = new Set<string>();
	for (const name of names) {
		const key = statusKey(name);
		if (seen.has(key)) throw new WorkflowError(`Duplicate status: ${name}`, 400);
		seen.add(key);
	}
	return names;
}

export function validateStatusColors(
	colors: Record<string, string> | undefined,
	statuses: string[],
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, color] of Object.entries(colors ?? {})) {
		const status = findStatus(statuses, name);
		if (!status) throw new WorkflowError(`Unknown status in colors: ${name}`, 400);
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
	const { config } = await loadWorkflow(core);
	const source = findStatus(config.statuses, from);
	if (!source) throw new WorkflowError(`Unknown status: ${from}`, 404);
	const target = validateStatusName(to);
	const clash = findStatus(config.statuses, target);
	if (clash && clash !== source) throw new WorkflowError(`Status already exists: ${clash}`, 409);
	if (target === source) return { config, changedTasks: 0 };

	const sourceKey = statusKey(source);
	const renamed = (name: string) => (statusKey(name) === sourceKey ? target : name);
	const nextConfig: BacklogConfig = {
		...config,
		statuses: config.statuses.map(renamed),
		...(config.defaultStatus ? { defaultStatus: renamed(config.defaultStatus) } : {}),
		...(config.statusColors
			? {
					statusColors: Object.fromEntries(
						Object.entries(config.statusColors).map(([name, color]) => [renamed(name), color]),
					),
				}
			: {}),
	};
	return await applyStatusChange(core, {
		sourceKey,
		target,
		nextConfig,
		message: `Rename status "${source}" to "${target}"`,
		autoCommit,
	});
}

export async function removeStatus(
	core: Core,
	status: string,
	moveTo: string | undefined,
	autoCommit?: boolean,
): Promise<WorkflowResult> {
	const { config } = await loadWorkflow(core);
	const removed = findStatus(config.statuses, status);
	if (!removed) throw new WorkflowError(`Unknown status: ${status}`, 404);
	if (config.statuses.length <= 2) throw new WorkflowError("A workflow needs at least 2 statuses", 400);

	const sourceKey = statusKey(removed);
	const remaining = config.statuses.filter((name) => statusKey(name) !== sourceKey);
	const used = (await listWorkflowTasks(core)).filter(({ task }) => statusKey(task.status ?? "") === sourceKey).length;
	let target: string | undefined;
	if (used > 0) {
		if (!moveTo?.trim()) throw new WorkflowError(`Choose a status for the ${used} tasks that use ${removed}`, 400);
		target = findStatus(remaining, moveTo);
		if (!target) throw new WorkflowError(`Unknown target status: ${moveTo}`, 400);
	}

	const nextConfig: BacklogConfig = {
		...config,
		statuses: remaining,
		...(config.defaultStatus && statusKey(config.defaultStatus) === sourceKey ? { defaultStatus: remaining[0] } : {}),
		...(config.statusColors
			? {
					statusColors: Object.fromEntries(
						Object.entries(config.statusColors).filter(([name]) => statusKey(name) !== sourceKey),
					),
				}
			: {}),
	};
	const moved = target ? ` (moved ${used} tasks to "${target}")` : "";
	return await applyStatusChange(core, {
		sourceKey,
		target,
		nextConfig,
		message: `Remove status "${removed}"${moved}`,
		autoCommit,
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

/**
 * Rewrite the status of every task matching `sourceKey` (when there is a target), then save the
 * config, refresh any content store, and commit. A failure before the config is saved puts every
 * rewritten file back and leaves the config as it was.
 */
async function applyStatusChange(
	core: Core,
	change: {
		sourceKey: string;
		target: string | undefined;
		nextConfig: BacklogConfig;
		message: string;
		autoCommit: boolean | undefined;
	},
): Promise<WorkflowResult> {
	const { sourceKey, target } = change;
	const rewritten: RewrittenTask[] = [];
	try {
		if (target) {
			for (const candidate of await listWorkflowTasks(core)) {
				if (statusKey(candidate.task.status ?? "") !== sourceKey) continue;
				const result = await rewriteTaskStatus(core, candidate, sourceKey, target);
				if (result) rewritten.push(result);
			}
		}
		await core.fs.saveConfig(change.nextConfig);
	} catch (error) {
		await restoreTasks(core, rewritten);
		throw error;
	}

	if (rewritten.length > 0) await refreshContentStore(core, rewritten);

	if (await core.shouldAutoCommit(change.autoCommit)) {
		const paths = [...rewritten.map(({ task }) => task.filePath as string), core.fs.configFilePath];
		await core.git.addFiles(paths);
		await core.git.commitFiles(change.message, paths);
	}

	return { config: (await core.fs.loadConfig()) ?? change.nextConfig, changedTasks: rewritten.length };
}

/**
 * Change only the status of one task file, under its lock. The file is re-read there so a
 * concurrent edit is kept; a task whose status changed since the scan is skipped.
 */
async function rewriteTaskStatus(
	core: Core,
	{ task, folder }: FolderTask,
	sourceKey: string,
	target: string,
): Promise<RewrittenTask | undefined> {
	const filePath = task.filePath as string;
	return await core.fs.withTaskLock({ id: task.id, filePath }, async () => {
		const original = await Bun.file(filePath).text();
		const parsed = parseTask(original);
		if (statusKey(parsed.status ?? "") !== sourceKey) return undefined;
		const current = folder === "active" ? normalizeTaskIdentity(parsed) : parsed;
		const updated: Task = { ...current, status: target, filePath };
		await core.fs.saveTask(updated);
		return { task: updated, folder, original };
	});
}

/** Best effort: write each rewritten file's original text back under its lock. */
async function restoreTasks(core: Core, rewritten: RewrittenTask[]): Promise<void> {
	for (const { task, original } of rewritten) {
		const filePath = task.filePath as string;
		try {
			await core.fs.withTaskLock({ id: task.id, filePath }, async () => {
				await Bun.write(filePath, original);
			});
		} catch {
			// Keep restoring the rest; the caller rethrows the original failure.
		}
	}
}

/** Publish the rewritten records the way the bulk writers do. Archived tasks are not in the store. */
async function refreshContentStore(core: Core, rewritten: RewrittenTask[]): Promise<void> {
	const store = await core.getContentStore();
	await store.batchTaskUpdates(async () => {
		for (const { task, folder } of rewritten) {
			if (folder === "active") store.upsertTask(task);
			else if (folder === "completed") store.refreshCompletedTask(task);
		}
	});
}
