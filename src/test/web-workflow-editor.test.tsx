import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WorkflowEditor from "../web/components/WorkflowEditor";
import { ApiError, apiClient } from "../web/lib/api";
import type { BacklogConfig } from "../types";

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

const originals = {
	fetchStatusUsage: apiClient.fetchStatusUsage,
	renameStatus: apiClient.renameStatus,
	removeStatus: apiClient.removeStatus,
	fetchConfig: apiClient.fetchConfig,
	updateConfig: apiClient.updateConfig,
};

type Call = [string, ...unknown[]];
let calls: Call[] = [];
let renameError: Error | null = null;

const baseConfig = {
	projectName: "Test",
	statuses: ["To Do", "In Progress", "Review", "Done"],
	labels: [],
	dateFormat: "yyyy-mm-dd",
	defaultStatus: "To Do",
} as unknown as BacklogConfig;

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
	globalThis.HTMLInputElement = activeDom.window.HTMLInputElement;
};

beforeEach(() => {
	calls = [];
	renameError = null;
	apiClient.fetchStatusUsage = async () => ({ "To Do": 2, "In Progress": 0, Review: 3, Done: 1 });
	apiClient.renameStatus = async (from, to) => {
		calls.push(["rename", from, to]);
		if (renameError) throw renameError;
		return { config: baseConfig, changedTasks: 0 };
	};
	apiClient.removeStatus = async (status, moveTo) => {
		calls.push(["remove", status, moveTo]);
		return { config: baseConfig, changedTasks: 0 };
	};
	apiClient.fetchConfig = async () => baseConfig;
	apiClient.updateConfig = async (config) => {
		calls.push(["update", config.statuses, config.statusColors]);
		return config;
	};
});

afterEach(() => {
	Object.assign(apiClient, originals);
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
	activeDom?.window.close();
	activeDom = null;
});

const tick = () =>
	act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});

const renderEditor = async (onSaved: (result: { error?: string; config?: BacklogConfig }) => void = () => {}) => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(<WorkflowEditor config={baseConfig} onSaved={onSaved} />);
		await Promise.resolve();
	});
	await tick();
	return container;
};

const byLabel = <T extends HTMLElement = HTMLElement>(label: string) =>
	document.querySelector(`[aria-label="${label}"]`) as T;
const nameInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label="Status name"]'));
const names = () => nameInputs().map((input) => input.value);
const buttonByText = (text: string) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

const click = async (element: Element) => {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	});
};

const typeInto = async (element: Element, value: string) => {
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
		setter?.call(element, value);
		element.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};

const select = async (element: Element, value: string) => {
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
		setter?.call(element, value);
		element.dispatchEvent(new window.Event("change", { bubbles: true }));
	});
};

const save = () => buttonByText("Save workflow");

