import { describe, expect, it } from "bun:test";
import decodeWebp from "@jsquash/webp/decode";
import encodeWebp from "@jsquash/webp/encode";
import {
	compressImage,
	compressOptionsFromConfig,
	detectImageKind,
	fitWithin,
	ImageDecodeError,
	MAX_IMAGE_PIXELS,
	readImageDimensions,
	UnsupportedImageError,
} from "../core/image-compress.ts";
import { jpegFixture, pngFixture, syntheticImage, withExifOrientation } from "./image-fixtures.ts";

const ascii = (text: string) => new TextEncoder().encode(text);
const webpSize = async (bytes: Uint8Array) => {
	const image = await decodeWebp(bytes.slice().buffer);
	return { width: image.width, height: image.height };
};

describe("detectImageKind", () => {
	it("detects formats by magic bytes", async () => {
		expect(detectImageKind(await jpegFixture(8, 8))).toBe("jpeg");
		expect(detectImageKind(await pngFixture(8, 8))).toBe("png");
		expect(detectImageKind(ascii("GIF89a....."))).toBe("gif");
		expect(detectImageKind(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("webp");
		expect(detectImageKind(ascii("\u0000\u0000\u0000\u001cftypavif"))).toBe("avif");
		expect(detectImageKind(ascii('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
		expect(detectImageKind(ascii("<svg viewBox='0 0 1 1'/>"))).toBe("svg");
	});

	it("returns null for anything else", () => {
		expect(detectImageKind(ascii("hello world"))).toBeNull();
		expect(detectImageKind(new Uint8Array())).toBeNull();
		expect(detectImageKind(ascii("<html><svg></svg></html>"))).toBeNull();
	});
});

describe("fitWithin", () => {
	it("keeps images that already fit", () => {
		expect(fitWithin(800, 600, 1920)).toEqual({ width: 800, height: 600 });
	});

	it("scales the longest side down to the maximum", () => {
		expect(fitWithin(4000, 2000, 1920)).toEqual({ width: 1920, height: 960 });
		expect(fitWithin(1000, 3000, 1500)).toEqual({ width: 500, height: 1500 });
	});
});

describe("compressOptionsFromConfig", () => {
	it("uses defaults when keys are missing", () => {
		expect(compressOptionsFromConfig(undefined)).toEqual({ maxDimension: 1920, quality: 0.8 });
	});

	it("clamps values to the allowed ranges", () => {
		expect(compressOptionsFromConfig({ imageMaxDimension: 10, imageQuality: 5 })).toEqual({
			maxDimension: 256,
			quality: 1,
		});
		expect(compressOptionsFromConfig({ imageMaxDimension: 99999, imageQuality: 0 })).toEqual({
			maxDimension: 8192,
			quality: 0.1,
		});
		expect(compressOptionsFromConfig({ imageMaxDimension: Number.NaN })).toEqual({ maxDimension: 1920, quality: 0.8 });
	});
});

/** Patch the IHDR width and height of a PNG. The CRC stays stale: the header check runs before decode. */
const withPngSize = (png: Uint8Array, width: number, height: number) => {
	const out = png.slice();
	const view = new DataView(out.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return out;
};

describe("readImageDimensions", () => {
	it("reads the declared size of JPEG, PNG, and WebP files", async () => {
		expect(readImageDimensions("jpeg", await jpegFixture(320, 200))).toEqual({ width: 320, height: 200 });
		// The EXIF segment comes before the SOF marker; the header holds the stored (not rotated) size.
		const rotated = withExifOrientation(await jpegFixture(1200, 600), 6);
		expect(readImageDimensions("jpeg", rotated)).toEqual({ width: 1200, height: 600 });
		expect(readImageDimensions("png", await pngFixture(640, 480))).toEqual({ width: 640, height: 480 });
		const lossy = (await compressImage(await pngFixture(300, 150), { maxDimension: 1920, quality: 0.8 })).bytes;
		expect(readImageDimensions("webp", lossy)).toEqual({ width: 300, height: 150 });
		const lossless = new Uint8Array(await encodeWebp(syntheticImage(70, 33), { lossless: 1 }));
		expect(readImageDimensions("webp", lossless)).toEqual({ width: 70, height: 33 });
	});

	it("returns null when the header is cut short", () => {
		expect(readImageDimensions("jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]))).toBeNull();
		expect(readImageDimensions("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
		expect(readImageDimensions("webp", ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBeNull();
	});
});

describe("compressImage", () => {
	it("rejects an image that declares too many pixels before it decodes it", async () => {
		const bomb = withPngSize(await pngFixture(16, 16), 12000, 12000);
		expect(12000 * 12000).toBeGreaterThan(MAX_IMAGE_PIXELS);
		const error = await compressImage(bomb, { maxDimension: 1920, quality: 0.8 }).catch((e) => e);
		expect(error).toBeInstanceOf(ImageDecodeError);
		expect((error as Error).message).toContain("too large");
		expect((error as Error).message).toContain("12000x12000");
	});

	it("resizes a large JPEG and encodes a smaller WebP", async () => {
		const input = await jpegFixture(2400, 1600);
		const result = await compressImage(input, { maxDimension: 1920, quality: 0.8 });
		expect(result.compressed).toBe(true);
		expect(result.extension).toBe("webp");
		expect(result.mime).toBe("image/webp");
		expect(result.bytes.byteLength).toBeLessThan(input.byteLength);
		expect(await webpSize(result.bytes)).toEqual({ width: 1920, height: 1280 });
	});

	it("compresses a PNG", async () => {
		const input = await pngFixture(1200, 800);
		const result = await compressImage(input, { maxDimension: 1920, quality: 0.8 });
		expect(result.compressed).toBe(true);
		expect(await webpSize(result.bytes)).toEqual({ width: 1200, height: 800 });
	});

	it("applies the EXIF orientation of a JPEG", async () => {
		const input = withExifOrientation(await jpegFixture(1200, 600), 6);
		const result = await compressImage(input, { maxDimension: 4096, quality: 0.8 });
		expect(result.compressed).toBe(true);
		expect(await webpSize(result.bytes)).toEqual({ width: 600, height: 1200 });
	});

	it("keeps the original bytes when the WebP is not smaller", async () => {
		// A 1x3 PNG is tiny: its lossy WebP is larger (measured: 114 bytes vs 83 bytes, about 1.37x).
		const input = await pngFixture(1, 3);
		const result = await compressImage(input, { maxDimension: 1920, quality: 1 });
		const webp = new Uint8Array(await encodeWebp(syntheticImage(1, 3), { quality: 100 }));
		expect(webp.byteLength).toBeGreaterThan(input.byteLength);
		expect(result.compressed).toBe(false);
		expect(result.extension).toBe("png");
		expect(result.bytes).toEqual(input);
	});

	it("passes GIF, SVG, and AVIF through unchanged", async () => {
		const gif = ascii("GIF89a-animated");
		expect(await compressImage(gif, { maxDimension: 1920, quality: 0.8 })).toEqual({
			bytes: gif,
			extension: "gif",
			mime: "image/gif",
			compressed: false,
		});
		const svg = ascii("<svg xmlns='http://www.w3.org/2000/svg'/>");
		expect((await compressImage(svg, { maxDimension: 1920, quality: 0.8 })).extension).toBe("svg");
		const avif = ascii("\u0000\u0000\u0000\u001cftypavif-data");
		expect((await compressImage(avif, { maxDimension: 1920, quality: 0.8 })).extension).toBe("avif");
	});

	it("rejects a corrupt JPEG with ImageDecodeError", async () => {
		const corrupt = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
		const error = await compressImage(corrupt, { maxDimension: 1920, quality: 0.8 }).catch((e) => e);
		expect(error).toBeInstanceOf(ImageDecodeError);
		expect((error as Error).message).toContain("JPEG");
	});

	it("rejects unknown data with UnsupportedImageError", async () => {
		await expect(compressImage(ascii("not an image"), { maxDimension: 1920, quality: 0.8 })).rejects.toBeInstanceOf(
			UnsupportedImageError,
		);
	});
});
