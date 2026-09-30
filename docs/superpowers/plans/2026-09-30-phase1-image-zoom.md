# Phase 1: Image Zoom (Lightbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click any image in rendered task markdown (view mode, or the editor's live/preview pane) to open a full-screen lightbox with zoom, pan, and next/previous navigation across all images in the task.

**Architecture:** A pure helper (`src/web/lib/image-zoom.ts`) finds zoomable images in a DOM subtree. An `ImageZoomScope` component wraps a region, catches clicks on images with one delegated handler, and renders `ImageLightbox` (a thin wrapper over `yet-another-react-lightbox`). `Modal` gets a `suspendKeyHandling` prop so its document-level Escape/Tab handler does not steal keys from the lightbox.

**Tech Stack:** React 19, TypeScript, Bun test + jsdom, `yet-another-react-lightbox` 3.32.2 (Zoom + Counter plugins), Tailwind 4 CSS entry `src/web/styles/source.css`.

**Spec:** `docs/superpowers/specs/2026-09-30-images-workflow-publish-design.md`, section 1.

## Global Constraints

- Read `MANIFESTO.md` before starting. Do not edit it.
- Biome: tabs, double quotes. Bun test runner.
- No subtitles or helper text under headings or labels in the UI.
- Definition of done: `bunx tsc --noEmit`, `bun run check .`, `bun test` all pass.
- UI libraries are `devDependencies` (they are bundled into the binary).
- Fork commits: do not create tasks in the repo's `backlog/` folder (upstream owns those IDs and they would collide on merge). Use commit messages of the form `feat(zoom): <summary>`.

## Changes from the spec, found during planning

1. **Scope wrapper, not a hook inside `MermaidMarkdown`.** In edit mode the task modal uses `MDEditor` with `preview="edit"`. Its live/preview pane (toggled from the MDEditor toolbar) renders its own markdown, not `MermaidMarkdown`. A delegated click handler on a wrapper around the whole modal body catches both. Both renderers output a `.wmde-markdown` element, so the selector `.wmde-markdown img` covers both.
2. **`Modal` key handling conflict.** `Modal` registers a `keydown` listener on `document` in the capture phase. It calls `preventDefault()` + `stopPropagation()` on Escape, and traps Tab. The lightbox renders in a portal outside the dialog, so without a fix, Escape closes the task modal instead of the lightbox. Fix: new `suspendKeyHandling` prop.
3. **Images inside links are skipped.** `[![alt](img)](url)` keeps its link behavior.
4. **Docs and decisions:** only their view mode gets zoom (their edit mode has no preview pane by default). YAGNI.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/web/lib/image-zoom.ts` | Create | Pure DOM helpers: is this click target zoomable, collect slides + index |
| `src/web/lib/image-zoom.test.ts` | Create | Unit tests for the helpers (jsdom) |
| `src/web/components/ImageLightbox.tsx` | Create | Thin wrapper over `yet-another-react-lightbox` with our options |
| `src/web/components/ImageZoomScope.tsx` | Create | Delegated click handler + lightbox state for a region |
| `src/test/web-image-zoom-scope.test.tsx` | Create | Component test: click opens, link images and non-images ignored, Escape behavior with `Modal` |
| `src/web/components/Modal.tsx` | Modify | Add `suspendKeyHandling?: boolean` |
| `src/web/components/TaskDetailsModal.tsx` | Modify | Wrap modal body in `ImageZoomScope`, pass `suspendKeyHandling` |
| `src/web/components/DocumentationDetail.tsx` | Modify | Wrap preview `MermaidMarkdown` in `ImageZoomScope` |
| `src/web/components/DecisionDetail.tsx` | Modify | Wrap preview `MermaidMarkdown` in `ImageZoomScope` |
| `src/web/styles/source.css` | Modify | Import lightbox CSS, `cursor: zoom-in` rule |
| `package.json`, `bun.lock` | Modify | Add `yet-another-react-lightbox` |

---

### Task 1: Image collection helpers

**Files:**
- Create: `src/web/lib/image-zoom.ts`
- Test: `src/web/lib/image-zoom.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface ZoomSlide { src: string; alt?: string }`
  - `export const ZOOMABLE_IMAGE_SELECTOR = ".wmde-markdown img"`
  - `export function isZoomableImage(target: EventTarget | null): target is HTMLImageElement`
  - `export function collectZoomSlides(root: ParentNode, clicked: HTMLImageElement): { slides: ZoomSlide[]; index: number }`

- [ ] **Step 1: Write the failing test**

Create `src/web/lib/image-zoom.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { collectZoomSlides, isZoomableImage } from "./image-zoom";

