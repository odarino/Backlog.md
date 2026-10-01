import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { type TaskDetail, toTaskDetail } from "../core/task-detail.ts";
import type { Task } from "../types/index.ts";
import { buildTaskCloneInput } from "../utils/task-clone.ts";
import { TaskDetailsModal } from "../web/components/TaskDetailsModal";
import { TaskIdIndexProvider } from "../web/contexts/TaskIdIndexContext.tsx";
import { ThemeProvider } from "../web/contexts/ThemeContext";

const statuses = ["To Do", "In Progress", "Done"];

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

const sourceTask: Task = {
	id: "BACK-7",
	title: "Original",
	status: "In Progress",
	dependencies: ["BACK-1"],
	assignee: ["@alex"],
	labels: ["web"],
	createdDate: "2026-01-01",
	description: "Body text",
	implementationPlan: "Plan text",
	implementationNotes: "Secret notes",
	finalSummary: "Secret summary",
	references: ["https://example.com/ref"],
	documentation: ["docs/guide.md"],
	modifiedFiles: ["src/a.ts"],
	parentTaskId: "BACK-3",
	acceptanceCriteriaItems: [
		{ index: 1, text: "First", checked: true },
		{ index: 2, text: "Second", checked: false },
	],
	definitionOfDoneItems: [{ index: 1, text: "Source DoD", checked: true }],
	rawContent: "",
};

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

const mount = async (element: React.ReactElement, corpus: Task[]): Promise<HTMLElement> => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(
			<MemoryRouter>
				<ThemeProvider>
					<TaskIdIndexProvider tasks={corpus}>{element}</TaskIdIndexProvider>
				</ThemeProvider>
			</MemoryRouter>,
		);
		await Promise.resolve();
	});
	return container;
};

const findButton = (container: HTMLElement, text: string) =>
	Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);

