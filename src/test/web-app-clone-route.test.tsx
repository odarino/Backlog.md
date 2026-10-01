import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toTaskDetail } from "../core/task-detail.ts";
import type { BacklogConfig, Task } from "../types/index.ts";
import App from "../web/App.tsx";
import { HealthCheckProvider } from "../web/contexts/HealthCheckContext.tsx";
import { apiClient } from "../web/lib/api.ts";

const statuses = ["To Do", "In Progress", "Done"];

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;
const restore: Array<() => void> = [];

function assignGlobals(values: Record<string, unknown>) {
	const globals = globalThis as unknown as Record<string, unknown>;
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, globals[key]]));
	Object.assign(globals, values);
	restore.push(() => Object.assign(globals, previous));
}

function setupDom(url: string): HTMLElement {
	activeDom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
	const jsdomWindow = activeDom.window;
	assignGlobals({
		IS_REACT_ACT_ENVIRONMENT: true,
		window: jsdomWindow,
		document: jsdomWindow.document,
		navigator: jsdomWindow.navigator,
		localStorage: jsdomWindow.localStorage,
		Element: jsdomWindow.Element,
		HTMLElement: jsdomWindow.HTMLElement,
		HTMLInputElement: jsdomWindow.HTMLInputElement,
		HTMLTextAreaElement: jsdomWindow.HTMLTextAreaElement,
		HTMLSelectElement: jsdomWindow.HTMLSelectElement,
		Event: jsdomWindow.Event,
		CustomEvent: jsdomWindow.CustomEvent,
		MouseEvent: jsdomWindow.MouseEvent,
		KeyboardEvent: jsdomWindow.KeyboardEvent,
		Node: jsdomWindow.Node,
		MutationObserver: jsdomWindow.MutationObserver,
		getComputedStyle: jsdomWindow.getComputedStyle.bind(jsdomWindow),
		requestAnimationFrame: (callback: FrameRequestCallback) => jsdomWindow.setTimeout(callback, 0),
		cancelAnimationFrame: (handle: number) => jsdomWindow.clearTimeout(handle),
	});
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
	htmlElementPrototype.attachEvent ??= () => {};
	htmlElementPrototype.detachEvent ??= () => {};
	class SocketStub {
		onmessage = null;
		onclose = null;
		onopen = null;
		onerror = null;
		readyState = 1;
		static readonly OPEN = 1;
		static readonly CONNECTING = 0;
		close() {}
		send() {}
	}
	assignGlobals({ WebSocket: SocketStub });
	(window as unknown as Record<string, unknown>).WebSocket = SocketStub;
	return document.getElementById("root") as HTMLElement;
}

function stubApi(task: Task) {
	const originals = {
		checkStatus: apiClient.checkStatus.bind(apiClient),
		fetchStatuses: apiClient.fetchStatuses.bind(apiClient),
		fetchConfig: apiClient.fetchConfig.bind(apiClient),
		fetchMilestones: apiClient.fetchMilestones.bind(apiClient),
		fetchArchivedMilestones: apiClient.fetchArchivedMilestones.bind(apiClient),
		search: apiClient.search.bind(apiClient),
		fetchDuplicateTaskRepairPlan: apiClient.fetchDuplicateTaskRepairPlan.bind(apiClient),
		fetchTask: apiClient.fetchTask.bind(apiClient),
	};
	restore.push(() => Object.assign(apiClient, originals));
	apiClient.checkStatus = async () => ({ initialized: true, projectName: "Clone" }) as never;
	apiClient.fetchStatuses = async () => statuses;
	apiClient.fetchConfig = async () => ({ projectName: "Clone", statuses }) as BacklogConfig;
	apiClient.fetchMilestones = async () => [];
	apiClient.fetchArchivedMilestones = async () => [];
	apiClient.search = async () => [{ type: "task", score: null, task }];
	apiClient.fetchDuplicateTaskRepairPlan = async () => ({ groups: [] }) as never;
	apiClient.fetchTask = async () => toTaskDetail(task, { tasks: [task], completedTasks: [], statuses });
}

const settle = async (rounds = 6) => {
	for (let round = 0; round < rounds; round += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
};

const waitFor = async (what: string, predicate: () => boolean) => {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (predicate()) return;
		await settle(1);
	}
	throw new Error(`Timed out waiting for ${what}`);
};

afterEach(() => {
	if (activeRoot) {
		act(() => activeRoot?.unmount());
		activeRoot = null;
	}
	while (restore.length > 0) restore.pop()?.();
	activeDom?.window.close();
	activeDom = null;
});

describe("clone form and the task route", () => {
	it("keeps the clone form open when the query string changes while the URL still names the source", async () => {
		const source: Task = {
			id: "TASK-2",
			title: "Source task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-01-01",
			rawContent: "",
		};
		const container = setupDom("http://localhost/tasks/TASK-2");
		stubApi(source);

		activeRoot = createRoot(container);
		await act(async () => {
			activeRoot?.render(
				<HealthCheckProvider>
					<App />
				</HealthCheckProvider>,
			);
			await Promise.resolve();
		});
		const dialogText = () => container.querySelector("[role='dialog']")?.textContent ?? "";
		await waitFor("the task detail", () => dialogText().includes("Source task"));

		const clone = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Clone");
		expect(clone).toBeTruthy();
		await act(async () => {
			clone?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});
		await waitFor("the clone form", () => dialogText().includes("Create New Task"));
		expect(container.querySelector<HTMLInputElement>('[role="dialog"] input[type="text"]')?.value).toBe(
			"Copy of Source task",
		);

		// Re-run the route effect without leaving the route: only the query string changes.
		await act(async () => {
			window.history.pushState({}, "", "/tasks/TASK-2?view=x");
			window.dispatchEvent(new window.PopStateEvent("popstate"));
			await Promise.resolve();
		});
		await settle(3);

		expect(dialogText()).toContain("Create New Task");
		expect(container.querySelector<HTMLInputElement>('[role="dialog"] input[type="text"]')?.value).toBe(
			"Copy of Source task",
		);
	});
});
