import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { type TaskDetail, toTaskDetail } from "../core/task-detail.ts";
import type { Task } from "../types/index.ts";
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

const mountWithImage = async (onClose: () => void): Promise<HTMLElement> => {
	const task = {
		...makeTask("BACK-1", "To Do"),
		description: "Before\n\n![shot](/assets/images/back-1/shot.png)\n\nAfter",
	};
	const corpus = [task];
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
							onClose={onClose}
						/>
					</TaskIdIndexProvider>
				</ThemeProvider>
			</MemoryRouter>,
		);
		await Promise.resolve();
	});
	return container;
};

const openLightbox = async (container: HTMLElement) => {
	const image = container.querySelector<HTMLImageElement>('.wmde-markdown img[alt="shot"]');
	expect(image).not.toBeNull();
	await act(async () => {
		image?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	});
	expect(document.querySelector(".yarl__root")).not.toBeNull();
};

const findButton = (container: HTMLElement, text: string) =>
	Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(text));

const pressOnLightbox = async (key: string, settleMs = 0, init: KeyboardEventInit = {}) => {
	const target = document.querySelector(".yarl__container") as Element;
	expect(target).not.toBeNull();
	await act(async () => {
		target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
		await new Promise((resolve) => window.setTimeout(resolve, settleMs));
	});
};

describe("task details image zoom", () => {
	it("opens the lightbox from a description image and Escape closes only the lightbox", async () => {
		const task = {
			...makeTask("BACK-1", "To Do"),
			description: "Before\n\n![shot](/assets/images/back-1/shot.png)\n\nAfter",
		};
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

		const image = container.querySelector<HTMLImageElement>('.wmde-markdown img[alt="shot"]');
		expect(image).not.toBeNull();

		await act(async () => {
			image?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
		});
		expect(document.querySelector(".yarl__root")).not.toBeNull();

		await act(async () => {
			const target = document.querySelector(".yarl__container") ?? document.querySelector(".yarl__root") ?? document.body;
			target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
			await new Promise((resolve) => window.setTimeout(resolve, 600));
		});

		expect(modalClosed).toBe(0);
		expect(document.querySelector(".yarl__root")).toBeNull();
	});

	it("keeps edit mode and its text when Escape closes the lightbox", async () => {
		let modalClosed = 0;
		const container = await mountWithImage(() => {
			modalClosed += 1;
		});
		// MDEditor renders no image in edit mode, so enter edit mode while the lightbox is already open.
		await openLightbox(container);
		const editButton = findButton(container, "Edit");
		expect(editButton).toBeTruthy();
		await act(async () => {
			editButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
			await Promise.resolve();
		});
		expect(findButton(container, "Save")).toBeTruthy();

		await pressOnLightbox("Escape", 600);

		expect(document.querySelector(".yarl__root")).toBeNull();
		expect(findButton(container, "Save")).toBeTruthy();
		expect(modalClosed).toBe(0);
	});

	it("ignores the e shortcut while the lightbox is open", async () => {
		const container = await mountWithImage(() => {});
		await openLightbox(container);

		await pressOnLightbox("e");

		expect(findButton(container, "Save")).toBeUndefined();
		expect(findButton(container, "Edit")).toBeTruthy();
	});

	it("keeps lightbox keydown events away from document listeners", async () => {
		const container = await mountWithImage(() => {});
		await openLightbox(container);
		const seen: string[] = [];
		const listener = (event: KeyboardEvent) => seen.push(event.key);
		document.addEventListener("keydown", listener);
		try {
			await pressOnLightbox("k", 0, { ctrlKey: true });
			await pressOnLightbox("Escape", 600);
		} finally {
			document.removeEventListener("keydown", listener);
		}
		expect(seen).toEqual([]);
		expect(document.querySelector(".yarl__root")).toBeNull();
	});
});
