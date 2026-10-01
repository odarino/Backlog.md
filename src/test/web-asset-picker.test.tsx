import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { type TaskDetail, toTaskDetail } from "../core/task-detail.ts";
import type { Task } from "../types/index.ts";
import AssetPickerModal from "../web/components/AssetPickerModal";
import { apiClient } from "../web/lib/api";
import type { AssetEntry } from "../types/index.ts";
import { TaskDetailsModal } from "../web/components/TaskDetailsModal";
import { TaskIdIndexProvider } from "../web/contexts/TaskIdIndexContext.tsx";
import { ThemeProvider } from "../web/contexts/ThemeContext";

const statuses = ["To Do", "In Progress", "Done"];

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

function makeTask(id: string, status: string, dependencies: string[] = []): Task {
	return {
		id,
		title: `Task ${id}`,
		status,
		dependencies,
		assignee: [],
		labels: [],
		createdDate: new Date().toISOString().slice(0, 10),
		rawContent: "",
	};
}

const detailOf = (task: Task, corpus: Task[]): TaskDetail =>
	toTaskDetail(task, { tasks: corpus, completedTasks: [], statuses });

const setupDom = () => {
	activeDom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost",
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = activeDom.window as unknown as Window & typeof globalThis;
	globalThis.document = activeDom.window.document as Document;
	globalThis.navigator = activeDom.window.navigator as Navigator;
	globalThis.localStorage = activeDom.window.localStorage;
	globalThis.Element = activeDom.window.Element;
	globalThis.HTMLElement = activeDom.window.HTMLElement;
	globalThis.HTMLInputElement = activeDom.window.HTMLInputElement;
	globalThis.HTMLTextAreaElement = activeDom.window.HTMLTextAreaElement;
	globalThis.HTMLSelectElement = activeDom.window.HTMLSelectElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
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
	const htmlElementPrototype = window.HTMLElement.prototype as unknown as {
		attachEvent?: () => void;
		detachEvent?: () => void;
	};
	htmlElementPrototype.attachEvent = () => {};
	htmlElementPrototype.detachEvent = () => {};
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
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

const assets: AssetEntry[] = [
	{ path: "/assets/images/task-5/new.webp", name: "new.webp", size: 10, mtime: "2026-09-30T10:00:00.000Z", taskId: "task-5" },
	{ path: "/assets/images/task-5/old.webp", name: "old.webp", size: 10, mtime: "2026-09-29T10:00:00.000Z", taskId: "task-5" },
	{ path: "/assets/images/task-9/other.webp", name: "other.webp", size: 10, mtime: "2026-09-30T11:00:00.000Z", taskId: "task-9" },
];

const tick = () =>
	act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});

const renderPicker = async (onInsert: (markdown: string) => void, onClose = () => {}) => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(<AssetPickerModal isOpen={true} taskId="TASK-5" onClose={onClose} onInsert={onInsert} />);
		await Promise.resolve();
	});
	await tick();
	return container;
};

const tile = (name: string) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find((button) =>
		button.textContent?.includes(name),
	) as HTMLButtonElement;

const click = async (element: Element, type = "click") => {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
	});
};

describe("AssetPickerModal", () => {
	const originalList = apiClient.listAssets.bind(apiClient);
	const originalUpload = apiClient.uploadAsset.bind(apiClient);
	afterEach(() => {
		apiClient.listAssets = originalList;
		apiClient.uploadAsset = originalUpload;
	});

	it("groups this task's images first and filters by name", async () => {
		apiClient.listAssets = async () => assets;
		await renderPicker(() => {});
		const headings = Array.from(document.querySelectorAll("h3")).map((heading) => heading.textContent);
		expect(headings).toEqual(["This task", "All assets"]);
		const search = document.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			setter?.call(search, "oth");
			search.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		expect(document.querySelectorAll("button[aria-pressed]")).toHaveLength(1);
	});

	it("inserts selected images in selection order and closes", async () => {
		apiClient.listAssets = async () => assets;
		const inserted: string[] = [];
		let closed = 0;
		await renderPicker(
			(markdown) => inserted.push(markdown),
			() => {
				closed += 1;
			},
		);
		await click(tile("other.webp"));
		await click(tile("new.webp"));
		expect(tile("other.webp").getAttribute("aria-pressed")).toBe("true");
		const insert = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Insert (2)");
		await click(insert as HTMLButtonElement);
		expect(inserted).toEqual(["![other](/assets/images/task-9/other.webp)\n![new](/assets/images/task-5/new.webp)"]);
		expect(closed).toBe(1);
	});

	it("inserts one image on double-click", async () => {
		apiClient.listAssets = async () => assets;
		const inserted: string[] = [];
		await renderPicker((markdown) => inserted.push(markdown));
		await click(tile("old.webp"), "dblclick");
		expect(inserted).toEqual(["![old](/assets/images/task-5/old.webp)"]);
	});

	it("uploads files and selects the new images", async () => {
		let listed = [...assets];
		apiClient.listAssets = async () => listed;
		apiClient.uploadAsset = async (_file, name) => {
			const saved = {
				path: `/assets/images/task-5/${name.replace(".png", ".webp")}`,
				originalSize: 10,
				finalSize: 5,
				compressed: true,
			};
			listed = [
				{
					path: saved.path,
					name: name.replace(".png", ".webp"),
					size: 5,
					mtime: "2026-09-30T12:00:00.000Z",
					taskId: "task-5",
				},
				...listed,
			];
			return saved;
		};
		await renderPicker(() => {});
		const input = document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, "files", { value: [new File(["x"], "fresh.png", { type: "image/png" })] });
		await act(async () => {
			input.dispatchEvent(new window.Event("change", { bubbles: true }));
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});
		await tick();
		expect(tile("fresh.webp").getAttribute("aria-pressed")).toBe("true");
	});

	it("Escape closes only the picker and keeps the task modal in edit mode", async () => {
		const originalListAssets = apiClient.listAssets;
		apiClient.listAssets = async () => assets;
		try {
			const task = { ...makeTask("TASK-5", "To Do"), description: "Some text" };
			const corpus = [task];
			let modalClosed = 0;
			setupDom();
			const container = document.getElementById("root") as HTMLElement;
			activeRoot = createRoot(container);
			await act(async () => {
				activeRoot?.render(
					<MemoryRouter initialEntries={[`/tasks/${task.id}`]}>
						<ThemeProvider>
							<TaskIdIndexProvider tasks={corpus}>
								<TaskDetailsModal
									task={detailOf(task, corpus)}
									availableTasks={corpus}
									availableStatuses={statuses}
									isOpen={true}
									onClose={() => {
										modalClosed += 1;
									}}
								/>
							</TaskIdIndexProvider>
						</ThemeProvider>
					</MemoryRouter>,
				);
				await Promise.resolve();
			});
			const findButton = (text: string) =>
				Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(text));
			await click(findButton("Edit") as HTMLButtonElement);
			expect(findButton("Save")).toBeTruthy();
			await click(document.querySelector('button[aria-label="Insert image from assets"]') as Element);
			await tick();
			expect(document.querySelector('input[type="search"]')).not.toBeNull();

			await act(async () => {
				(document.activeElement ?? document.body).dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
				);
				await new Promise((resolve) => window.setTimeout(resolve, 0));
			});

			expect(document.querySelector('input[type="search"]')).toBeNull();
			expect(findButton("Save")).toBeTruthy();
			expect(modalClosed).toBe(0);
		} finally {
			apiClient.listAssets = originalListAssets;
		}
	});
});
