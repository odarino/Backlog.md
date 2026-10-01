import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Core } from "../core/backlog.ts";
import { withWorkflowLock } from "../core/workflow.ts";
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
const getConfig = async () => (await (await request("/api/config")).json()) as Record<string, unknown>;
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

	it("rejects bad requests and leaves the config unchanged", async () => {
		const before = await getConfig();
		expect((await post("/api/statuses/rename", { from: "Nope", to: "X" })).status).toBe(404);
		expect((await post("/api/statuses/rename", { from: "In Progress", to: "done" })).status).toBe(409);
		expect((await post("/api/statuses/rename", { from: "In Progress" })).status).toBe(400);
		expect((await post("/api/statuses/rename", { from: "In Progress", to: 'a"b' })).status).toBe(400);
		expect(await getConfig()).toEqual(before);
	});

	it("rejects bad JSON, non-string fields, and array bodies", async () => {
		const before = await getConfig();
		const raw = (body: string) =>
			request("/api/statuses/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body });
		expect((await raw("{nope")).status).toBe(400);
		expect((await raw("[]")).status).toBe(400);
		expect((await post("/api/statuses/rename", { from: 1, to: "X" })).status).toBe(400);
		expect((await post("/api/statuses/rename", { from: "In Progress", to: ["X"] })).status).toBe(400);
		expect(await getConfig()).toEqual(before);
	});

	it("moves colors and the default status to the new name", async () => {
		expect((await putConfig({ statusColors: { "In Progress": "#112233" }, defaultStatus: "In Progress" })).status).toBe(
			200,
		);
		expect((await post("/api/statuses/rename", { from: "In Progress", to: "Doing" })).status).toBe(200);
		const config = await getConfig();
		expect(config.statusColors).toEqual({ Doing: "#112233" });
		expect(config.defaultStatus).toBe("Doing");
	});

	it("refuses a foreign origin", async () => {
		const before = await getConfig();
		const response = await request("/api/statuses/rename", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
			body: JSON.stringify({ from: "In Progress", to: "Doing" }),
		});
		expect(response.status).toBe(403);
		expect(await getConfig()).toEqual(before);
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
		const before = await getConfig();
		expect((await post("/api/statuses/remove", { status: "To Do" })).status).toBe(400);
		expect((await post("/api/statuses/remove", {})).status).toBe(400);
		expect(await getConfig()).toEqual(before);
	});
});

