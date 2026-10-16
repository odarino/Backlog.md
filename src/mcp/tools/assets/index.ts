import { addAssetFromFile } from "../../../core/asset-add.ts";
import type { BacklogConfig } from "../../../types/index.ts";
import type { McpServer } from "../../server.ts";
import type { McpToolHandler } from "../../types.ts";
import { createSimpleValidatedTool } from "../../validation/tool-wrapper.ts";
import { assetAddSchema } from "./schemas.ts";

export function registerAssetTools(server: McpServer, _config: BacklogConfig): void {
	const addAssetTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "asset_add",
			description:
				"Add an image file as a Backlog.md asset. Converts to WebP unless original is true. Returns the saved path, sizes, and a markdown image snippet to put in a task.",
			inputSchema: assetAddSchema,
			annotations: { title: "Add Asset", destructiveHint: false },
		},
		assetAddSchema,
		async (input) => {
			const args = input as { path: string; taskId?: string; original?: boolean };
			const saved = await addAssetFromFile(server, args);
			return {
				content: [
					{
						type: "text",
						text: `Saved: ${saved.path}\nSize: ${saved.originalSize} -> ${saved.finalSize} bytes\n${saved.markdown}`,
					},
				],
			};
		},
	);
	server.addTool(addAssetTool);
}
