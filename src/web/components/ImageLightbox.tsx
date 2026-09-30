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
		// Portal events bubble through React ancestors; stopping here keeps lightbox keys from document listeners.
		// biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only stops key events from leaving the lightbox.
		<div className="contents" onKeyDown={(event) => event.stopPropagation()}>
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
		</div>
	);
}