const setup = (html: string) => {
	const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: "http://localhost:6420/" });
	return dom.window.document;
};

describe("isZoomableImage", () => {
	it("accepts an image inside rendered markdown", () => {
		const doc = setup(`<div class="wmde-markdown"><p><img id="a" src="/assets/a.png"></p></div>`);
		expect(isZoomableImage(doc.getElementById("a"))).toBe(true);
	});

	it("rejects an image outside rendered markdown", () => {
		const doc = setup(`<div><img id="a" src="/assets/a.png"></div>`);
		expect(isZoomableImage(doc.getElementById("a"))).toBe(false);
	});

	it("rejects an image wrapped in a link", () => {
		const doc = setup(`<div class="wmde-markdown"><a href="https://x.test"><img id="a" src="/a.png"></a></div>`);
		expect(isZoomableImage(doc.getElementById("a"))).toBe(false);
	});

	it("rejects non-image targets and null", () => {
		const doc = setup(`<div class="wmde-markdown"><p id="p">text</p></div>`);
		expect(isZoomableImage(doc.getElementById("p"))).toBe(false);
		expect(isZoomableImage(null)).toBe(false);
	});

	it("rejects an image with no src", () => {
		const doc = setup(`<div class="wmde-markdown"><img id="a"></div>`);
		expect(isZoomableImage(doc.getElementById("a"))).toBe(false);
	});
});

