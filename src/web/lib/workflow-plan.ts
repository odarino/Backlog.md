export interface WorkflowRow {
	id: string;
	original: string | null;
	name: string;
	color: string | null;
}

export interface WorkflowRemoval {
	status: string;
	moveTo: string | null;
}

export interface WorkflowPlan {
	preAdd: string[] | null; // new names to add first (after the saved list), so removals never leave fewer than 2
	removals: WorkflowRemoval[];
	renames: Array<{ from: string; to: string }>;
	statuses: string[];
	statusColors: Record<string, string>;
}

const MAX_STATUS_LENGTH = 40;

// Same normalization as getCanonicalStatus on the server (web code must not import src/core).
function statusKey(name: string): string {
	return name.toLowerCase().replace(/\s+/g, "");
}

export function rowsFromConfig(statuses: string[], colors: Record<string, string> | undefined): WorkflowRow[] {
	return statuses.map((name, index) => ({
		id: `s${index}`,
		original: name,
		name,
		color: colors?.[name]?.toLowerCase() ?? null,
	}));
}

export function insertNewRow(rows: WorkflowRow[], name: string, id: string): WorkflowRow[] {
	const row: WorkflowRow = { id, original: null, name, color: null };
	const index = Math.max(rows.length - 1, 0);
	return [...rows.slice(0, index), row, ...rows.slice(index)];
}

export function moveRow(rows: WorkflowRow[], index: number, delta: -1 | 1): WorkflowRow[] {
	const target = index + delta;
	if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
	const next = [...rows];
	[next[index], next[target]] = [next[target] as WorkflowRow, next[index] as WorkflowRow];
	return next;
}

export function validateRows(rows: WorkflowRow[]): string | null {
	const seen = new Set<string>();
	for (const row of rows) {
		const name = row.name.trim();
		if (name.length === 0) return "Status name is required";
		if (name.length > MAX_STATUS_LENGTH) return `Status name "${name}" is longer than ${MAX_STATUS_LENGTH} characters`;
		if (/["\\\t\r\n]/.test(name))
			return `Status name "${name}" cannot contain quotes, backslashes, tabs, or line breaks`;
		const key = statusKey(name);
		if (key === "draft") return "Draft is a reserved status name";
		if (seen.has(key)) return `Status "${name}" is used more than once`;
		seen.add(key);
	}
	if (rows.length < 2) return "A workflow needs at least 2 statuses";
	return null;
}

export function buildWorkflowPlan(
	saved: string[],
	rows: WorkflowRow[],
	removals: WorkflowRemoval[],
): WorkflowPlan | { error: string } {
	const invalid = validateRows(rows);
	if (invalid) return { error: invalid };

	const removed = new Set(removals.map((removal) => removal.status));
	const renames: Array<{ from: string; to: string }> = [];
	for (const row of rows) {
		const to = row.name.trim();
		if (row.original === null || to === row.original) continue;
		const clash = saved.some(
			(status) => status !== row.original && !removed.has(status) && statusKey(status) === statusKey(to),
		);
		if (clash) return { error: "Rename to an existing status name in a separate save" };
		renames.push({ from: row.original, to });
	}

	// New names are added first, so removals never drop the workflow below 2 statuses.
	// A new name that matches a saved status by key waits for the final update, after the removals.
	const savedKeys = new Set(saved.map(statusKey));
	const newNames = rows.filter((row) => row.original === null).map((row) => row.name.trim());
	const preAdd = removals.length > 0 ? newNames.filter((name) => !savedKeys.has(statusKey(name))) : [];
	const deferred = removals.length > 0 && preAdd.length < newNames.length;
	if (deferred && saved.length - removals.length < 2) {
		return { error: "Add a status with the name of an existing status in a separate save" };
	}

	const statusColors: Record<string, string> = {};
	for (const row of rows) {
		if (row.color) statusColors[row.name.trim()] = row.color.toLowerCase();
	}
	return {
		preAdd: preAdd.length > 0 ? preAdd : null,
		removals,
		renames,
		statuses: rows.map((row) => row.name.trim()),
		statusColors,
	};
}

export function hasWorkflowChanges(
	saved: string[],
	savedColors: Record<string, string> | undefined,
	rows: WorkflowRow[],
	removals: WorkflowRemoval[],
): boolean {
	if (removals.length > 0 || rows.length !== saved.length) return true;
	return rows.some((row, index) => {
		if (row.original === null || row.name !== saved[index]) return true;
		return (row.color?.toLowerCase() ?? null) !== (savedColors?.[row.original]?.toLowerCase() ?? null);
	});
}
