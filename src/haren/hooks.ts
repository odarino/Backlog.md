import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { resolveBacklogDirectory } from "../utils/backlog-directory.ts";
import {
	type BoardTask,
	diffBoard,
	type HarenUpdate,
	labelFor,
	loadState,
	readConfig,
	rebuildState,
	saveState,
} from "./sync.ts";

export interface HookEnv {
	root?: string;
	dataDir?: string;
	configJson?: string;
}
export interface HookResult {
	messages: string[];
	updates: HarenUpdate[];
}

interface PlannedTask {
	key: string;
	title: string;
	description?: string;
	dependencies?: string[];
}

// Strict check for one directory: no walk-up and no git fallback.
async function hasBacklogProject(root: string): Promise<boolean> {
	if (resolveBacklogDirectory(root).configPath) return true;
	try {
		return (await stat(join(root, "backlog.json"))).isFile();
	} catch {
		return false;
	}
}

export async function runHarenHook(hook: string, payload: Record<string, unknown>, env: HookEnv): Promise<HookResult> {
	if (!["session-start", "after-plan", "on-task-status"].includes(hook)) {
		throw new Error(`Unknown haren hook: ${hook}`);
	}
	if (!env.dataDir) return { messages: ["HAREN_PLUGIN_DATA is not set; update haren"], updates: [] };
	const root = env.root;
	if (!root || !(await hasBacklogProject(root))) {
		return { messages: ["No Backlog.md project found. Run 'backlog init' in the project root."], updates: [] };
	}
	const core = new Core(root);
	const config = readConfig(env.configJson);
	const boardTasks: BoardTask[] = (await core.filesystem.listTasks()).map((t) => ({
		id: t.id,
		title: t.title,
		status: t.status,
		description: t.description,
		labels: t.labels ?? [],
	}));
	const state = rebuildState(await loadState(env.dataDir), boardTasks);
	const existing = new Set(boardTasks.map((t) => t.id));
	const messages: string[] = [];

	if (hook === "session-start") {
		const diff = diffBoard(state, boardTasks, config);
		await saveState(env.dataDir, diff.state);
		return { messages: diff.messages, updates: diff.updates };
	}

	if (hook === "on-task-status") {
		const key = `${String(payload.module)}/${String(payload.feature)}`;
		const entry = state.tasks[key];
		if (!entry || !existing.has(entry.backlogId)) {
			return { messages: [`No board task for ${key}; run the plan sync first`], updates: [] };
		}
		const mapped = config.statusMap[String(payload.status)];
		if (!mapped) return { messages: [`haren status "${String(payload.status)}" has no board mapping`], updates: [] };
		await core.updateTaskFromInput(entry.backlogId, { status: mapped }, false);
		entry.lastSynced.status = mapped;
		await saveState(env.dataDir, state);
		return { messages: [], updates: [] };
	}

	// after-plan
	const module = String(payload.module);
	const tasks = Array.isArray(payload.tasks) ? (payload.tasks as PlannedTask[]) : [];
	const planned = new Set<string>();
	const created = new Set<string>();
	// Pass 1: create or update every planned task (new tasks get no dependencies yet).
	for (const t of tasks) {
		const key = `${module}/${t.key}`;
		planned.add(key);
		const description = t.description ?? "";
		const entry = state.tasks[key];
		if (entry && existing.has(entry.backlogId)) {
			await core.updateTaskFromInput(entry.backlogId, { title: t.title, description }, false);
			entry.lastSynced = { ...entry.lastSynced, title: t.title, description };
		} else {
			if (entry) messages.push(`Recreated ${key}: ${entry.backlogId} was missing on the board`);
			const status = config.statusMap.pending ?? "To Do";
			const { task } = await core.createTaskFromInput(
				{ title: t.title, description, labels: [labelFor(key)], status },
				false,
			);
			state.tasks[key] = { backlogId: task.id, lastSynced: { status, title: t.title, description } };
			existing.add(task.id);
			created.add(key);
		}
	}
	// Pass 2: set dependencies, only to tasks that exist on the board now.
	for (const t of tasks) {
		const key = `${module}/${t.key}`;
		const id = state.tasks[key]?.backlogId;
		if (!id) continue;
		const dependencies = (t.dependencies ?? [])
			.map((dep) => state.tasks[`${module}/${dep}`]?.backlogId)
			.filter((depId): depId is string => typeof depId === "string" && existing.has(depId));
		if (created.has(key) && dependencies.length === 0) continue;
		try {
			await core.updateTaskFromInput(id, { dependencies }, false);
		} catch (error) {
			// Core can refuse a dependency, for example when an archived task reuses the same ID.
			messages.push(`Could not set dependencies for ${key}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	for (const [key, entry] of Object.entries(state.tasks)) {
		if (!key.startsWith(`${module}/`) || planned.has(key)) continue;
		if (existing.has(entry.backlogId)) {
			await core.archiveTask(entry.backlogId, false);
			messages.push(`Archived ${entry.backlogId}: ${key} is no longer in the plan`);
		} else {
			messages.push(`${entry.backlogId} already missing; dropped ${key}`);
		}
		delete state.tasks[key];
	}
	await saveState(env.dataDir, state);
	messages.unshift(`Synced ${tasks.length} tasks for ${module} to the board`);
	return { messages, updates: [] };
}
