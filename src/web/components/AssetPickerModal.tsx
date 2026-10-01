import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetEntry, SavedAsset } from "../../types";
import { apiClient } from "../lib/api";
import { imageMarkdown } from "../lib/markdown-image-insert";
import Modal from "./Modal";

interface Props {
	isOpen: boolean;
	taskId?: string;
	onClose: () => void;
	onInsert: (markdown: string) => void;
	onUploaded?: (saved: SavedAsset) => void;
}

export default function AssetPickerModal({ isOpen, taskId, onClose, onInsert, onUploaded }: Props) {
	const [assets, setAssets] = useState<AssetEntry[]>([]);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const currentFolder = taskId?.toLowerCase() ?? null;

	const reload = async () => {
		try {
			setAssets(await apiClient.listAssets(taskId));
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : "Failed to load images");
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the picker opens or the task changes.
	useEffect(() => {
		if (!isOpen) return;
		setQuery("");
		setSelected([]);
		setError(null);
		void reload();
	}, [isOpen, taskId]);

	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle ? assets.filter((asset) => asset.name.toLowerCase().includes(needle)) : assets;
	}, [assets, query]);
	const mine = visible.filter((asset) => currentFolder !== null && asset.taskId === currentFolder);
	const others = visible.filter((asset) => !(currentFolder !== null && asset.taskId === currentFolder));

	const toggle = (path: string) =>
		setSelected((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path]));

	const insert = (paths: string[]) => {
		const byPath = new Map(assets.map((asset) => [asset.path, asset]));
		const markdown = paths
			.map((path) => byPath.get(path))
			.filter((asset): asset is AssetEntry => Boolean(asset))
			.map((asset) => imageMarkdown(asset.name, asset.path))
			.join("\n");
		if (markdown) onInsert(markdown);
		onClose();
	};

	const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.currentTarget.files ?? []);
		event.currentTarget.value = "";
		if (files.length === 0) return;
		setUploading(true);
		setError(null);
		const added: string[] = [];
		for (const file of files) {
			try {
				const saved = await apiClient.uploadAsset(file, file.name, taskId);
				added.push(saved.path);
				onUploaded?.(saved);
			} catch (uploadError) {
				setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
			}
		}
		await reload();
		setSelected((current) => [...added, ...current.filter((path) => !added.includes(path))]);
		setUploading(false);
	};

	if (!isOpen) return null;

	const renderGroup = (title: string, items: AssetEntry[]) =>
		items.length > 0 && (
			<section className="mb-4">
				<h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{items.map((asset) => {
						const isSelected = selected.includes(asset.path);
						return (
							<button
								key={asset.path}
								type="button"
								aria-pressed={isSelected}
								onClick={() => toggle(asset.path)}
								onDoubleClick={() => insert([asset.path])}
								className={`overflow-hidden rounded-lg border text-left transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
									isSelected
										? "border-blue-500 ring-2 ring-blue-500"
										: "border-gray-200 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500"
								}`}
							>
								<img src={asset.path} alt={asset.name} loading="lazy" className="h-24 w-full bg-gray-100 object-cover dark:bg-gray-900" />
								<span className="block truncate px-2 py-1 text-xs text-gray-700 dark:text-gray-300">{asset.name}</span>
							</button>
						);
					})}
				</div>
			</section>
		);

	return createPortal(
		<Modal
			isOpen={true}
			onClose={onClose}
			title="Images"
			maxWidthClass="max-w-3xl"
			actions={
				<div className="flex items-center gap-2">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						multiple
						className="hidden"
						onChange={(event) => void handleFiles(event)}
					/>
					<button
						type="button"
						disabled={uploading}
						onClick={() => fileInputRef.current?.click()}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
					>
						{uploading ? "Uploading…" : "Upload"}
					</button>
					<button
						type="button"
						disabled={selected.length === 0}
						onClick={() => insert(selected)}
						className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{selected.length > 0 ? `Insert (${selected.length})` : "Insert"}
					</button>
				</div>
			}
		>
			<input
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search"
				aria-label="Search images"
				className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
			/>
			{error && (
				<div role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
					{error}
				</div>
			)}
			{renderGroup("This task", mine)}
			{renderGroup("All assets", others)}
		</Modal>,
		document.body,
	);
}
