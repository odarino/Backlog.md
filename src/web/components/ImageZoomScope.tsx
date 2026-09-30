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
