import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Modal from "../web/components/Modal";

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

const setupDom = () => {
	activeDom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost",
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = activeDom.window as unknown as Window & typeof globalThis;
	globalThis.document = activeDom.window.document as Document;
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

const renderModal = async (suspendKeyHandling: boolean, onClose: () => void) => {
	setupDom();
	activeRoot = createRoot(document.getElementById("root") as HTMLElement);
	await act(async () => {
		activeRoot?.render(
			<Modal isOpen={true} onClose={onClose} title="Test" suspendKeyHandling={suspendKeyHandling}>
				<p>body</p>
			</Modal>,
		);
	});
};

const pressEscape = () => {
	const event = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
	document.body.dispatchEvent(event);
	return event;
};

describe("Modal suspendKeyHandling", () => {
	it("closes on Escape by default", async () => {
		let closed = 0;
		await renderModal(false, () => {
			closed += 1;
		});
		const event = pressEscape();
		expect(closed).toBe(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("ignores Escape and leaves the event untouched while suspended", async () => {
		let closed = 0;
		await renderModal(true, () => {
			closed += 1;
		});
		const event = pressEscape();
		expect(closed).toBe(0);
		expect(event.defaultPrevented).toBe(false);
	});
});
