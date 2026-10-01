import { afterEach, describe, expect, it } from "bun:test";
import type { BacklogConfig } from "../../types";
import { apiClient } from "./api";

describe("apiClient workflow methods", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const failWith = (status: number, error: string) => {
		globalThis.fetch = (async () =>
			({
				ok: false,
				status,
				statusText: "Error",
				json: async () => ({ error }),
			}) as Response) as unknown as typeof fetch;
	};

	it("renameStatus rejects with the server error text", async () => {
		failWith(409, "Status already exists: Done");
		await expect(apiClient.renameStatus("Review", "Done")).rejects.toThrow("Status already exists: Done");
	});

	it("removeStatus rejects with the server error text", async () => {
		failWith(400, "A workflow needs at least 2 statuses");
		await expect(apiClient.removeStatus("Review")).rejects.toThrow("A workflow needs at least 2 statuses");
	});

	it("updateConfig rejects with the server error text", async () => {
		failWith(409, "Cannot drop status: Review");
		await expect(apiClient.updateConfig({} as BacklogConfig)).rejects.toThrow("Cannot drop status: Review");
	});

	it("fetchStatusUsage rejects with the server error text", async () => {
		failWith(500, "Usage failed");
		await expect(apiClient.fetchStatusUsage()).rejects.toThrow("Usage failed");
	});

	it("sends the rename and remove bodies as JSON posts", async () => {
		const requests: Array<{ url: string; body: string }> = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			requests.push({ url, body: String(init?.body) });
			return { ok: true, status: 200, json: async () => ({ config: {}, changedTasks: 0 }) } as Response;
		}) as unknown as typeof fetch;
		await apiClient.renameStatus("A", "B");
		await apiClient.removeStatus("A", "C");
		expect(requests).toEqual([
			{ url: "/api/statuses/rename", body: JSON.stringify({ from: "A", to: "B" }) },
			{ url: "/api/statuses/remove", body: JSON.stringify({ status: "A", moveTo: "C" }) },
		]);
	});
});
