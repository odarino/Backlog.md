import { Core } from "../core/backlog.ts";
import { findBacklogRoot } from "../utils/find-backlog-root.ts";
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

export async function runHarenHook(hook: string, payload: Record<string, unknown>, env: HookEnv): Promise<HookResult> {
	if (!["session-start", "after-plan", "on-task-status"].includes(hook)) {
		throw new Error(`Unknown haren hook: ${hook}`);
	}
	if (!env.dataDir) return { messages: ["HAREN_PLUGIN_DATA is not set; update haren"], updates: [] };
	const root = await findBacklogRoot(env.root ?? process.cwd());
	if (!root) {
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
	for (const t of tasks) {
		const key = `${module}/${t.key}`;
		planned.add(key);
		const description = t.description ?? "";
		const dependencies = (t.dependencies ?? [])
			.map((dep) => state.tasks[`${module}/${dep}`]?.backlogId)
			.filter((id): id is string => typeof id === "string");
		const entry = state.tasks[key];
		if (entry && existing.has(entry.backlogId)) {
			await core.updateTaskFromInput(entry.backlogId, { title: t.title, description, dependencies }, false);
			entry.lastSynced = { ...entry.lastSynced, title: t.title, description };
		} else {
			const status = config.statusMap.pending ?? "To Do";
			const { task } = await core.createTaskFromInput(
				{ title: t.title, description, dependencies, labels: [labelFor(key)], status },
				false,
			);
			state.tasks[key] = { backlogId: task.id, lastSynced: { status, title: t.title, description } };
			existing.add(task.id);
		}
	}
	for (const [key, entry] of Object.entries(state.tasks)) {
		if (!key.startsWith(`${module}/`) || planned.has(key)) continue;
		if (existing.has(entry.backlogId)) await core.archiveTask(entry.backlogId, false);
		delete state.tasks[key];
		messages.push(`Archived ${entry.backlogId}: ${key} is no longer in the plan`);
	}
	await saveState(env.dataDir, state);
	messages.unshift(`Synced ${tasks.length} tasks for ${module} to the board`);
	return { messages, updates: [] };
}
