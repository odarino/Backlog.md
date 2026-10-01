import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import decodeWebp from "@jsquash/webp/decode";
import { FileSystem } from "../file-system/operations.ts";
import { BacklogServer } from "../server/index.ts";
import type { BacklogConfig } from "../types/index.ts";
import { jpegFixture } from "./image-fixtures.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let server: BacklogServer | null = null;
let serverPort = 0;
let filesystem: FileSystem;

const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${serverPort}${path}`, init);
const upload = (query: string, body: Uint8Array, type = "image/jpeg") =>
	request(`/api/assets?${query}`, { method: "POST", headers: { "Content-Type": type }, body: new Uint8Array(body) });

beforeEach(async () => {
	TEST_DIR = createUniqueTestDir("server-assets-upload");
	filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Assets",
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
		expect((await request("/api/assets")).status).toBe(200);
	});
});

afterEach(async () => {
	if (server) {
		await server.stop();
		server = null;
	}
	await safeCleanup(TEST_DIR);
});

describe("asset upload API", () => {
	it("lists nothing at first", async () => {
		expect(await (await request("/api/assets")).json()).toEqual([]);
	});

	it("compresses an upload, serves it, and lists it", async () => {
		const bytes = await jpegFixture(2400, 1600);
		const response = await upload("taskId=TASK-3&name=Screen%20Shot.jpg", bytes);
		expect(response.status).toBe(200);
		const saved = await response.json();
		expect(saved).toMatchObject({ path: "/assets/images/task-3/screen-shot.webp", compressed: true });

		const served = await request(saved.path);
		expect(served.status).toBe(200);
		expect(served.headers.get("content-type")).toBe("image/webp");

		const listed = await (await request("/api/assets?taskId=TASK-3")).json();
		expect(listed.map((entry: { path: string }) => entry.path)).toEqual([saved.path]);
	});

	it("uses the configured quality and size limits", async () => {
		// Save through the API: the server's FileSystem caches config, so a second instance would not be seen.
		const config = await (await request("/api/config")).json();
		const saveConfig = await request("/api/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...config, imageMaxDimension: 300, imageQuality: 0.5 }),
		});
		expect(saveConfig.status).toBe(200);
		const saved = await (await upload("taskId=TASK-3&name=a.jpg", await jpegFixture(1200, 800))).json();
		const webp = await (await request(saved.path)).arrayBuffer();
		// The server runs in this process, so the WebP decoder is already initialized by the upload.
		const image = await decodeWebp(webp);
		expect([image.width, image.height]).toEqual([300, 200]);
	});

	it("rejects bad input with the right status", async () => {
		expect((await upload("taskId=TASK-3", new TextEncoder().encode("hello"), "text/plain")).status).toBe(415);
		expect((await upload("taskId=TASK-3", new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2]))).status).toBe(422);
		expect((await upload("taskId=..%2Fx", await jpegFixture(64, 64))).status).toBe(400);
		expect((await request("/api/assets?taskId=a%2Fb")).status).toBe(400);
		const tooBig = await upload("taskId=TASK-3", new Uint8Array(25 * 1024 * 1024 + 1));
		expect(tooBig.status).toBe(413);
		expect(await tooBig.json()).toEqual({ error: "Image is larger than 25 MB" });
	});

	it("serves SVG files sandboxed", async () => {
		const assetsRoot = join(dirname(filesystem.docsDir), "assets");
		await mkdir(join(assetsRoot, "images"), { recursive: true });
		await writeFile(join(assetsRoot, "images", "x.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
		const response = await request("/assets/images/x.svg");
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

describe("image config keys", () => {
	it("round-trip through config.yml", async () => {
		const config = await filesystem.loadConfig();
		expect(config).not.toBeNull();
		await filesystem.saveConfig({ ...(config as BacklogConfig), imageMaxDimension: 2560, imageQuality: 0.65 });
		const reloaded = await new FileSystem(TEST_DIR).loadConfig();
		expect(reloaded?.imageMaxDimension).toBe(2560);
		expect(reloaded?.imageQuality).toBe(0.65);
	});

	it("are validated by the config API", async () => {
		const config = await (await request("/api/config")).json();
		const put = (body: unknown) =>
			request("/api/config", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		expect((await put({ ...config, imageMaxDimension: 100 })).status).toBe(400);
		expect((await put({ ...config, imageQuality: 1.5 })).status).toBe(400);
		expect((await put({ ...config, imageMaxDimension: 1024, imageQuality: 0.7 })).status).toBe(200);
	});
});
