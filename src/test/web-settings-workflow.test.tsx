import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Settings from "../web/components/Settings";
import { apiClient } from "../web/lib/api";
import type { BacklogConfig } from "../types";

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;
let serverConfig: BacklogConfig;
let renameError: Error | null = null;

const originals = {
	fetchConfig: apiClient.fetchConfig,
	fetchStatuses: apiClient.fetchStatuses,
	fetchStatusUsage: apiClient.fetchStatusUsage,
	renameStatus: apiClient.renameStatus,
	removeStatus: apiClient.removeStatus,
	updateConfig: apiClient.updateConfig,
};

const makeConfig = (): BacklogConfig =>
	({
		projectName: "Test",
		statuses: ["To Do", "In Progress", "Review", "Done"],
		labels: [],
		dateFormat: "yyyy-mm-dd",
		defaultStatus: "To Do",
		autoCommit: false,
		remoteOperations: false,
		defaultEditor: "",
		autoOpenBrowser: false,
		maxColumnWidth: 80,
		taskResolutionStrategy: "most_recent",
	}) as unknown as BacklogConfig;

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
	serverConfig = makeConfig();
	renameError = null;
	// A fresh object with its keys in a different order, as a real server response can have.
	apiClient.fetchConfig = async () => JSON.parse(JSON.stringify(serverConfig, Object.keys(serverConfig).sort()));
	apiClient.fetchStatuses = async () => [...serverConfig.statuses];
	apiClient.fetchStatusUsage = async () => ({ "To Do": 2, "In Progress": 0, Review: 3, Done: 1 });
	apiClient.removeStatus = async (status) => {
		serverConfig = { ...serverConfig, statuses: serverConfig.statuses.filter((s) => s !== status) };
		return { config: serverConfig, changedTasks: 0 };
	};
	apiClient.renameStatus = async () => {
		if (renameError) throw renameError;
		return { config: serverConfig, changedTasks: 0 };
	};
	apiClient.updateConfig = async (config) => {
		serverConfig = { ...config };
		return serverConfig;
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

const renderSettings = async () => {
	setupDom();
	activeRoot = createRoot(document.getElementById("root") as HTMLElement);
	await act(async () => {
		activeRoot?.render(<Settings />);
		await Promise.resolve();
	});
	await tick();
	await tick();
};

const byLabel = <T extends HTMLElement = HTMLElement>(label: string) =>
	document.querySelector(`[aria-label="${label}"]`) as T;
const buttonByText = (text: string) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
		(b) => b.textContent?.trim() === text,
	) as HTMLButtonElement;
const click = async (element: Element) => {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	});
};
const typeInto = async (element: Element, value: string) => {
	await act(async () => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const nameInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label="Status name"]'));

describe("Settings workflow editor", () => {
	it("keeps the error visible after a partial failure reloads the workflow", async () => {
		renameError = new Error("Status already exists: Done");
		await renderSettings();
		await click(byLabel("Delete In Progress"));
		await typeInto(nameInputs()[1] as HTMLInputElement, "QA");
		await click(buttonByText("Save workflow"));
		await tick();
		await tick();
		expect(document.body.textContent).toContain(
			"Status already exists: Done. Some changes were saved; the workflow was reloaded.",
		);
		expect(nameInputs().map((input) => input.value)).toEqual(["To Do", "Review", "Done"]);
	});

	it("shows the config the save returned, not a later stale read", async () => {
		await renderSettings();
		const stale = makeConfig();
		const saveConfig = apiClient.updateConfig;
		let updates = 0;
		apiClient.updateConfig = async (config) => {
			updates += 1;
			const saved = await saveConfig(config);
			// From now on a read returns the list from before the save, as a stale cache can.
			apiClient.fetchConfig = async () => stale;
			apiClient.fetchStatuses = async () => [...stale.statuses];
			return saved;
		};
		await typeInto(byLabel("New status"), "Blocked");
		await click(buttonByText("Add"));
		await click(buttonByText("Save workflow"));
		await tick();
		await tick();
		expect(updates).toBe(1);
		expect(nameInputs().map((input) => input.value)).toEqual(["To Do", "In Progress", "Review", "Blocked", "Done"]);
		// The editor compares against the saved config, so nothing is left to save.
		expect(buttonByText("Save workflow").disabled).toBe(true);
		expect(document.body.textContent).toContain("Workflow saved");
	});

	it("shows the success toast and no unsaved changes after a workflow save", async () => {
		await renderSettings();
		await click(byLabel("Delete In Progress"));
		await click(buttonByText("Save workflow"));
		await tick();
		await tick();
		expect(document.body.textContent).toContain("Workflow saved");
		expect(buttonByText("Save Changes").disabled).toBe(true);
	});
});
