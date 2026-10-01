import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

const setupDom = () => {
	activeDom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost",
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = activeDom.window as unknown as Window & typeof globalThis;
	globalThis.document = activeDom.window.document as Document;
	globalThis.navigator = activeDom.window.navigator as Navigator;
	globalThis.Element = activeDom.window.Element;
	globalThis.HTMLElement = activeDom.window.HTMLElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
	globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
	window.matchMedia = () =>
		({
			matches: false,
			media: "",
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;
};

afterEach(() => {
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
	activeDom?.window.close();
	activeDom = null;
});

import TaskMarkdownEditor from "../web/components/TaskMarkdownEditor";
import { apiClient } from "../web/lib/api";

function Harness({ onValue, taskId }: { onValue: (value: string) => void; taskId?: string }) {
	const [value, setValue] = useState("Hello ");
	return (
		<TaskMarkdownEditor
			value={value}
			onChange={(next) => {
				setValue(next);
				onValue(next);
			}}
			taskId={taskId}
			height={200}
			colorMode="light"
		/>
	);
}

const renderEditor = async (onValue: (value: string) => void, taskId?: string) => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(<Harness onValue={onValue} taskId={taskId} />);
	});
	const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
	textarea.setSelectionRange(6, 6);
	return { container, textarea };
};

const pasteFiles = async (target: HTMLTextAreaElement, files: File[]) => {
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", { value: { files, types: ["Files"], getData: () => "" } });
	await act(async () => {
		target.dispatchEvent(event);
	});
	return event;
};

const flush = async () => {
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});
};

describe("TaskMarkdownEditor uploads", () => {
	const originalUpload = apiClient.uploadAsset.bind(apiClient);
	afterEach(() => {
		apiClient.uploadAsset = originalUpload;
	});

	it("inserts a placeholder at the cursor, then the uploaded image link and a toast", async () => {
		const calls: Array<[string, string | undefined]> = [];
		apiClient.uploadAsset = async (_file, name, taskId) => {
			calls.push([name, taskId]);
			return { path: "/assets/images/task-5/paste-1.webp", originalSize: 3_355_443, finalSize: 184_320, compressed: true };
		};
		const values: string[] = [];
		const { container, textarea } = await renderEditor((value) => values.push(value), "TASK-5");

		const event = await pasteFiles(textarea, [new File(["x"], "image.png", { type: "image/png" })]);
		expect(event.defaultPrevented).toBe(true);
		expect(values[0]).toMatch(/^Hello !\[Uploading pasted image…\]\(uploading:[a-z0-9-]+\)$/);

		await flush();
		expect(values.at(-1)).toBe("Hello ![paste-1](/assets/images/task-5/paste-1.webp)");
		expect(calls).toEqual([["", "TASK-5"]]);
		expect(container.textContent).toContain("Compressed 3.2 MB → 180 KB");
	});

	it("removes the placeholder and shows the error when the upload fails", async () => {
		apiClient.uploadAsset = async () => {
			throw new Error("Image is larger than 25 MB");
		};
		const values: string[] = [];
		const { container, textarea } = await renderEditor((value) => values.push(value));
		await pasteFiles(textarea, [new File(["x"], "big.png", { type: "image/png" })]);
		await flush();
		expect(values.at(-1)).toBe("Hello ");
		expect(container.textContent).toContain("Image is larger than 25 MB");
	});

	it("uploads several files in order, each replacing its own placeholder", async () => {
		const order: string[] = [];
		apiClient.uploadAsset = async (file) => {
			const name = (file as File).name;
			order.push(name);
			return { path: `/assets/images/_unsorted/${name.replace(".png", ".webp")}`, originalSize: 10, finalSize: 5, compressed: true };
		};
		const values: string[] = [];
		const { textarea } = await renderEditor((value) => values.push(value));
		const drop = new window.Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", {
			value: {
				files: [new File(["x"], "one.png", { type: "image/png" }), new File(["x"], "two.png", { type: "image/png" })],
				types: ["Files"],
			},
		});
		await act(async () => {
			textarea.dispatchEvent(drop);
		});
		await flush();
		await flush();
		expect(order).toEqual(["one.png", "two.png"]);
		expect(values.at(-1)).toBe(
			"Hello ![one](/assets/images/_unsorted/one.webp)\n![two](/assets/images/_unsorted/two.webp)",
		);
	});

	it("prevents a drop of files that are not images and uploads nothing", async () => {
		let uploads = 0;
		apiClient.uploadAsset = async () => {
			uploads += 1;
			throw new Error("should not upload");
		};
		const values: string[] = [];
		const { textarea } = await renderEditor((value) => values.push(value));
		const drop = new window.Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", {
			value: { files: [new File(["%PDF"], "spec.pdf", { type: "application/pdf" })], types: ["Files"] },
		});
		await act(async () => {
			textarea.dispatchEvent(drop);
		});
		await flush();
		expect(drop.defaultPrevented).toBe(true);
		expect(values).toEqual([]);
		expect(uploads).toBe(0);
	});

	it("leaves a text paste alone", async () => {
		let uploads = 0;
		apiClient.uploadAsset = async () => {
			uploads += 1;
			throw new Error("should not upload");
		};
		const values: string[] = [];
		const { textarea } = await renderEditor((value) => values.push(value));
		const event = await pasteFiles(textarea, []);
		expect(event.defaultPrevented).toBe(false);
		expect(values).toEqual([]);
		expect(uploads).toBe(0);
	});
});
