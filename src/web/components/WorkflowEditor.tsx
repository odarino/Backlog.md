import React, { useEffect, useRef, useState } from "react";
import type { BacklogConfig } from "../../types";
import { apiClient } from "../lib/api";
import {
	buildWorkflowPlan,
	hasWorkflowChanges,
	insertNewRow,
	moveRow,
	rowsFromConfig,
	validateRows,
	type WorkflowRemoval,
	type WorkflowRow,
} from "../lib/workflow-plan";
import Modal from "./Modal";
import { SuccessToast } from "./SuccessToast";

interface WorkflowEditorProps {
	config: BacklogConfig;
	onSaved: () => void;
}

const DEFAULT_COLOR = "#94a3b8";

const iconButton =
	"px-2 py-1 text-sm text-gray-600 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400";
const inputClass =
	"flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400";

const WorkflowEditor: React.FC<WorkflowEditorProps> = ({ config, onSaved }) => {
	const [rows, setRows] = useState<WorkflowRow[]>(() => rowsFromConfig(config.statuses, config.statusColors));
	const [removals, setRemovals] = useState<WorkflowRemoval[]>([]);
	const [usage, setUsage] = useState<Record<string, number>>({});
	const [newName, setNewName] = useState("");
	const [pendingDelete, setPendingDelete] = useState<WorkflowRow | null>(null);
	const [moveTo, setMoveTo] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const nextId = useRef(1);
	const dragIndex = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		apiClient
			.fetchStatusUsage()
			.then((data) => {
				if (!cancelled) setUsage(data);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load status usage");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const edit = (next: WorkflowRow[]) => {
		setRows(next);
		setError(null);
	};

	const updateRow = (id: string, patch: Partial<WorkflowRow>) =>
		edit(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

	const handleDrop = (target: number) => {
		let from = dragIndex.current;
		dragIndex.current = null;
		if (from === null) return;
		let next = rows;
		while (from !== target) {
			const delta = from < target ? 1 : -1;
			next = moveRow(next, from, delta);
			from += delta;
		}
		edit(next);
	};

	const handleAdd = () => {
		const name = newName.trim();
		if (!name) return;
		edit(insertNewRow(rows, name, `new-${nextId.current++}`));
		setNewName("");
	};

	// Tasks already assigned to a status by an earlier removal count toward its usage.
	const effectiveUsage = (status: string) =>
		(usage[status] ?? 0) +
		removals.reduce((sum, removal) => (removal.moveTo === status ? sum + (usage[removal.status] ?? 0) : sum), 0);

	const removeRow = (row: WorkflowRow, target: string | null) => {
		if (row.original !== null) {
			setRemovals([...removals, { status: row.original, moveTo: target }]);
		}
		edit(rows.filter((r) => r.id !== row.id));
	};

	const moveTargets = (row: WorkflowRow | null) =>
		config.statuses.filter(
			(status) => status !== row?.original && !removals.some((removal) => removal.status === status),
		);

	const handleDelete = (row: WorkflowRow) => {
		const count = row.original === null ? 0 : effectiveUsage(row.original);
		if (count === 0) {
			removeRow(row, null);
			return;
		}
		setMoveTo(moveTargets(row)[0] ?? "");
		setPendingDelete(row);
	};

	const confirmDelete = () => {
		if (!pendingDelete || !moveTo) return;
		removeRow(pendingDelete, moveTo);
		setPendingDelete(null);
	};

	const validation = validateRows(rows);
	const changed = hasWorkflowChanges(config.statuses, config.statusColors, rows, removals);
	const message = error ?? validation;

	const handleSave = async () => {
		const plan = buildWorkflowPlan(config.statuses, rows, removals);
		if ("error" in plan) {
			setError(plan.error);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			for (const removal of plan.removals) {
				await apiClient.removeStatus(removal.status, removal.moveTo ?? undefined);
			}
			for (const rename of plan.renames) {
				await apiClient.renameStatus(rename.from, rename.to);
			}
			const fresh = await apiClient.fetchConfig();
			await apiClient.updateConfig({ ...fresh, statuses: plan.statuses, statusColors: plan.statusColors });
			setSaved(true);
			window.setTimeout(() => setSaved(false), 3000);
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save workflow");
			onSaved();
		} finally {
			setSaving(false);
		}
	};

	const pendingCount = pendingDelete?.original ? effectiveUsage(pendingDelete.original) : 0;

	return (
		<div>
			<ul className="space-y-2">
				{rows.map((row, index) => (
					<li
						key={row.id}
						className="flex items-center gap-2"
						onDragOver={(e) => {
							if (dragIndex.current !== null) e.preventDefault();
						}}
						onDrop={(e) => {
							e.preventDefault();
							handleDrop(index);
						}}
					>
						<span
							draggable
							aria-label={`Drag ${row.name}`}
							onDragStart={(e) => {
								dragIndex.current = index;
								e.dataTransfer.effectAllowed = "move";
								e.dataTransfer.setData("text/plain", row.id);
							}}
							onDragEnd={() => {
								dragIndex.current = null;
							}}
							className="cursor-grab select-none px-1 text-gray-400 dark:text-gray-500"
						>
							⠿
						</span>
						<button
							type="button"
							aria-label={`Move ${row.name} up`}
							disabled={index === 0}
							onClick={() => edit(moveRow(rows, index, -1))}
							className={iconButton}
						>
							↑
						</button>
						<button
							type="button"
							aria-label={`Move ${row.name} down`}
							disabled={index === rows.length - 1}
							onClick={() => edit(moveRow(rows, index, 1))}
							className={iconButton}
						>
							↓
						</button>
						<input
							type="color"
							aria-label={`Color for ${row.name}`}
							value={row.color ?? DEFAULT_COLOR}
							onChange={(e) => updateRow(row.id, { color: e.target.value.toLowerCase() })}
							className="h-8 w-8 cursor-pointer rounded border border-gray-300 dark:border-gray-600 bg-transparent p-0.5"
						/>
						<input
							type="text"
							aria-label="Status name"
							value={row.name}
							onChange={(e) => updateRow(row.id, { name: e.target.value })}
							className={inputClass}
						/>
						{index === rows.length - 1 && (
							<span className="rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
								Done
							</span>
						)}
						<button
							type="button"
							aria-label={`Delete ${row.name}`}
							onClick={() => handleDelete(row)}
							className="px-2 py-1 text-sm text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/20 focus:outline-none focus:ring-2 focus:ring-red-400"
						>
							×
						</button>
					</li>
				))}
			</ul>

			<div className="mt-3 flex items-center gap-2">
				<input
					type="text"
					aria-label="New status"
					placeholder="New status"
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							handleAdd();
						}
					}}
					className={inputClass}
				/>
				<button
					type="button"
					onClick={handleAdd}
					disabled={newName.trim().length === 0}
					className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
				>
					Add
				</button>
			</div>

			{message && (
				<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
					{message}
				</p>
			)}

			<div className="mt-4 flex justify-end">
				<button
					type="button"
					onClick={handleSave}
					disabled={!changed || validation !== null || saving}
					className="px-4 py-2 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 disabled:opacity-50 transition-colors duration-200"
				>
					Save workflow
				</button>
			</div>

			<Modal
				isOpen={pendingDelete !== null}
				onClose={() => setPendingDelete(null)}
				title={`Delete ${pendingDelete?.name ?? ""}`}
				maxWidthClass="max-w-md"
			>
				<p className="text-sm text-gray-700 dark:text-gray-300">
					{pendingCount} {pendingCount === 1 ? "task uses" : "tasks use"} "{pendingDelete?.name}". Move them to:
				</p>
				<select
					aria-label="Move tasks to"
					value={moveTo}
					onChange={(e) => setMoveTo(e.target.value)}
					className="mt-3 w-full h-10 px-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
				>
					{moveTargets(pendingDelete).map((status) => (
						<option key={status} value={status}>
							{status}
						</option>
					))}
				</select>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={() => setPendingDelete(null)}
						className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={confirmDelete}
						disabled={!moveTo}
						className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
					>
						Delete
					</button>
				</div>
			</Modal>

			{saved && <SuccessToast message="Workflow saved" onDismiss={() => setSaved(false)} />}
		</div>
	);
};

export default WorkflowEditor;
