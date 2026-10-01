import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Core } from "../core/backlog.ts";
import { BacklogServer } from "../server/index.ts";
import { createUniqueTestDir, retry, safeCleanup, withTimeout } from "./test-utils.ts";

let testDir: string;
let server: BacklogServer | null = null;
let serverPort = 0;
let socket: WebSocket | null = null;
let core: Core;
let ids: string[] = [];

const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${serverPort}${path}`, init);
const post = (path: string, body: unknown) =>
	request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const putConfig = async (patch: Record<string, unknown>) => {
	const current = (await (await request("/api/config")).json()) as Record<string, unknown>;
	return request("/api/config", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...current, ...patch }),
	});
};
const getStatuses = async () => (await (await request("/api/statuses")).json()) as string[];

beforeEach(async () => {
	testDir = createUniqueTestDir("server-workflow");
	core = new Core(testDir);
	await core.filesystem.ensureBacklogStructure();
	await core.filesystem.saveConfig({
		projectName: "Workflow",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		checkActiveBranches: false,
		autoCommit: false,
	});
	ids = [];
	for (const [title, status] of [
		["One", "To Do"],
		["Two", "To Do"],
		["Three", "Done"],
		["Four", "In Progress"],
	] as const) {
		const { task } = await core.createTaskFromInput({ title, status }, false);
		ids.push(task.id);
	}

	server = new BacklogServer(testDir);
	await server.start(0, false);
	serverPort = server.getPort() ?? 0;
	await retry(async () => {
		if (!(await request("/api/statuses")).ok) throw new Error("Server is not ready");
	});
});

afterEach(async () => {
	socket?.close();
	socket = null;
	await server?.stop();
	server = null;
	await safeCleanup(testDir);
});

describe("status usage", () => {
	it("counts tasks per status", async () => {
		const response = await request("/api/statuses/usage");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ "To Do": 2, "In Progress": 1, Done: 1 });
	});
});

describe("status rename", () => {
	it("renames a status and its tasks", async () => {
		const response = await post("/api/statuses/rename", { from: "In Progress", to: "Doing" });
		expect(response.status).toBe(200);
		const body = (await response.json()) as { config: { statuses: string[] }; changedTasks: number };
		expect(body.changedTasks).toBe(1);
		expect(body.config.statuses).toEqual(["To Do", "Doing", "Done"]);
		expect(await getStatuses()).toEqual(["To Do", "Doing", "Done"]);
		const task = (await (await request(`/api/tasks/${ids[3]}`)).json()) as { status: string };
		expect(task.status).toBe("Doing");
	});

	it("rejects bad requests", async () => {
		expect((await post("/api/statuses/rename", { from: "Nope", to: "X" })).status).toBe(404);
		expect((await post("/api/statuses/rename", { from: "In Progress", to: "done" })).status).toBe(409);
		expect((await post("/api/statuses/rename", { from: "In Progress" })).status).toBe(400);
		expect((await post("/api/statuses/rename", { from: "In Progress", to: 'a"b' })).status).toBe(400);
		expect(await getStatuses()).toEqual(["To Do", "In Progress", "Done"]);
	});
});

describe("status remove", () => {
	it("moves tasks and removes the status", async () => {
		const response = await post("/api/statuses/remove", { status: "To Do", moveTo: "Done" });
		expect(response.status).toBe(200);
		expect(await getStatuses()).toEqual(["In Progress", "Done"]);
		for (const id of ids.slice(0, 2)) {
			const task = (await (await request(`/api/tasks/${id}`)).json()) as { status: string };
			expect(task.status).toBe("Done");
		}
	});

	it("needs moveTo while tasks use the status", async () => {
		expect((await post("/api/statuses/remove", { status: "To Do" })).status).toBe(400);
		expect((await post("/api/statuses/remove", {})).status).toBe(400);
		expect(await getStatuses()).toEqual(["To Do", "In Progress", "Done"]);
	});
});

describe("PUT /api/config status rules", () => {
	it("allows reorder and add", async () => {
		const response = await putConfig({ statuses: ["Done", "New", "To Do", "In Progress"] });
		expect(response.status).toBe(200);
		expect(await getStatuses()).toEqual(["Done", "New", "To Do", "In Progress"]);
	});

	it("rejects a dropped or respelled status", async () => {
		const dropped = await putConfig({ statuses: ["To Do", "Done"] });
		expect(dropped.status).toBe(409);
		expect(((await dropped.json()) as { error: string }).error).toBe(
			"Use rename or remove to change existing statuses",
		);
		expect((await putConfig({ statuses: ["To Do", "In progress", "Done"] })).status).toBe(409);
		expect(await getStatuses()).toEqual(["To Do", "In Progress", "Done"]);
	});

	it("rejects invalid lists", async () => {
		expect((await putConfig({ statuses: ["To Do", "In Progress", "Done", "done"] })).status).toBe(400);
	});

	it("rejects a default status outside the list", async () => {
		expect((await putConfig({ defaultStatus: "Nope" })).status).toBe(400);
		expect((await putConfig({ defaultStatus: "To Do" })).status).toBe(200);
	});

	it("normalizes status colors", async () => {
		const response = await putConfig({ statusColors: { "to do": "#AABBCC" } });
		expect(response.status).toBe(200);
		const config = (await (await request("/api/config")).json()) as { statusColors?: Record<string, string> };
		expect(config.statusColors).toEqual({ "To Do": "#aabbcc" });
		expect((await putConfig({ statusColors: { Nope: "#000000" } })).status).toBe(400);
	});

	it("still saves a body without statuses", async () => {
		const { statuses: _statuses, ...rest } = (await (await request("/api/config")).json()) as Record<string, unknown>;
		const response = await request("/api/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...rest, projectName: "Renamed" }),
		});
		expect(response.status).toBe(200);
		expect(await getStatuses()).toEqual(["To Do", "In Progress", "Done"]);
	});
});

describe("workflow broadcasts", () => {
	it("publishes tasks and config updates after a rename", async () => {
		const messages: string[] = [];
		socket = new WebSocket(`ws://127.0.0.1:${serverPort}`);
		await withTimeout(
			new Promise<void>((resolve, reject) => {
				if (!socket) return reject(new Error("WebSocket was not created"));
				socket.onopen = () => resolve();
				socket.onerror = () => reject(new Error("WebSocket failed to open"));
			}),
			"workflow test WebSocket",
			2000,
		);
		socket.onmessage = (event) => messages.push(String(event.data));

		expect((await post("/api/statuses/rename", { from: "In Progress", to: "Doing" })).status).toBe(200);
		await retry(async () => {
			if (!messages.includes("tasks-updated") || !messages.includes("config-updated")) {
				throw new Error("Rename was not published");
			}
		});
	});
});
