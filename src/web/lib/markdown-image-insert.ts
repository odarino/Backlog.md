import type { SavedAsset } from "../../types";

const ALT_UNSAFE = /[\]\\[]/g;

function stripAlternativeChars(text: string): string {
	return text.replace(ALT_UNSAFE, "").replace(/[\r\n]/g, "");
}
let placeholderCounter = 0;

export function imageMarkdown(name: string, path: string): string {
	const alt = stripAlternativeChars(name.replace(/\.[^.]*$/, "")).trim();
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
	return `![Uploading ${stripAlternativeChars(name)}…](uploading:${Date.now().toString(36)}-${placeholderCounter})`;
}

export function replaceFirst(value: string, search: string, replacement: string): string {
	const index = value.indexOf(search);
	return index < 0 ? value : value.slice(0, index) + replacement + value.slice(index + search.length);
}

const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
};

function withImageType(file: File): File | null {
	if (file.type.startsWith("image/")) return file;
	if (file.type) return null;
	const type = IMAGE_TYPE_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""];
	return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : null;
}

function isDataTransfer(source: unknown): source is DataTransfer {
	return typeof source === "object" && source !== null && "files" in source;
}

// Windows clipboards can expose an image only through items, or as a file with an empty MIME type.
export function imageFilesFrom(source: DataTransfer | FileList | File[] | null | undefined): File[] {
	const candidates: File[] = [];
	if (isDataTransfer(source)) {
		candidates.push(...Array.from(source.files ?? []));
		for (const item of Array.from(source.items ?? [])) {
			if (item.kind !== "file") continue;
			const file = item.getAsFile();
			if (file) candidates.push(file);
		}
	} else {
		candidates.push(...Array.from(source ?? []));
	}
	const seen = new Set<string>();
	const result: File[] = [];
	for (const candidate of candidates) {
		const key = `${candidate.name}|${candidate.size}|${candidate.lastModified}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const file = withImageType(candidate);
		if (file) result.push(file);
	}
	return result;
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
	const segment = path.split("/").pop() ?? path;
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
