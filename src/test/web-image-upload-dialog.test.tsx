import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AssetPreview } from "../types/index.ts";
import ImageUploadDialog from "../web/components/ImageUploadDialog";
import { apiClient } from "../web/lib/api";

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;
const originalPreview = apiClient.previewAsset.bind(apiClient);
const originalUpload = apiClient.uploadAsset.bind(apiClient);

const preview = (overrides: Partial<AssetPreview> = {}): AssetPreview => ({
	dataUrl: "data:image/webp;base64,AA==",
	mime: "image/webp",
	originalSize: 2_400_000,
	finalSize: 310_000,
	compressed: true,
	...overrides,
});

const png = () => new File(["x"], "shot.png", { type: "image/png" });

beforeEach(() => {
	activeDom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = activeDom.window as unknown as Window & typeof globalThis;
	globalThis.document = activeDom.window.document as Document;
	globalThis.navigator = activeDom.window.navigator as Navigator;
});

afterEach(() => {
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
	activeDom?.window.close();
	activeDom = null;
	apiClient.previewAsset = originalPreview;
	apiClient.uploadAsset = originalUpload;
});

const renderDialog = async (onConfirm: (mode: string) => void, onCancel: () => void = () => {}) => {
	activeRoot = createRoot(document.getElementById("root") as HTMLElement);
	await act(async () => {
		activeRoot?.render(<ImageUploadDialog files={[png()]} onConfirm={onConfirm} onCancel={onCancel} />);
	});
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});
};

const button = (name: string) =>
	Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLButtonElement;

const click = async (element: HTMLElement) => {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	});
};

describe("ImageUploadDialog", () => {
	it("shows sizes from the preview and confirms Convert by default", async () => {
		apiClient.previewAsset = async () => preview();
		const onConfirm = mock();
		await renderDialog(onConfirm);
		expect(document.body.textContent).toMatch(/2\.3 MB → 303 KB/);
		await click(button("Insert"));
		expect(onConfirm).toHaveBeenCalledWith("convert");
	});

	it("confirms Original after toggling", async () => {
		apiClient.previewAsset = async () => preview();
		const onConfirm = mock();
		await renderDialog(onConfirm);
		await click(button("Original"));
		expect(button("Original").getAttribute("aria-pressed")).toBe("true");
		await click(button("Insert"));
		expect(onConfirm).toHaveBeenCalledWith("original");
	});

	it("falls back to Original when preview fails", async () => {
		apiClient.previewAsset = async () => {
			throw new Error("Unsupported image type");
		};
		const onConfirm = mock();
		await renderDialog(onConfirm);
		expect(button("Convert").disabled).toBe(true);
		expect(document.body.textContent).toContain("Unsupported image type");
		await click(button("Insert"));
		expect(onConfirm).toHaveBeenCalledWith("original");
	});

	it("falls back to Original when the image cannot be converted", async () => {
		apiClient.previewAsset = async () => preview({ mime: "image/gif", originalSize: 100, finalSize: 100, compressed: false });
		const onConfirm = mock();
		await renderDialog(onConfirm);
		expect(button("Convert").disabled).toBe(true);
		expect(button("Original").getAttribute("aria-pressed")).toBe("true");
		expect(document.body.textContent).toContain("This image cannot be converted");
		await click(button("Insert"));
		expect(onConfirm).toHaveBeenCalledWith("original");
	});

	it("Cancel calls onCancel and never uploads", async () => {
		apiClient.previewAsset = async () => preview();
		const upload = mock();
		apiClient.uploadAsset = upload as unknown as typeof apiClient.uploadAsset;
		const onCancel = mock();
		await renderDialog(() => {}, onCancel);
		await click(button("Cancel"));
		expect(onCancel).toHaveBeenCalled();
		expect(upload).not.toHaveBeenCalled();
	});
});
