import { constants, type Dirent, type Stats } from "node:fs";
import { copyFile, link, mkdir, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import type { AssetEntry, SavedAsset, Task, TaskUpdateInput } from "../types/index.ts";
import { type CompressOptions, compressImage, ImageDecodeError, UnsupportedImageError } from "./image-compress.ts";

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const UNSORTED_FOLDER = "_unsorted";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const FOLDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class AssetError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 413 | 415 | 422,
	) {
		super(message);
		this.name = "AssetError";
	}
}

export function assetFolderForTask(taskId?: string | null): string {
	const folder = (taskId ?? "").trim().toLowerCase();
	if (!folder) return UNSORTED_FOLDER;
	if (!FOLDER_PATTERN.test(folder) || folder.includes("..")) {
		throw new AssetError(`Invalid task ID: ${taskId}`, 400);
	}
	return folder;
}

export function slugifyAssetName(name: string): string {
	const base = basename(name.replaceAll("\\", "/")).replace(/\.[^.]*$/, "");
	const slug = base
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/đ/gi, "d")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
		.replace(/^-+|-+$/g, "");
	// Windows reserves these device names, with or without an extension.
	return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(slug) ? `${slug}-image` : slug;
}

export function pasteAssetName(now: Date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `paste-${date}-${time}`;
}

function toPublicPath(assetsRoot: string, filePath: string): string {
	return `/assets/${relative(assetsRoot, filePath).split(sep).map(encodeURIComponent).join("/")}`;
}

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isExistsError(error: unknown): boolean {
	return errorCode(error) === "EEXIST";
}

// link() fails with these on file systems without hard links (FAT, exFAT, some network shares).
const NO_HARD_LINK_CODES = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

/**
 * Hard-link `source` to `candidate`, or copy it when the file system has no hard links. Both fail with
 * EEXIST when `candidate` exists, so neither overwrites. `linkFile` is a test seam.
 */
export async function placeFile(
	source: string,
	candidate: string,
	linkFile: (existingPath: string, newPath: string) => Promise<void> = link,
): Promise<void> {
	try {
		await linkFile(source, candidate);
	} catch (error) {
		if (!NO_HARD_LINK_CODES.has(errorCode(error) ?? "")) throw error;
		await copyFile(source, candidate, constants.COPYFILE_EXCL);
	}
}

/**
 * Pick the first free `stem.ext`, `stem-1.ext`, … and hand it to `place`, which must fail with EEXIST
 * when the target appeared in the meantime (link, copyFile with COPYFILE_EXCL). Never overwrites.
 */
async function placeWithoutClobber(
	dir: string,
	stem: string,
	extension: string,
	place: (target: string) => Promise<void>,
): Promise<string> {
	for (let attempt = 0; attempt < 1000; attempt++) {
		const target = join(dir, attempt === 0 ? `${stem}.${extension}` : `${stem}-${attempt}.${extension}`);
		try {
			await place(target);
			return target;
		} catch (error) {
			if (!isExistsError(error)) throw error;
		}
	}
	throw new Error(`No free file name for ${stem}.${extension}`);
}