const click = async (element: Element | undefined) => {
	expect(element).toBeTruthy();
	await act(async () => {
		element?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
};

const mountCreate = async (
	onSubmit: (data: Partial<Task>) => Promise<void>,
	onClose: () => void,
	options: { defaults?: string[]; prefill?: boolean } = {},
) => {
	const prefill = options.prefill === false ? undefined : buildTaskCloneInput(sourceTask);
	return mount(
		<TaskDetailsModal
			isOpen={true}
			onClose={onClose}
			onSubmit={onSubmit}
			availableStatuses={statuses}
			availableTasks={[sourceTask]}
			definitionOfDoneDefaults={options.defaults ?? ["Config default"]}
			prefill={prefill}
		/>,
		[sourceTask],
	);
};

describe("task clone in the web UI", () => {
	it("opens the create form with the copied values and submits them", async () => {
		const submitted: Partial<Task>[] = [];
		const container = await mountCreate(
			async (data) => {
				submitted.push(data);
			},
			() => {},
		);

		const titleInput = container.querySelector<HTMLInputElement>('input[type="text"]');
		expect(titleInput?.value).toBe("Copy of Original");
		const values = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).map(
			(element) => element.value,
		);
		expect(values).toContain("First");
		expect(values).toContain("Second");
		expect(values).toContain("Source DoD");
		expect(values).not.toContain("Config default");
		const checkedBoxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(
			(box) => box.checked,
		);
		expect(checkedBoxes).toHaveLength(0);

		await click(findButton(container, "Create"));

		expect(submitted).toHaveLength(1);
		const payload = submitted[0] as Record<string, unknown>;
		expect(payload.title).toBe("Copy of Original");
		expect(payload.description).toBe("Body text");
		expect(payload.implementationPlan).toBe("Plan text");
		expect(payload.labels).toEqual(["web"]);
		expect(payload.dependencies).toEqual(["BACK-1"]);
		expect(payload.assignee).toEqual(["@alex"]);
		expect(payload.references).toEqual(["https://example.com/ref"]);
		expect(payload.documentation).toEqual(["docs/guide.md"]);
		expect(payload.modifiedFiles).toEqual(["src/a.ts"]);
		expect(payload.parentTaskId).toBe("BACK-3");
		expect(payload.status).toBe("To Do");
		expect(payload.definitionOfDoneAdd).toEqual(["Source DoD"]);
		expect(payload.disableDefinitionOfDoneDefaults).toBe(true);
		expect((payload.acceptanceCriteriaItems as { text: string; checked: boolean }[]).map((i) => [i.text, i.checked])).toEqual([
			["First", false],
			["Second", false],
		]);
	});

	it("sends the config defaults for a plain create", async () => {
		const submitted: Partial<Task>[] = [];
		const container = await mountCreate(
			async (data) => {
				submitted.push(data);
			},
			() => {},
			{ prefill: false },
		);
		const titleInput = container.querySelector<HTMLInputElement>('input[type="text"]');
		expect(titleInput?.value).toBe("");
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			setter?.call(titleInput, "Fresh");
			titleInput?.dispatchEvent(new window.Event("input", { bubbles: true }));
			await Promise.resolve();
		});
		await click(findButton(container, "Create"));
		const payload = submitted[0] as Record<string, unknown>;
		expect(payload.title).toBe("Fresh");
		expect(payload.definitionOfDoneAdd).toBeUndefined();
		expect(payload.disableDefinitionOfDoneDefaults).toBeUndefined();
		expect(payload.references).toEqual([]);
		expect(payload.modifiedFiles).toEqual([]);
		expect(payload.parentTaskId).toBeUndefined();
	});

	it("cancels without a prompt or a create when nothing changed", async () => {
		let submits = 0;
		let closes = 0;
		const container = await mountCreate(
			async () => {
				submits += 1;
			},
			() => {
				closes += 1;
			},
		);
		let confirmCalls = 0;
		window.confirm = () => {
			confirmCalls += 1;
			return false;
		};
		await click(findButton(container, "Cancel"));
		expect(confirmCalls).toBe(0);
		expect(submits).toBe(0);
		expect(closes).toBe(1);
	});

	it("asks for confirmation when cancelling after an edit", async () => {
		let closes = 0;
		const container = await mountCreate(
			async () => {},
			() => {
				closes += 1;
			},
		);
		const titleInput = container.querySelector<HTMLInputElement>('input[type="text"]');
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			setter?.call(titleInput, "Edited copy");
			titleInput?.dispatchEvent(new window.Event("input", { bubbles: true }));
			await Promise.resolve();
		});
		let confirmCalls = 0;
		window.confirm = () => {
			confirmCalls += 1;
			return false;
		};
		await click(findButton(container, "Cancel"));
		expect(confirmCalls).toBe(1);
		expect(closes).toBe(0);
	});

	it("opens a draft clone in draft mode", async () => {
		const submitted: Partial<Task>[] = [];
		const draft: Task = { ...sourceTask, id: "DRAFT-2", status: "Draft" };
		const prefill = buildTaskCloneInput(draft);
		expect(prefill.status).toBe("Draft");
		const container = await mount(
			<TaskDetailsModal
				isOpen={true}
				onClose={() => {}}
				onSubmit={async (data) => {
					submitted.push(data);
				}}
				availableStatuses={statuses}
				availableTasks={[draft]}
				isDraftMode={true}
				prefill={prefill}
			/>,
			[draft],
		);
		expect(document.body.textContent).toContain("Create New Draft");
		await click(findButton(container, "Create"));
		expect(submitted[0]?.status).toBe("Draft");
	});

	it("shows Clone in view mode and calls onClone with the task", async () => {
		const cloned: Task[] = [];
		const detail = detailOf(sourceTask, [sourceTask]);
		const container = await mount(
			<TaskDetailsModal
				task={detail}
				isOpen={true}
				onClose={() => {}}
				availableStatuses={statuses}
				availableTasks={[sourceTask]}
				onClone={(task) => cloned.push(task)}
			/>,
			[sourceTask],
		);
		await click(findButton(container, "Clone"));
		expect(cloned).toHaveLength(1);
		expect(cloned[0]?.id).toBe("BACK-7");
	});

	it("hides Clone for a task from another branch", async () => {
		const other = { ...sourceTask, branch: "feature/x" };
		const container = await mount(
			<TaskDetailsModal
				task={detailOf(other, [other])}
				isOpen={true}
				onClose={() => {}}
				availableStatuses={statuses}
				availableTasks={[other]}
				onClone={() => {}}
			/>,
			[other],
		);
		expect(findButton(container, "Clone")).toBeUndefined();
	});
});
