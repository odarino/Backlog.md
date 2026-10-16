import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "../mcp/server.ts";
import { registerAssetTools } from "../mcp/tools/assets/index.ts";
import { pngFixture } from "./image-fixtures.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let mcpServer: McpServer;

describe("MCP asset tools", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("mcp-assets");
		mcpServer = new McpServer(TEST_DIR, "Test instructions");
		await mcpServer.filesystem.ensureBacklogStructure();
		await initializeFilesystemTestProject(mcpServer, "Asset Project");
		const config = await mcpServer.filesystem.loadConfig();
		if (!config) throw new Error("config missing");
		registerAssetTools(mcpServer, config);
	});

	afterEach(async () => {
		await Promise.allSettled([mcpServer.stop()]);
		await safeCleanup(TEST_DIR);
	});

	it("adds an asset and returns path and markdown", async () => {
		const pngPath = join(TEST_DIR, "shot.png");
		await writeFile(pngPath, await pngFixture(300, 150));
		const result = await mcpServer.testInterface.callTool({
			params: { name: "asset_add", arguments: { path: pngPath, original: true } },
		});
		const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
		expect(text).toContain("Saved: /assets/images/");
		expect(text).toContain("![shot](/assets/images/");
	});
});
