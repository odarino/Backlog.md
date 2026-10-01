import { link, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { AssetEntry, SavedAsset } from "../types/index.ts";
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
	return base
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/gi, "d")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

export function pasteAssetName(now: Date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `paste-${date}-${time}`;
}

export function toPublicPath(assetsRoot: string, filePath: string): string {
	return `/assets/${relative(assetsRoot, filePath).split(sep).map(encodeURIComponent).join("/")}`;
}

function isExistsError(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

/**
 * Pick the first free `stem.ext`, `stem-1.ext`, … and hand it to `place`, which must fail with EEXIST
 * when the target appeared in the meantime (link, copyFile with COPYFILE_EXCL). Never overwrites.
 */
export async function placeWithoutClobber(
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
	await writeFile(temp, result.bytes, { flag: "wx" });
	try {
		const target = await placeWithoutClobber(dir, stem, result.extension, (candidate) => link(temp, candidate));
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
		let items: import("node:fs").Dirent[];
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
			const info = await stat(fullPath);
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