describe("WorkflowEditor", () => {
	it("renders rows in order with a Done badge on the last row only", async () => {
		await renderEditor();
		expect(names()).toEqual(["To Do", "In Progress", "Review", "Done"]);
		const badges = Array.from(document.querySelectorAll("span")).filter((el) => el.textContent === "Done");
		expect(badges).toHaveLength(1);
		expect(nameInputs()[3]?.closest("li")?.contains(badges[0] as Element)).toBe(true);
		expect(save().disabled).toBe(true);
		expect(byLabel<HTMLInputElement>("Color for To Do").value).toBe("#94a3b8");
	});

	it("renames and reorders, then saves in order", async () => {
		const saved: Array<{ error?: string; config?: BacklogConfig }> = [];
		await renderEditor((result) => {
			saved.push(result);
		});
		await typeInto(nameInputs()[2] as HTMLInputElement, "QA");
		await click(byLabel("Move QA up"));
		expect(names()).toEqual(["To Do", "QA", "In Progress", "Done"]);
		expect(save().disabled).toBe(false);
		await click(save());
		await tick();
		expect(calls).toEqual([
			["rename", "Review", "QA"],
			["update", ["To Do", "QA", "In Progress", "Done"], {}],
		]);
		// The saved config from the last update goes to the parent, so it does not need to fetch again.
		expect(saved).toHaveLength(1);
		expect(saved[0]?.error).toBeUndefined();
		expect(saved[0]?.config?.statuses).toEqual(["To Do", "QA", "In Progress", "Done"]);
	});

	it("sends the full status colors on save", async () => {
		await renderEditor();
		await typeInto(byLabel("Color for To Do"), "#FF0000");
		await click(save());
		await tick();
		expect(calls).toEqual([["update", ["To Do", "In Progress", "Review", "Done"], { "To Do": "#ff0000" }]]);
	});

	it("deletes an unused status at once and focuses the add input", async () => {
		await renderEditor();
		byLabel("Delete In Progress").focus();
		await click(byLabel("Delete In Progress"));
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(byLabel("New status"));
		expect(names()).toEqual(["To Do", "Review", "Done"]);
		await click(save());
		await tick();
		expect(calls[0]).toEqual(["remove", "In Progress", undefined]);
		expect(calls[1]?.[0]).toBe("update");
	});

	it("moves tasks when deleting a used status", async () => {
		await renderEditor();
		await click(byLabel("Delete Review"));
		expect(document.body.textContent).toContain('3 tasks use "Review". Move them to:');
		await select(byLabel("Move tasks to"), "To Do");
		await click(buttonByText("Delete"));
		expect(names()).toEqual(["To Do", "In Progress", "Done"]);
		await click(save());
		await tick();
		expect(calls[0]).toEqual(["remove", "Review", "To Do"]);
	});

	it("adds a status before the last one", async () => {
		await renderEditor();
		await typeInto(byLabel("New status"), "Blocked");
		await click(buttonByText("Add"));
		expect(names()).toEqual(["To Do", "In Progress", "Review", "Blocked", "Done"]);
		await click(save());
		await tick();
		expect(calls).toEqual([["update", ["To Do", "In Progress", "Review", "Blocked", "Done"], {}]]);
	});

	it("moves focus to the other Move button when a row reaches an end", async () => {
		await renderEditor();
		byLabel("Move In Progress up").focus();
		await click(byLabel("Move In Progress up"));
		expect(names()).toEqual(["In Progress", "To Do", "Review", "Done"]);
		expect(document.activeElement).toBe(byLabel("Move In Progress down"));
		byLabel("Move Review down").focus();
		await click(byLabel("Move Review down"));
		expect(names()).toEqual(["In Progress", "To Do", "Done", "Review"]);
		expect(document.activeElement).toBe(byLabel("Move Review up"));
	});

	it("shows the usage error and the validation text together", async () => {
		apiClient.fetchStatusUsage = async () => {
			throw new Error("Usage failed");
		};
		await renderEditor();
		await typeInto(nameInputs()[0] as HTMLInputElement, "");
		const lines = Array.from(document.querySelectorAll('[role="alert"] > *')).map((line) => line.textContent);
		expect(lines).toEqual(["Usage failed", "Status name is required"]);
	});

	it("shows validation text for an empty name and disables save", async () => {
		await renderEditor();
		await typeInto(nameInputs()[0] as HTMLInputElement, "");
		expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
		expect(save().disabled).toBe(true);
	});

	it("keeps the rows and skips the reload when the first call fails", async () => {
		let saved = 0;
		renameError = new ApiError("Status already exists: Done", 409);
		await renderEditor(() => {
			saved += 1;
		});
		await typeInto(nameInputs()[2] as HTMLInputElement, "QA");
		await click(save());
		await tick();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain("Status already exists: Done");
		expect(saved).toBe(0);
		expect(names()[2]).toBe("QA");
		expect(calls.some((call) => call[0] === "update")).toBe(false);
	});

	it("reports a server error on the first call through onSaved, because it can be a partial change", async () => {
		const saved: Array<{ error?: string }> = [];
		renameError = new ApiError("Workflow changed but the commit failed: commit failed", 500);
		await renderEditor((result) => {
			saved.push(result);
		});
		await typeInto(nameInputs()[2] as HTMLInputElement, "QA");
		await click(save());
		await tick();
		expect(saved).toEqual([{ error: "Workflow changed but the commit failed: commit failed" }]);
	});

	it("reports a partial failure through onSaved", async () => {
		const saved: Array<{ error?: string }> = [];
		renameError = new Error("Status already exists: Done");
		await renderEditor((result) => {
			saved.push(result);
		});
		await click(byLabel("Delete In Progress"));
		await typeInto(nameInputs()[1] as HTMLInputElement, "QA");
		await click(save());
		await tick();
		expect(calls.map((call) => call[0])).toEqual(["remove", "rename"]);
		expect(saved).toEqual([{ error: "Status already exists: Done" }]);
	});

	it("calls the removal before the rename", async () => {
		await renderEditor();
		await typeInto(nameInputs()[0] as HTMLInputElement, "Backlog");
		await click(byLabel("Delete In Progress"));
		await click(save());
		await tick();
		expect(calls.map((call) => call.slice(0, 2).join(":"))).toEqual(["remove:In Progress", "rename:To Do", "update:Backlog,Review,Done"]);
	});

	it("adds new statuses first when a removal is saved", async () => {
		await renderEditor();
		await typeInto(byLabel("New status"), "Blocked");
		await click(buttonByText("Add"));
		await click(byLabel("Delete In Progress"));
		await click(save());
		await tick();
		expect(calls).toEqual([
			["update", ["To Do", "In Progress", "Review", "Blocked", "Done"], undefined],
			["remove", "In Progress", undefined],
			["update", ["To Do", "Review", "Blocked", "Done"], {}],
		]);
	});

	it("keeps the row and records no removal when the delete dialog is cancelled", async () => {
		await renderEditor();
		await click(byLabel("Delete Review"));
		await click(buttonByText("Cancel"));
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(names()).toEqual(["To Do", "In Progress", "Review", "Done"]);
		expect(save().disabled).toBe(true);
	});

	it("labels renamed move targets and focuses the add input after a confirmed delete", async () => {
		await renderEditor();
		await typeInto(nameInputs()[2] as HTMLInputElement, "QA");
		await click(byLabel("Delete To Do"));
		const options = Array.from(document.querySelectorAll<HTMLOptionElement>('[aria-label="Move tasks to"] option'));
		expect(options.map((o) => [o.value, o.textContent])).toEqual([
			["In Progress", "In Progress"],
			["Review", "QA (Review)"],
			["Done", "Done"],
		]);
		await click(buttonByText("Delete"));
		expect(document.activeElement).toBe(byLabel("New status"));
	});

	it("disables Delete and shows the error when the usage load fails", async () => {
		apiClient.fetchStatusUsage = async () => {
			throw new Error("Usage failed");
		};
		await renderEditor();
		expect(byLabel<HTMLButtonElement>("Delete Review").disabled).toBe(true);
		expect(document.querySelector('[role="alert"]')?.textContent).toContain("Usage failed");
	});
});