describe("PUT /api/config status rules", () => {
	it("allows reorder and add", async () => {
		const response = await putConfig({ statuses: ["Done", "New", "To Do", "In Progress"] });
		expect(response.status).toBe(200);
		expect(await getStatuses()).toEqual(["Done", "New", "To Do", "In Progress"]);
	});

	it("rejects a dropped or respelled status", async () => {
		const before = await getConfig();
		const dropped = await putConfig({ statuses: ["To Do", "Done"] });
		expect(dropped.status).toBe(409);
		expect(((await dropped.json()) as { error: string }).error).toBe(
			"Use rename or remove to change existing statuses",
		);
		expect((await putConfig({ statuses: ["To Do", "In progress", "Done"] })).status).toBe(409);
		expect(await getConfig()).toEqual(before);
	});

	it("rejects invalid lists", async () => {
		const before = await getConfig();
		expect((await putConfig({ statuses: ["To Do", "In Progress", "Done", "done"] })).status).toBe(400);
		expect(await getConfig()).toEqual(before);
	});

	it("saves settings for an older list that today's name rules reject", async () => {
		const long = "A status name that is longer than forty chars";
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("Missing config");
		await core.filesystem.saveConfig({ ...config, statuses: ["To Do", long, "Done", "done"] });
		// The server may still hold the old list in its cache, so the body names the list it saw on disk.
		expect((await putConfig({ projectName: "Older", statuses: ["To Do", long, "Done", "done"] })).status).toBe(200);
		expect((await putConfig({ statuses: ["done", "To Do", long, "Done"] })).status).toBe(200);
		expect((await putConfig({ statuses: ["done", "To Do", long, "Done", "DONE"] })).status).toBe(400);
		expect((await putConfig({ statuses: ["done", "To Do", long, "Done", "x".repeat(41)] })).status).toBe(400);
		expect(await getStatuses()).toEqual(["done", "To Do", long, "Done"]);
	});

	it("rejects a default status outside the list", async () => {
		const before = await getConfig();
		expect((await putConfig({ defaultStatus: "Nope" })).status).toBe(400);
		expect(await getConfig()).toEqual(before);
		expect((await putConfig({ defaultStatus: "To Do" })).status).toBe(200);
	});

	it("normalizes status colors", async () => {
		const response = await putConfig({ statusColors: { "to do": "#AABBCC" } });
		expect(response.status).toBe(200);
		const config = (await (await request("/api/config")).json()) as { statusColors?: Record<string, string> };
		expect(config.statusColors).toEqual({ "To Do": "#aabbcc" });
	});

	it("drops colors for unknown statuses, including stale stored ones", async () => {
		const response = await putConfig({ statusColors: { Nope: "#000000", Done: "#10B981" } });
		expect(response.status).toBe(200);
		expect((await getConfig()).statusColors).toEqual({ Done: "#10b981" });
		// A color left behind in the file for a status that no longer exists.
		const path = core.filesystem.configFilePath;
		const text = (await Bun.file(path).text()).replace(
			/^status_colors:.*$/m,
			'status_colors: {"Gone":"#123456","Done":"#10b981"}',
		);
		await Bun.write(path, text);
		// The PUT reads the file again under the workflow lock and carries the stored colors over.
		const { statusColors: _colors, ...rest } = await getConfig();
		const saved = await request("/api/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...rest, projectName: "Again" }),
		});
		expect(saved.status).toBe(200);
		expect((await getConfig()).statusColors).toEqual({ Done: "#10b981" });
	});

	it("rejects malformed or duplicate status colors", async () => {
		const before = await getConfig();
		for (const statusColors of [null, [], "red"]) {
			const response = await putConfig({ statusColors });
			expect(response.status).toBe(400);
			expect(((await response.json()) as { error: string }).error).toBe("statusColors must be an object");
		}
		const dup = await putConfig({ statusColors: { "to do": "#111111", "To Do": "#222222" } });
		expect(dup.status).toBe(400);
		expect(((await dup.json()) as { error: string }).error).toBe("Duplicate color for To Do");
		expect(await getConfig()).toEqual(before);
	});

	it("keeps stored colors and default status when the body omits them", async () => {
		expect((await putConfig({ statusColors: { Done: "#00ff00" }, defaultStatus: "To Do" })).status).toBe(200);
		const { statusColors: _c, defaultStatus: _d, ...rest } = await getConfig();
		const response = await request("/api/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...rest, projectName: "Again" }),
		});
		expect(response.status).toBe(200);
		const config = await getConfig();
		expect(config.statusColors).toEqual({ Done: "#00ff00" });
		expect(config.defaultStatus).toBe("To Do");
	});

	it("waits for the workflow lock and rechecks the config it finds", async () => {
		const oldList = ["To Do", "In Progress", "Done"];
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const holder = withWorkflowLock(async () => {
			await gate;
			// A change from another Core instance, as another process would make it.
			const other = new Core(testDir);
			const config = await other.filesystem.loadConfig();
			if (!config) throw new Error("Missing config");
			await other.filesystem.saveConfig({ ...config, statuses: ["To Do", "Doing", "Done"] });
		});
		let settled = false;
		const pending = putConfig({ statuses: oldList }).then((response) => {
			settled = true;
			return response;
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(settled).toBe(false);
		} finally {
			// Always free the shared workflow queue, even when an assertion fails.
			release();
			await withTimeout(holder, "workflow lock holder", 2000);
		}
		expect((await pending).status).toBe(409);
		expect(await getStatuses()).toEqual(["To Do", "Doing", "Done"]);
	});

	it("stays consistent when a rename and a stale PUT overlap", async () => {
		const [renamed, put] = await Promise.all([
			post("/api/statuses/rename", { from: "In Progress", to: "Doing" }),
			putConfig({ statuses: ["To Do", "In Progress", "Done", "New"] }),
		]);
		expect(renamed.status).toBe(200);
		expect([200, 409]).toContain(put.status);
		const statuses = await getStatuses();
		for (const id of ids) {
			const task = (await (await request(`/api/tasks/${id}`)).json()) as { status: string };
			expect(statuses).toContain(task.status);
		}
	});

	it("keeps a color saved next to concurrent reads when a later rename runs", async () => {
		for (let round = 0; round < 4; round++) {
			const current = await getConfig();
			const statuses = current.statuses as string[];
			await Promise.all([
				getStatuses(),
				getConfig(),
				request("/api/config", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ...current, statusColors: { Done: `#10b98${round}` } }),
				}),
				getConfig(),
				getStatuses(),
			]);
			const from = statuses[1] as string;
			expect((await post("/api/statuses/rename", { from, to: `Doing ${round}` })).status).toBe(200);
			const text = await Bun.file(core.filesystem.configFilePath).text();
			expect(text).toContain(`status_colors: {"Done":"#10b98${round}"}`);
		}
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
	it("publishes nothing after a failed rename", async () => {
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
		expect((await post("/api/statuses/rename", { from: "Nope", to: "X" })).status).toBe(404);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(messages.filter((m) => m === "tasks-updated" || m === "config-updated")).toEqual([]);
	});

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