describe("collectZoomSlides", () => {
	it("returns every zoomable image under the root in DOM order with the clicked index", () => {
		const doc = setup(`
			<div id="root">
				<section><div class="wmde-markdown"><img src="/assets/one.png" alt="one"></div></section>
				<section><div class="wmde-markdown">
					<img id="two" src="/assets/two.png" alt="two">
					<a href="https://x.test"><img src="/assets/linked.png"></a>
				</div></section>
				<section><div class="wmde-markdown"><img src="/assets/three.png"></div></section>
				<img src="/assets/outside-markdown.png">
			</div>`);
		const root = doc.getElementById("root") as HTMLElement;
		const clicked = doc.getElementById("two") as HTMLImageElement;

		const result = collectZoomSlides(root, clicked);

		expect(result.slides).toEqual([
			{ src: "http://localhost:6420/assets/one.png", alt: "one" },
			{ src: "http://localhost:6420/assets/two.png", alt: "two" },
			{ src: "http://localhost:6420/assets/three.png", alt: undefined },
		]);
		expect(result.index).toBe(1);
	});

	it("counts nested .wmde-markdown wrappers once per image", () => {
		const doc = setup(`
			<div id="root"><div class="wmde-markdown"><div class="wmde-markdown">
				<img id="a" src="/a.png"><img src="/b.png">
			</div></div></div>`);
		const result = collectZoomSlides(
			doc.getElementById("root") as HTMLElement,
			doc.getElementById("a") as HTMLImageElement,
		);
		expect(result.slides).toHaveLength(2);
		expect(result.index).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/web/lib/image-zoom.test.ts`
Expected: FAIL, `Cannot find module './image-zoom'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/web/lib/image-zoom.ts`:

```ts
export interface ZoomSlide {
	src: string;
	alt?: string;
}

export const ZOOMABLE_IMAGE_SELECTOR = ".wmde-markdown img";

// Tag checks instead of instanceof: tests and portals can run elements from another window realm.
function isZoomableElement(element: Element): element is HTMLImageElement {
	return (
		element.tagName === "IMG" &&
		(element as HTMLImageElement).src !== "" &&
		element.closest(".wmde-markdown") !== null &&
		element.closest("a") === null
	);
}

export function isZoomableImage(target: EventTarget | null): target is HTMLImageElement {
	if (!target || typeof (target as Element).closest !== "function") {
		return false;
	}
	return isZoomableElement(target as Element);
}

export function collectZoomSlides(
	root: ParentNode,
	clicked: HTMLImageElement,
): { slides: ZoomSlide[]; index: number } {
	const images = Array.from(root.querySelectorAll<HTMLImageElement>(ZOOMABLE_IMAGE_SELECTOR)).filter(isZoomableElement);
	const slides = images.map((image) => ({ src: image.src, alt: image.getAttribute("alt") ?? undefined }));
	return { slides, index: Math.max(0, images.indexOf(clicked)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/web/lib/image-zoom.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/image-zoom.ts src/web/lib/image-zoom.test.ts
git commit -m "feat(zoom): add helpers to collect zoomable markdown images"
```

---

### Task 2: Lightbox dependency, `ImageLightbox`, `ImageZoomScope`

**Files:**
- Modify: `package.json`, `bun.lock` (via `bun add`)
- Modify: `src/web/styles/source.css:1-3`
- Create: `src/web/components/ImageLightbox.tsx`
- Create: `src/web/components/ImageZoomScope.tsx`
- Test: `src/test/web-image-zoom-scope.test.tsx`

**Interfaces:**
- Consumes: `ZoomSlide`, `isZoomableImage`, `collectZoomSlides` from `src/web/lib/image-zoom.ts` (Task 1).
- Produces:
  - `export default function ImageLightbox(props: { slides: ZoomSlide[]; index: number | null; onClose: () => void }): JSX.Element`
  - `export default function ImageZoomScope(props: { children: ReactNode; className?: string; onOpenChange?: (open: boolean) => void }): JSX.Element`
  - The scope root element has the class `image-zoom-scope`.

- [ ] **Step 1: Add the dependency**

Run: `bun add -d yet-another-react-lightbox@3.32.2`
Expected: `package.json` `devDependencies` contains `"yet-another-react-lightbox": "3.32.2"` and `bun.lock` changes. Keep the exact version (no `^`), like the other entries.

- [ ] **Step 2: Import the lightbox CSS**

In `src/web/styles/source.css`, after line 3 (`@import '@uiw/react-markdown-preview/markdown.css';`), add:

```css
@import 'yet-another-react-lightbox/styles.css';
@import 'yet-another-react-lightbox/plugins/counter.css';
```

At the end of the file, add:

```css
.image-zoom-scope .wmde-markdown img {
    cursor: zoom-in;
}

.image-zoom-scope .wmde-markdown a img {
    cursor: pointer;
}
```

- [ ] **Step 3: Write the failing component test**

Create `src/test/web-image-zoom-scope.test.tsx`:

```tsx
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
			const target = document.querySelector(".yarl__root") ?? document.body;
			target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			await new Promise((resolve) => window.setTimeout(resolve, 600));
		});

		expect(changes).toEqual([true, false]);
	});
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/test/web-image-zoom-scope.test.tsx`
Expected: FAIL, `Cannot find module '../web/components/ImageZoomScope'`.

- [ ] **Step 5: Create `ImageLightbox`**

Create `src/web/components/ImageLightbox.tsx`:

```tsx
import Lightbox from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import type { ZoomSlide } from "../lib/image-zoom";

interface Props {
	slides: ZoomSlide[];
	index: number | null;
	onClose: () => void;
}

export default function ImageLightbox({ slides, index, onClose }: Props) {
	const single = slides.length <= 1;
	return (
		<Lightbox
			open={index !== null}
			index={index ?? 0}
			close={onClose}
			slides={slides}
			plugins={[Zoom, Counter]}
			zoom={{ maxZoomPixelRatio: 8, scrollToZoom: true }}
			controller={{ closeOnBackdropClick: true }}
			carousel={{ finite: single }}
			render={{
				buttonPrev: single ? () => null : undefined,
				buttonNext: single ? () => null : undefined,
			}}
		/>
	);
}
```

- [ ] **Step 6: Create `ImageZoomScope`**

Create `src/web/components/ImageZoomScope.tsx`:

```tsx
import { type MouseEvent, type ReactNode, useState } from "react";
import { collectZoomSlides, isZoomableImage, type ZoomSlide } from "../lib/image-zoom";
import ImageLightbox from "./ImageLightbox";

interface Props {
	children: ReactNode;
	className?: string;
	onOpenChange?: (open: boolean) => void;
}

export default function ImageZoomScope({ children, className, onOpenChange }: Props) {
	const [slides, setSlides] = useState<ZoomSlide[]>([]);
	const [index, setIndex] = useState<number | null>(null);

	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		// The lightbox portal bubbles React events through this div; its own images are not inside .wmde-markdown.
		if (!isZoomableImage(event.target)) return;
		event.preventDefault();
		const result = collectZoomSlides(event.currentTarget, event.target);
		setSlides(result.slides);
		setIndex(result.index);
		onOpenChange?.(true);
	};

	const handleClose = () => {
		setIndex(null);
		onOpenChange?.(false);
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: delegated handler for images; markdown images are not keyboard targets.
		// biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only delegates image clicks.
		<div className={className ? `image-zoom-scope ${className}` : "image-zoom-scope"} onClick={handleClick}>
			{children}
			<ImageLightbox slides={slides} index={index} onClose={handleClose} />
		</div>
	);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test src/test/web-image-zoom-scope.test.tsx`
Expected: PASS, 3 tests.

If the Escape test fails only because the lightbox close animation is still running, raise the wait in the test to 1000 ms. If it still fails, read the YARL close flow (`node_modules/yet-another-react-lightbox/dist/index.js`, search `close`) and report the finding before changing the component. Do not add test-only branches to the component.

- [ ] **Step 8: Type check and full web tests**

Run: `bunx tsc --noEmit && bun test src/web src/test/web-image-zoom-scope.test.tsx`
Expected: no type errors; all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock src/web/styles/source.css src/web/components/ImageLightbox.tsx src/web/components/ImageZoomScope.tsx src/test/web-image-zoom-scope.test.tsx
git commit -m "feat(zoom): add image lightbox and delegated zoom scope"
```

---

### Task 3: `Modal` key handling suspension

**Files:**
- Modify: `src/web/components/Modal.tsx:3-12` (props), `:14-23` (destructure), `:24-31` (refs), `:44-46` (handler start)
- Test: `src/test/web-modal-suspend-keys.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `Modal` prop `suspendKeyHandling?: boolean`. When `true`, the document `keydown` handler returns at once: no Escape close, no Ctrl/Cmd+K focus, no Tab trap, no `preventDefault`/`stopPropagation`.

- [ ] **Step 1: Write the failing test**

Create `src/test/web-modal-suspend-keys.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/test/web-modal-suspend-keys.test.tsx`
Expected: FAIL. `tsc` would reject the unknown prop, and at runtime the second test gets `closed === 1`.

- [ ] **Step 3: Implement the prop**

In `src/web/components/Modal.tsx`:

Add to `interface ModalProps` after `initialFocusRef?`:

```ts
	suspendKeyHandling?: boolean; // when true, the document key handler steps aside (e.g. a lightbox is open)
```

Add `suspendKeyHandling,` to the destructured props after `initialFocusRef,`.

After `initialFocusRefRef.current = initialFocusRef;`, add:

```ts
	const suspendKeyHandlingRef = useRef(suspendKeyHandling);
	suspendKeyHandlingRef.current = suspendKeyHandling;
```

As the first statement inside `const handleKeyDown = (event: KeyboardEvent) => {`, add:

```ts
			if (suspendKeyHandlingRef.current) {
				return;
			}
```

The ref pattern matches the existing `disableEscapeCloseRef`: the effect keeps `[isOpen]` as its only dependency, so toggling the prop does not re-run focus logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/test/web-modal-suspend-keys.test.tsx src/test/web-task-details-modal-keyboard-shortcuts.test.tsx`
Expected: PASS (the second file proves existing modal shortcuts still work).

- [ ] **Step 5: Commit**

```bash
git add src/web/components/Modal.tsx src/test/web-modal-suspend-keys.test.tsx
git commit -m "feat(zoom): let Modal suspend its document key handler"
```

---

### Task 4: Wire zoom into task, documentation, and decision views

**Files:**
- Modify: `src/web/components/TaskDetailsModal.tsx:2` (already imports `useState`), imports near `:10`, state near other `useState` calls, `<Modal` props near `:1136`, children at `:1212` and `:1950`
- Modify: `src/web/components/DocumentationDetail.tsx:28-33`
- Modify: `src/web/components/DecisionDetail.tsx:33-37`
- Test: `src/test/web-task-details-image-zoom.test.tsx`

**Interfaces:**
- Consumes: `ImageZoomScope` (Task 2), `Modal` `suspendKeyHandling` (Task 3).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing integration test**

Create `src/test/web-task-details-image-zoom.test.tsx`. Copy the imports, `makeTask`, `detailOf`, `setupDom`, and `afterEach` blocks from `src/test/web-task-readiness-badge.test.tsx` lines 1-78 verbatim, then add to `setupDom` (at its end):

```ts
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
```

Then add:

```tsx
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
			const target = document.querySelector(".yarl__root") ?? document.body;
			target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
			await new Promise((resolve) => window.setTimeout(resolve, 600));
		});

		expect(modalClosed).toBe(0);
		expect(document.querySelector(".yarl__root")).toBeNull();
	});
});
```

`Task.description` is the field the modal reads for the description section (`TaskDetailsModal.tsx:694`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/test/web-task-details-image-zoom.test.tsx`
Expected: FAIL at `expect(document.querySelector(".yarl__root")).not.toBeNull()`.

- [ ] **Step 3: Wire `TaskDetailsModal`**

In `src/web/components/TaskDetailsModal.tsx`:

1. After the line `import MermaidMarkdown from './MermaidMarkdown';` add:

```tsx
import ImageZoomScope from './ImageZoomScope';
```

2. Next to the other `useState` hooks at the top of the component body, add:

```tsx
  const [lightboxOpen, setLightboxOpen] = useState(false);
```

3. On `<Modal`, after `disableEscapeClose={…}`, add:

```tsx
      suspendKeyHandling={lightboxOpen}
```

4. Wrap the modal children. Directly after the `>` that closes the `<Modal` opening tag (the line after `      }` that ends `actions`), insert:

```tsx
      <ImageZoomScope className="contents" onOpenChange={setLightboxOpen}>
```

and directly before `    </Modal>` (after `		</fieldset>`), insert:

```tsx
      </ImageZoomScope>
```

`contents` keeps the layout unchanged. Delegated clicks still bubble through a `display: contents` element.

- [ ] **Step 4: Wire `DocumentationDetail` and `DecisionDetail`**

In both files, add after `import MermaidMarkdown from './MermaidMarkdown';`:

```tsx
import ImageZoomScope from './ImageZoomScope';
```

In each preview branch, replace `<MermaidMarkdown source={value} />` with:

```tsx
<ImageZoomScope>
	<MermaidMarkdown source={value} />
</ImageZoomScope>
```

These pages are not inside `Modal`, so they need no `onOpenChange`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/test/web-task-details-image-zoom.test.tsx src/test/web-task-readiness-badge.test.tsx src/test/web-task-details-modal-keyboard-shortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 6: Manual check in the browser**

1. Put a test image in place: `mkdir -p backlog/assets/images/zoom-check && cp src/web/favicon.png backlog/assets/images/zoom-check/a.png`
2. Start the UI: `bun src/cli.ts browser --no-open` and open `http://localhost:6420`.
3. Open any task, click Edit, add two lines to the description: `![a](/assets/images/zoom-check/a.png)` twice. Do not save.
4. Switch the MDEditor toolbar to live preview. Click an image: the lightbox opens with "1 / 2". Wheel zooms, drag pans, arrow keys move, Escape closes the lightbox only; the task stays in edit mode with the unsaved text.
5. Cancel the edit. Remove the test image: `rm -r backlog/assets/images/zoom-check`.

- [ ] **Step 7: Definition of done**

Run: `bunx tsc --noEmit && bun run check . && bun test`
Expected: all pass. `bun run check .` must show no changes in files you did not touch.

- [ ] **Step 8: Commit**

```bash
git add src/web/components/TaskDetailsModal.tsx src/web/components/DocumentationDetail.tsx src/web/components/DecisionDetail.tsx src/test/web-task-details-image-zoom.test.tsx
git commit -m "feat(zoom): enable image zoom in task, documentation, and decision views"
```

---

## Notes for later phases

- `DocumentationDetail.tsx` and `DecisionDetail.tsx` each define a local `MarkdownEditor` component. The phase 3 editor wrapper must use a different name (for example `TaskMarkdownEditor.tsx`) to avoid confusion.
- Biome `files.includes` covers only `*.ts`, not `*.tsx`. `bun run check .` does not lint `.tsx` files. The `biome-ignore` comments in `ImageZoomScope.tsx` document intent for when that changes.
