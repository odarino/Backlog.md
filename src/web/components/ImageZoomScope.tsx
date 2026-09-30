import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
	const onOpenChangeRef = useRef(onOpenChange);
	const openRef = useRef(false);
	onOpenChangeRef.current = onOpenChange;

	// Parents keep state for the open lightbox; tell them it closed if this scope unmounts first.
	useEffect(
		() => () => {
			if (openRef.current) onOpenChangeRef.current?.(false);
		},
		[],
	);

	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		// The lightbox portal bubbles React events through this div; its own images are not inside .wmde-markdown.
		if (!isZoomableImage(event.target)) return;
		event.preventDefault();
		const result = collectZoomSlides(event.currentTarget, event.target);
		setSlides(result.slides);
		setIndex(result.index);
		openRef.current = true;
		onOpenChange?.(true);
	};

	const handleClose = () => {
		setIndex(null);
		openRef.current = false;
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
