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
