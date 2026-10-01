import type { SavedAsset } from "../../types";

const ALT_UNSAFE = /[[\]\\]/g;
let placeholderCounter = 0;

export function imageMarkdown(name: string, path: string): string {
	const alt = name
		.replace(/\.[^.]*$/, "")
		.replace(ALT_UNSAFE, "")
		.trim();
	return `![${alt}](${path})`;
}

export function insertAtSelection(
	value: string,
	start: number,
	end: number,
	text: string,
): { value: string; cursor: number } {
	const from = Math.max(0, Math.min(start, value.length));
	const to = Math.max(from, Math.min(end, value.length));
	return { value: value.slice(0, from) + text + value.slice(to), cursor: from + text.length };
}

export function uploadPlaceholder(name: string): string {
	placeholderCounter += 1;
	return `![Uploading ${name.replace(ALT_UNSAFE, "")}…](uploading:${Date.now().toString(36)}-${placeholderCounter})`;
}

export function replaceFirst(value: string, search: string, replacement: string): string {
	const index = value.indexOf(search);
	return index < 0 ? value : value.slice(0, index) + replacement + value.slice(index + search.length);
}

export function imageFilesFrom(files: FileList | File[] | null | undefined): File[] {
	return Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function uploadToastMessage(saved: SavedAsset): string {
	return saved.compressed
		? `Compressed ${formatBytes(saved.originalSize)} → ${formatBytes(saved.finalSize)}`
		: "Saved (not compressed)";
}

export function fileNameFromPath(path: string): string {
	return decodeURIComponent(path.split("/").pop() ?? path);
}
