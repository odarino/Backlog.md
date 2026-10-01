import { describe, expect, it } from "bun:test";
import { checkRequest } from "../server/request-guard.ts";

const PORT = 6420;

function makeRequest(method: string, headers: Record<string, string>): Request {
	// Bun may override Host on real Request objects, so use a plain object with the shape the guard reads.
	return { method, headers: new Headers(headers), url: `http://127.0.0.1:${PORT}/api/tasks` } as unknown as Request;
}

const goodHost = { host: `127.0.0.1:${PORT}` };

describe("checkRequest", () => {
	it("allows loopback and localhost hosts, case-insensitive", () => {
		expect(checkRequest(makeRequest("GET", { host: "127.0.0.1:6420" }), PORT)).toBeNull();
		expect(checkRequest(makeRequest("GET", { host: "LOCALHOST:6420" }), PORT)).toBeNull();
	});

	it("rejects bad, wrong-port, and missing hosts with 421", async () => {
		for (const headers of [{ host: "evil.example:6420" }, { host: "127.0.0.1:9999" }, {}] as Record<string, string>[]) {
			const res = checkRequest(makeRequest("GET", headers), PORT);
			expect(res?.status).toBe(421);
			expect(await res?.json()).toEqual({ error: "Host not allowed" });
		}
	});

	it("checks Origin on writes", async () => {
		const post = (origin?: string) =>
			checkRequest(makeRequest("POST", origin === undefined ? goodHost : { ...goodHost, origin }), PORT);
		expect(post("http://127.0.0.1:6420")).toBeNull();
		expect(post("http://localhost:6420")).toBeNull();
		expect(post()).toBeNull();
		for (const origin of [
			"https://evil.example",
			"null",
			"http://127.0.0.1:9999",
			"https://127.0.0.1:6420",
			"not a url",
		]) {
			const res = post(origin);
			expect(res?.status).toBe(403);
			expect(await res?.json()).toEqual({ error: "Origin not allowed" });
		}
	});

	it("does not check Origin on GET, HEAD, OPTIONS", () => {
		for (const method of ["GET", "HEAD", "OPTIONS"]) {
			expect(checkRequest(makeRequest(method, { ...goodHost, origin: "https://evil.example" }), PORT)).toBeNull();
		}
	});

	it("fails closed when the port is unknown", () => {
		expect(checkRequest(makeRequest("GET", goodHost), null)?.status).toBe(421);
	});

	it("accepts bare hosts only on port 80", () => {
		expect(checkRequest(makeRequest("GET", { host: "127.0.0.1" }), 80)).toBeNull();
		expect(checkRequest(makeRequest("GET", { host: "localhost" }), 80)).toBeNull();
		expect(checkRequest(makeRequest("POST", { host: "localhost", origin: "http://127.0.0.1" }), 80)).toBeNull();
		expect(checkRequest(makeRequest("POST", { host: "localhost", origin: "https://evil.example" }), 80)?.status).toBe(
			403,
		);
		expect(checkRequest(makeRequest("GET", { host: "127.0.0.1" }), PORT)?.status).toBe(421);
		expect(checkRequest(makeRequest("POST", { ...goodHost, origin: "http://127.0.0.1" }), PORT)?.status).toBe(403);
	});

	it("rejects a trailing-dot host", () => {
		expect(checkRequest(makeRequest("GET", { host: "localhost.:6420" }), PORT)?.status).toBe(421);
	});

	it("checks Origin on WebSocket upgrades", () => {
		const ws = (origin: string) =>
			checkRequest(makeRequest("GET", { ...goodHost, upgrade: "websocket", origin }), PORT);
		expect(ws("https://evil.example")?.status).toBe(403);
		expect(ws("http://localhost:6420")).toBeNull();
	});
});
