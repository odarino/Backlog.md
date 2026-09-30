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

export function collectZoomSlides(root: ParentNode, clicked: HTMLImageElement): { slides: ZoomSlide[]; index: number } {
	const images = Array.from(root.querySelectorAll<HTMLImageElement>(ZOOMABLE_IMAGE_SELECTOR)).filter(isZoomableElement);
	const slides = images.map((image) => ({ src: image.src, alt: image.getAttribute("alt") ?? undefined }));
	return { slides, index: Math.max(0, images.indexOf(clicked)) };
}
