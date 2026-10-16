import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { SavedAsset } from "../types/index.ts";
import { saveAsset } from "./assets.ts";
import type { Core } from "./backlog.ts";
import { compressOptionsFromConfig } from "./image-compress.ts";

export function assetsRootFor(core: Core): string {
	return join(dirname(core.filesystem.docsDir), "assets");
}

export async function addAssetFromFile(
	core: Core,
	input: { path: string; taskId?: string; original?: boolean },
): Promise<SavedAsset & { markdown: string }> {
	const file = resolve(input.path);
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await readFile(file));
	} catch {
		throw new Error(`File not found: ${input.path}`);
	}
	const config = await core.filesystem.loadConfig();
	const name = basename(file, extname(file));
	const saved = await saveAsset(assetsRootFor(core), {
		bytes,
		name,
		taskId: input.taskId ?? null,
		options: compressOptionsFromConfig(config),
		mode: input.original ? "original" : "convert",
	});
	return { ...saved, markdown: `![${name}](${saved.path})` };
}
