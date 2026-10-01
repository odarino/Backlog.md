// The jsquash codecs construct ImageData. Some Bun versions have no global ImageData, so define a minimal one.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
	class ImageDataPolyfill {
		readonly data: Uint8ClampedArray;
		readonly width: number;
		readonly height: number;
		readonly colorSpace = "srgb";

		constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
			if (typeof dataOrWidth === "number") {
				this.width = dataOrWidth;
				this.height = widthOrHeight;
				this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
			} else {
				this.data = dataOrWidth;
				this.width = widthOrHeight;
				this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
			}
		}
	}
	(globalThis as { ImageData?: unknown }).ImageData = ImageDataPolyfill;
}