export async function saveAsset(
	assetsRoot: string,
	input: { bytes: Uint8Array; name?: string; taskId?: string | null; options: CompressOptions; now?: Date },
): Promise<SavedAsset> {
	if (input.bytes.byteLength > MAX_ASSET_BYTES) throw new AssetError("Image is larger than 25 MB", 413);
	if (input.bytes.byteLength === 0) throw new AssetError("Empty upload", 400);
	const folder = assetFolderForTask(input.taskId);

	let result: Awaited<ReturnType<typeof compressImage>>;
	try {
		result = await compressImage(input.bytes, input.options);
	} catch (error) {
		if (error instanceof UnsupportedImageError) throw new AssetError(error.message, 415);
		if (error instanceof ImageDecodeError) throw new AssetError(error.message, 422);
		throw error;
	}

	const dir = join(assetsRoot, "images", folder);
	await mkdir(dir, { recursive: true });
	const stem = slugifyAssetName(input.name ?? "") || pasteAssetName(input.now);
	const temp = join(dir, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
	try {
		await writeFile(temp, result.bytes, { flag: "wx" });
		const target = await placeWithoutClobber(dir, stem, result.extension, (candidate) => placeFile(temp, candidate));
		return {
			path: toPublicPath(assetsRoot, target),
			originalSize: input.bytes.byteLength,
			finalSize: result.bytes.byteLength,
			compressed: result.compressed,
		};
	} finally {
		await unlink(temp).catch(() => {});
	}
}

export async function listAssets(assetsRoot: string, taskId?: string | null): Promise<AssetEntry[]> {
	const currentFolder = taskId ? assetFolderForTask(taskId) : null;
	const entries: AssetEntry[] = [];

	const walk = async (dir: string): Promise<void> => {
		let items: Dirent[];
		try {
			items = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const item of items) {
			if (item.name.startsWith(".")) continue;
			const fullPath = join(dir, item.name);
			if (item.isDirectory()) {
				await walk(fullPath);
				continue;
			}
			// Symlinks report neither isFile nor isDirectory here, so they are skipped.
			if (!item.isFile() || !IMAGE_EXTENSIONS.has(extname(item.name).slice(1).toLowerCase())) continue;
			let info: Stats;
			try {
				info = await stat(fullPath);
			} catch {
				continue; // removed between readdir and stat
			}
			const parts = relative(assetsRoot, fullPath).split(sep);
			const owner = parts[0] === "images" && parts.length > 2 ? (parts[1] ?? null) : null;
			entries.push({
				path: toPublicPath(assetsRoot, fullPath),
				name: item.name,
				size: info.size,
				mtime: info.mtime.toISOString(),
				taskId: owner && owner !== UNSORTED_FOLDER ? owner : null,
			});
		}
	};

	await walk(assetsRoot);
	const rank = (entry: AssetEntry) => (currentFolder !== null && entry.taskId === currentFolder ? 0 : 1);
	return entries.sort((a, b) => rank(a) - rank(b) || b.mtime.localeCompare(a.mtime) || a.path.localeCompare(b.path));
}

// A link ends at whitespace, a quote, a bracket, or the end of the text. A backslash is never part of one.
const LINK_END = String.raw`(?=[\s)"'<>]|$)`;
const UNSORTED_LINK = new RegExp(String.raw`/assets/images/_unsorted/[^\s)"'<>\\]+${LINK_END}`, "g");
const CLAIMABLE_FIELDS = ["description", "implementationPlan", "implementationNotes", "finalSummary"] as const;

export interface AssetClaimCore {
	filesystem: {
		listTasks(): Promise<Task[]>;
		listDrafts(): Promise<Task[]>;
		listCompletedTasks(): Promise<Task[]>;
		listArchivedTasks(): Promise<Task[]>;
	};
	editTaskOrDraft(taskId: string, input: TaskUpdateInput): Promise<{ task: Task }>;
}

export function findUnsortedAssetLinks(markdown: string): string[] {
	return [...new Set(markdown.match(UNSORTED_LINK) ?? [])];
}

/** Matches `linkPath` only as a whole link, so `a.webp` does not match inside `a.webp.png`. */
function wholeLinkPattern(linkPath: string): RegExp {
	return new RegExp(`${linkPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${LINK_END}`, "g");
}

/**
 * Resolve an _unsorted link to the real path of a regular file inside the real _unsorted folder, or null.
 * Rejects malformed escapes, backslashes, NUL, "." and ".." segments, and symlinks that point elsewhere.
 */
async function resolveUnsortedSource(
	assetsRoot: string,
	realUnsorted: string,
	linkPath: string,
): Promise<string | null> {
	let relPath: string;
	try {
		relPath = decodeURIComponent(linkPath.slice("/assets/".length));
	} catch {
		return null;
	}
	if (relPath.includes("\\") || relPath.includes("\0")) return null;
	const segments = relPath.split("/");
	if (segments.some((segment) => segment === ".." || segment === ".")) return null;
	let realSource: string;
	try {
		realSource = await realpath(join(assetsRoot, ...segments));
		if (!(await stat(realSource)).isFile()) return null;
	} catch {
		return null;
	}
	const inside = relative(realUnsorted, realSource);
	if (!inside || isAbsolute(inside) || inside.startsWith("..")) return null;
	return realSource;
}

/**
 * Move images uploaded before the task had an ID from images/_unsorted/ into images/<task-id>/ and
 * rewrite the links. A file that another task (active, completed, or archived) or draft also links is
 * copied, not moved. Sources are removed only after the task update succeeds; on any failure the
 * placed copies are removed and every source stays, so the original links remain valid.
 */
export async function claimUnsortedAssets(core: AssetClaimCore, assetsRoot: string, task: Task): Promise<Task> {
	const links = new Set(CLAIMABLE_FIELDS.flatMap((field) => findUnsortedAssetLinks(task[field] ?? "")));
	if (links.size === 0) return task;

	let realUnsorted: string;
	try {
		realUnsorted = await realpath(join(assetsRoot, "images", UNSORTED_FOLDER));
	} catch {
		return task;
	}
	const { filesystem } = core;
	const others = (
		await Promise.all([
			filesystem.listTasks(),
			filesystem.listDrafts(),
			filesystem.listCompletedTasks(),
			filesystem.listArchivedTasks(),
		])
	)
		.flat()
		.filter((other) => other.id !== task.id);
	const dir = join(assetsRoot, "images", assetFolderForTask(task.id));
	const replacements = new Map<string, string>();
	const placed: string[] = [];
	const moved: string[] = [];

	let updated: Task;
	try {
		for (const linkPath of links) {
			const source = await resolveUnsortedSource(assetsRoot, realUnsorted, linkPath);
			if (!source) continue;
			const pattern = wholeLinkPattern(linkPath);
			const shared = others.some((other) =>
				CLAIMABLE_FIELDS.some((field) => {
					pattern.lastIndex = 0;
					return pattern.test(other[field] ?? "");
				}),
			);
			await mkdir(dir, { recursive: true });
			const extension = extname(source).slice(1);
			const target = await placeWithoutClobber(dir, basename(source, extname(source)), extension, (candidate) =>
				shared ? copyFile(source, candidate, constants.COPYFILE_EXCL) : placeFile(source, candidate),
			);
			placed.push(target);
			if (!shared) moved.push(source);
			replacements.set(linkPath, toPublicPath(assetsRoot, target));
		}
		if (replacements.size === 0) return task;

		const input: TaskUpdateInput = {};
		for (const field of CLAIMABLE_FIELDS) {
			const current = task[field];
			if (!current) continue;
			let next = current;
			for (const [from, to] of replacements) next = next.replace(wholeLinkPattern(from), () => to);
			if (next !== current) input[field] = next;
		}
		updated = (await core.editTaskOrDraft(task.id, input)).task;
	} catch (error) {
		await Promise.all(placed.map((target) => unlink(target).catch(() => {})));
		throw error;
	}
	// The task now links the new files. A source that cannot be removed is only a stray copy in _unsorted.
	await Promise.all(moved.map((source) => unlink(source).catch(() => {})));
	return updated;
}
