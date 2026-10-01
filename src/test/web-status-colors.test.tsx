import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import TaskColumn from "../web/components/TaskColumn";
import { readableTextColor, statusChipStyle, statusColorFor } from "../web/lib/status-colors";

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

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

const renderColumn = async (statusColors?: Record<string, string>) => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(
			<TaskColumn title="Review" tasks={[]} onTaskUpdate={() => {}} onEditTask={() => {}} statusColors={statusColors} />,
		);
	});
	return container;
};

describe("readableTextColor", () => {
	it("picks readable text for the background", () => {
		expect(readableTextColor("#ffffff")).toBe("#111827");
		expect(readableTextColor("#000000")).toBe("#ffffff");
		expect(readableTextColor("#f59e0b")).toBe("#111827");
		expect(readableTextColor("#1e3a8a")).toBe("#ffffff");
	});
});

describe("statusColorFor", () => {
	it("matches by normalized key", () => {
		expect(statusColorFor({ "In Progress": "#f59e0b" }, "in progress")).toBe("#f59e0b");
		expect(statusColorFor({ "In Progress": "#f59e0b" }, "Done")).toBeNull();
		expect(statusColorFor(undefined, "Done")).toBeNull();
	});
});

describe("statusChipStyle", () => {
	it("returns background and readable text, or undefined", () => {
		expect(statusChipStyle({ Done: "#10b981" }, "Done")).toEqual({
			backgroundColor: "#10b981",
			color: readableTextColor("#10b981"),
		});
		expect(statusChipStyle({ Done: "#10b981" }, "To Do")).toBeUndefined();
	});
});

describe("TaskColumn status color", () => {
	it("renders a color dot when the status has a color", async () => {
		const container = await renderColumn({ Review: "#8b5cf6" });
		const dot = container.querySelector("[data-status-color]") as HTMLElement | null;
		expect(dot).not.toBeNull();
		expect(dot?.style.backgroundColor).toBe("rgb(139, 92, 246)");
	});

	it("renders no color dot without colors", async () => {
		const container = await renderColumn();
		expect(container.querySelector("[data-status-color]")).toBeNull();
	});
});
