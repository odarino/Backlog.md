import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { McpServer } from "../mcp/server.ts";
import { registerTaskTools } from "../mcp/tools/tasks/index.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const getText = (content: unknown[] | undefined, index = 0): string => {
	const item = content?.[index] as { text?: string } | undefined;
	return item?.text ?? "";
};

let TEST_DIR: string;
let mcpServer: McpServer;

describe("MCP task_clone", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("mcp-task-clone");
		mcpServer = new McpServer(TEST_DIR, "Test instructions");
		await mcpServer.filesystem.ensureBacklogStructure();
		await initializeFilesystemTestProject(mcpServer, "Clone Project");
		const config = await mcpServer.filesystem.loadConfig();
		if (!config) throw new Error("Failed to load backlog configuration for tests");
		registerTaskTools(mcpServer, config);
		await mcpServer.testInterface.callTool({
			params: { name: "task_create", arguments: { title: "Source", description: "Body" } },
		});
	});

	afterEach(async () => {
		await Promise.allSettled([mcpServer.stop()]);
		await Promise.allSettled([safeCleanup(TEST_DIR)]);
	});

	it("clones a task", async () => {
		const result = await mcpServer.testInterface.callTool({
			params: { name: "task_clone", arguments: { id: "TASK-1" } },
		});
		expect(result.isError).not.toBe(true);
		const text = (result.content ?? []).map((entry) => ("text" in entry ? entry.text : "")).join("\n");
		expect(text).toContain("Cloned TASK-1 to TASK-2.");
		expect(text).toContain("Task TASK-2 - Copy of Source");
	});

	it("resolves a bare ID to the task even when a draft shares the number", async () => {
		await mcpServer.testInterface.callTool({
			params: { name: "task_create", arguments: { title: "Drafty", status: "Draft" } },
		});
		const result = await mcpServer.testInterface.callTool({
			params: { name: "task_clone", arguments: { id: "1" } },
		});
		expect(result.isError).not.toBe(true);
		expect(getText(result.content)).toContain("Cloned 1 to TASK-2.");
	});

	it("refuses a task that exists only on another branch", async () => {
		const real = await mcpServer.getTask("TASK-1");
		if (!real) throw new Error("missing source");
		mcpServer.getTask = async () => ({ ...real, source: "local-branch", branch: "feature/x" });
		const result = await mcpServer.testInterface.callTool({
			params: { name: "task_clone", arguments: { id: "TASK-1" } },
		});
		expect(result.isError).toBe(true);
		expect(getText(result.content)).toContain("it exists only on branch feature/x. Check out that branch first.");
	});

	it("applies a title override", async () => {
		const result = await mcpServer.testInterface.callTool({
			params: { name: "task_clone", arguments: { id: "TASK-1", title: "Custom" } },
		});
		const text = (result.content ?? []).map((entry) => ("text" in entry ? entry.text : "")).join("\n");
		expect(text).toContain("Task TASK-2 - Custom");
	});

	it("returns an error result for an unknown ID", async () => {
		const result = await mcpServer.testInterface.callTool({
			params: { name: "task_clone", arguments: { id: "TASK-99" } },
		});
		expect(result.isError).toBe(true);
		expect(getText(result.content)).toContain("Task not found: TASK-99");
	});
});
