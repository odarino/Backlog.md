import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { connect } from "node:net";
import { FileSystem } from "../file-system/operations.ts";
import { BacklogServer } from "../server/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let server: BacklogServer | null = null;
let serverPort = 0;

const call = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${serverPort}${path}`, init);
const evil = { Origin: "https://evil.example", "Content-Type": "application/json" };

beforeEach(async () => {
	TEST_DIR = createUniqueTestDir("server-request-guard-http");
	const filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Guard",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		autoCommit: false,
	});
	server = new BacklogServer(TEST_DIR);
	await server.start(0, false);
	serverPort = server.getPort() ?? 0;
	await retry(async () => {
		expect((await call("/api/tasks")).status).toBe(200);
	});
});

afterEach(async () => {
	if (server) {
		await server.stop();
		server = null;
	}
	await safeCleanup(TEST_DIR);
});

describe("web server request guard", () => {
	it("rejects a cross-origin task create and creates nothing", async () => {
		const res = await call("/api/tasks", { method: "POST", headers: evil, body: JSON.stringify({ title: "Evil" }) });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "Origin not allowed" });
		expect(await (await call("/api/tasks")).json()).toEqual([]);
	});

	it("rejects a cross-origin asset upload", async () => {
		const res = await call("/api/assets?taskId=TASK-1&name=a.png", {
			method: "POST",
			headers: { Origin: "https://evil.example", "Content-Type": "image/png" },
			body: new Uint8Array([1, 2, 3]),
		});
		expect(res.status).toBe(403);
	});

	it("rejects a cross-origin config update", async () => {
		const res = await call("/api/config", { method: "PUT", headers: evil, body: "{}" });
		expect(res.status).toBe(403);
	});

	it("accepts a same-host Origin", async () => {
		const res = await call("/api/tasks", {
			method: "POST",
			headers: { Origin: `http://127.0.0.1:${serverPort}`, "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Good" }),
		});
		expect(res.status).toBe(201);
	});

	it("rejects an unknown Host with 421", async () => {
		// Bun's fetch overrides the Host header, so send a raw HTTP request over a socket.
		const raw = await new Promise<string>((resolve, reject) => {
			let data = "";
			const socket = connect(serverPort, "127.0.0.1", () => {
				socket.write("GET /api/tasks HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n");
			});
			socket.on("data", (chunk) => {
				data += chunk.toString();
			});
			socket.on("end", () => resolve(data));
			socket.on("error", reject);
		});
		expect(Number(raw.split(" ")[1])).toBe(421);
		expect(JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4))).toEqual({ error: "Host not allowed" });
	});

	it("still serves the SPA and assets for a good Host", async () => {
		expect((await call("/")).status).toBe(200);
		expect((await call("/assets/missing.png")).status).toBe(404);
	});
});
