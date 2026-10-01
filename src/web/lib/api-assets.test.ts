import { afterEach, describe, expect, it } from "bun:test";
import type { AssetEntry, SavedAsset } from "../../types";
import { apiClient } from "./api";

describe("apiClient asset methods", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("test (a): preserves server error message on 413 response", async () => {
		const stubResponse = {
			ok: false,
			status: 413,
			statusText: "Payload Too Large",
			json: async () => ({ error: "Image is larger than 25 MB" }),
		} as Response;

		globalThis.fetch = (async () => stubResponse) as unknown as typeof fetch;

		try {
			await apiClient.uploadAsset(new Blob(["test"], { type: "image/png" }), "file.png");
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			expect((error as Error).message).toBe("Image is larger than 25 MB");
		}
	});

	it("test (b): uploads file with correct method, headers, and params", async () => {
		interface CapturedRequest {
			url: string;
			method: string;
			headers: Record<string, string>;
			body: Blob;
		}

		let capturedRequest: CapturedRequest | null = null;

		const stubResponse = {
			ok: true,
			status: 200,
			json: async () =>
				({
					path: "/assets/images/task-1/file.png",
					originalSize: 1024,
					finalSize: 512,
					compressed: true,
				}) as SavedAsset,
		} as Response;

		globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
			const headersObj: Record<string, string> = {};
			if (init?.headers) {
				const headers = init.headers as Record<string, string>;
				for (const [k, v] of Object.entries(headers)) {
					headersObj[k] = String(v);
				}
			}
			capturedRequest = {
				url: String(url),
				method: String(init?.method ?? "GET"),
				headers: headersObj,
				body: init?.body as Blob,
			};
			return stubResponse;
		}) as unknown as typeof fetch;

		const file = new Blob(["test content"], { type: "image/jpeg" });
		const result = await apiClient.uploadAsset(file, "photo.jpg", "TASK-1");

		expect(result.path).toBe("/assets/images/task-1/file.png");
		expect(capturedRequest).not.toBeNull();
		const req = capturedRequest as unknown as CapturedRequest;
		expect(req.method).toBe("POST");
		expect(req.headers["Content-Type"]).toBe("image/jpeg");
		expect(req.url).toContain("name=photo.jpg");
		expect(req.url).toContain("taskId=TASK-1");
	});

	it("test (c): listAssets requests correct URL with taskId", async () => {
		let capturedUrl = "";

		const stubResponse = {
			ok: true,
			status: 200,
			json: async () => [] as AssetEntry[],
		} as Response;

		globalThis.fetch = (async (url: string | URL) => {
			capturedUrl = String(url);
			return stubResponse;
		}) as unknown as typeof fetch;

		await apiClient.listAssets("TASK-1");

		expect(capturedUrl).toContain("/api/assets");
		expect(capturedUrl).toContain("taskId=TASK-1");
	});
});
