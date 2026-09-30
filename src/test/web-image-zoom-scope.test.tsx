import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ImageZoomScope from "../web/components/ImageZoomScope";

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

const renderScope = async (onOpenChange: (open: boolean) => void) => {
	setupDom();
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(
			<ImageZoomScope onOpenChange={onOpenChange}>
				<div className="wmde-markdown">
					<img id="first" src="/assets/one.png" alt="one" />
					<img id="second" src="/assets/two.png" alt="two" />
					<a href="https://x.test">
						<img id="linked" src="/assets/linked.png" alt="linked" />
					</a>
					<p id="text">text</p>
				</div>
			</ImageZoomScope>,
		);
	});
	return container;
};

const click = async (element: Element | null) => {
	await act(async () => {
		element?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	});
};

describe("ImageZoomScope", () => {
	it("opens the lightbox on a markdown image and reports the open state", async () => {
		const changes: boolean[] = [];
		await renderScope((open) => changes.push(open));

		await click(document.getElementById("second"));

		expect(changes).toEqual([true]);
		expect(document.querySelector(".yarl__root")).not.toBeNull();
	});

	it("ignores clicks on linked images and on text", async () => {
		const changes: boolean[] = [];
		await renderScope((open) => changes.push(open));

		// jsdom cannot navigate; stop the anchor default so the run stays quiet.
		document.addEventListener("click", (event) => event.preventDefault());
		await click(document.getElementById("linked"));
		await click(document.getElementById("text"));

		expect(changes).toEqual([]);
		expect(document.querySelector(".yarl__root")).toBeNull();
	});

	it("closes on Escape and reports the closed state", async () => {
		const changes: boolean[] = [];
		await renderScope((open) => changes.push(open));
		await click(document.getElementById("first"));

		await act(async () => {
			// YARL listens for keys on its controller container (React onKeyDown), not on the root.
			const target = document.querySelector(".yarl__container") ?? document.body;
			target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			await new Promise((resolve) => window.setTimeout(resolve, 600));
		});

		expect(changes).toEqual([true, false]);
	});
});
