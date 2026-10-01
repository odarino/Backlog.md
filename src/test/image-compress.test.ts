import { describe, expect, it } from "bun:test";
import decodeWebp from "@jsquash/webp/decode";
import {
	compressImage,
	compressOptionsFromConfig,
	detectImageKind,
	fitWithin,
	ImageDecodeError,
	UnsupportedImageError,
} from "../core/image-compress.ts";
import { jpegFixture, pngFixture, withExifOrientation } from "./image-fixtures.ts";

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

describe("compressImage", () => {
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
		const input = await jpegFixture(128, 128, { quality: 10, noise: 255 });
		const result = await compressImage(input, { maxDimension: 1920, quality: 1 });
		expect(result.compressed).toBe(false);
		expect(result.extension).toBe("jpg");
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
		await expect(compressImage(corrupt, { maxDimension: 1920, quality: 0.8 })).rejects.toBeInstanceOf(ImageDecodeError);
	});

	it("rejects unknown data with UnsupportedImageError", async () => {
		await expect(compressImage(ascii("not an image"), { maxDimension: 1920, quality: 0.8 })).rejects.toBeInstanceOf(
			UnsupportedImageError,
		);
	});
});
