import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type HarenStatus = "pending" | "in-progress" | "evaluating" | "passing" | "fixing" | "blocked";
export interface Snapshot {
	status: string;
	title: string;
	description: string;
}
export interface StateEntry {
	backlogId: string;
	lastSynced: Snapshot;
}
export interface SyncState {
	version: 1;
	tasks: Record<string, StateEntry>;
}
export interface HarenUpdate {
	module: string;
	feature: string;
	status: HarenStatus;
}
export interface BoardTask {
	id: string;
	title: string;
	status: string;
	description?: string;
	labels: string[];
}
export interface SyncConfig {
	statusMap: Record<string, string>;
	boardMap: Record<string, HarenStatus>;
}

export const DEFAULT_STATUS_MAP: Record<string, string> = {
	pending: "To Do",
	"in-progress": "In Progress",
	evaluating: "In Progress",
	fixing: "In Progress",
	passing: "Done",
	blocked: "To Do",
};
export const DEFAULT_BOARD_MAP: Record<string, HarenStatus> = {
	"To Do": "pending",
	"In Progress": "in-progress",
	Done: "passing",
};

const LABEL_PREFIX = "haren:";

export function readConfig(json: string | undefined): SyncConfig {
	let raw: { statusMap?: Record<string, string>; boardMap?: Record<string, HarenStatus> } = {};
	try {
		raw = json ? JSON.parse(json) : {};
	} catch {
		raw = {};
	}
	return {
		statusMap: { ...DEFAULT_STATUS_MAP, ...(raw.statusMap ?? {}) },
		boardMap: { ...DEFAULT_BOARD_MAP, ...(raw.boardMap ?? {}) },
	};
}

export function labelFor(key: string): string {
	return `${LABEL_PREFIX}${key}`;
}

export function keyFromLabels(labels: string[]): string | undefined {
	return labels.find((l) => l.startsWith(LABEL_PREFIX))?.slice(LABEL_PREFIX.length);
}

export function splitKey(key: string): { module: string; feature: string } {
	const slash = key.indexOf("/");
	return { module: key.slice(0, slash), feature: key.slice(slash + 1) };
}

export async function loadState(dataDir: string): Promise<SyncState> {
	try {
		const data = JSON.parse(await readFile(join(dataDir, "state.json"), "utf-8")) as Partial<SyncState>;
		if (!data || typeof data.tasks !== "object" || data.tasks === null) return { version: 1, tasks: {} };
		return { version: 1, tasks: data.tasks };
	} catch {
		return { version: 1, tasks: {} };
	}
}

export async function saveState(dataDir: string, state: SyncState): Promise<void> {
	await mkdir(dataDir, { recursive: true });
	await writeFile(join(dataDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export function snapshotOf(task: BoardTask): Snapshot {
	return { status: task.status, title: task.title, description: task.description ?? "" };
}

export function rebuildState(state: SyncState, tasks: BoardTask[]): SyncState {
	const next: SyncState = { version: 1, tasks: { ...state.tasks } };
	for (const task of tasks) {
		const key = keyFromLabels(task.labels);
		if (key && !next.tasks[key]) next.tasks[key] = { backlogId: task.id, lastSynced: snapshotOf(task) };
	}
	return next;
}

export function diffBoard(
	state: SyncState,
	tasks: BoardTask[],
	config: SyncConfig,
): { updates: HarenUpdate[]; messages: string[]; state: SyncState } {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const updates: HarenUpdate[] = [];
	const messages: string[] = [];
	const next: SyncState = { version: 1, tasks: {} };
	for (const [key, entry] of Object.entries(state.tasks)) {
		const task = byId.get(entry.backlogId);
		const lastSynced = { ...entry.lastSynced };
		next.tasks[key] = { backlogId: entry.backlogId, lastSynced };
		if (!task) {
			messages.push(`${entry.backlogId} for ${key} is missing on the board`);
			continue;
		}
		if (task.status !== lastSynced.status) {
			const status = config.boardMap[task.status];
			if (status) updates.push({ ...splitKey(key), status });
			else messages.push(`Board status "${task.status}" of ${task.id} has no haren mapping`);
			lastSynced.status = task.status;
		}
		if (task.title !== lastSynced.title || (task.description ?? "") !== lastSynced.description) {
			messages.push(
				`${task.id}: title or description changed on the board. haren owns these fields; the next plan sync overwrites them.`,
			);
		}
	}
	return { updates, messages, state: next };
}
