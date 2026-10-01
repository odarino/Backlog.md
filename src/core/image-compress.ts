import "./image-data-polyfill.ts";
import jpegDecodeWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm" with { type: "file" };
import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode";
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };
import decodePng, { init as initPngDecode } from "@jsquash/png/decode";
import resize, { initResize } from "@jsquash/resize";
import resizeWasm from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm" with { type: "file" };
import webpDecodeWasm from "@jsquash/webp/codec/dec/webp_dec.wasm" with { type: "file" };
import webpEncodeWasm from "@jsquash/webp/codec/enc/webp_enc.wasm" with { type: "file" };
import webpEncodeSimdWasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm" with { type: "file" };
import decodeWebp, { init as initWebpDecode } from "@jsquash/webp/decode";
import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode";
import { simd } from "wasm-feature-detect";

export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "svg" | "avif";

export interface CompressOptions {
	maxDimension: number;
	quality: number;
}

export interface CompressResult {
	bytes: Uint8Array;
	extension: string;
	mime: string;
	compressed: boolean;
}

export class UnsupportedImageError extends Error {
	constructor(message = "Unsupported image type") {
		super(message);
		this.name = "UnsupportedImageError";
	}
}

export class ImageDecodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImageDecodeError";
	}
}

export const DEFAULT_IMAGE_MAX_DIMENSION = 1920;
export const DEFAULT_IMAGE_QUALITY = 0.8;
/** Decode and resize need several RGBA copies of the image; above this the WASM memory traps. */
export const MAX_IMAGE_PIXELS = 50_000_000;

const MIME: Record<ImageKind, string> = {
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
};

const EXTENSION: Record<ImageKind, string> = {
	jpeg: "jpg",
	png: "png",
	webp: "webp",
	gif: "gif",
	svg: "svg",
	avif: "avif",
};

const SVG_START = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s/>]/i;

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}

export function detectImageKind(bytes: Uint8Array): ImageKind | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
	if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
	if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif";
	if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
	if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) {
		return "avif";
	}
	const head = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^﻿/, "").trimStart();
	return SVG_START.test(head) ? "svg" : null;
}

const LABEL: Record<"jpeg" | "png" | "webp", string> = { jpeg: "JPEG", png: "PNG", webp: "WebP" };

function uint16BE(bytes: Uint8Array, at: number): number {
	return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function uint32BE(bytes: Uint8Array, at: number): number {
	return uint16BE(bytes, at) * 0x10000 + uint16BE(bytes, at + 2);
}

function uint24LE(bytes: Uint8Array, at: number): number {
	return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	let at = 2;
	while (at + 4 <= bytes.length) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1] ?? 0;
		if (marker === 0xff) {
			at += 1; // fill byte
			continue;
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2; // markers without a length
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return null; // EOI or SOS before any SOF
		const length = uint16BE(bytes, at + 2);
		if (length < 2) return null;
		// SOF0–SOF15, except DHT (C4), JPG (C8), and DAC (CC).
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			if (length < 7 || at + 9 > bytes.length) return null;
			return { width: uint16BE(bytes, at + 7), height: uint16BE(bytes, at + 5) };
		}
		at += 2 + length;
	}
	return null;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 24 || ascii(bytes, 12, 16) !== "IHDR") return null;
	return { width: uint32BE(bytes, 16), height: uint32BE(bytes, 20) };
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 30) return null;
	const chunk = ascii(bytes, 12, 16);
	if (chunk === "VP8 ") {
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
		return {
			width: ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff,
			height: ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff,
		};
	}
	if (chunk === "VP8L") {
		if (bytes[20] !== 0x2f) return null;
		const [b1, b2, b3, b4] = [bytes[21] ?? 0, bytes[22] ?? 0, bytes[23] ?? 0, bytes[24] ?? 0];
		return {
			width: 1 + (((b2 & 0x3f) << 8) | b1),
			height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
		};
	}
	if (chunk === "VP8X") {
		return { width: 1 + uint24LE(bytes, 24), height: 1 + uint24LE(bytes, 27) };
	}
	return null;
}

/** Read the width and height that the file header declares, without decoding. Null when unreadable. */
export function readImageDimensions(
	kind: "jpeg" | "png" | "webp",
	bytes: Uint8Array,
): { width: number; height: number } | null {
	const size = kind === "jpeg" ? jpegDimensions(bytes) : kind === "png" ? pngDimensions(bytes) : webpDimensions(bytes);
	return size && size.width > 0 && size.height > 0 ? size : null;
}

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= max) return { width, height };
	const scale = max / longest;
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function compressOptionsFromConfig(
	config: { imageMaxDimension?: number; imageQuality?: number } | null | undefined,
): CompressOptions {
	return {
		maxDimension: Math.round(clamp(config?.imageMaxDimension, 256, 8192, DEFAULT_IMAGE_MAX_DIMENSION)),
		quality: clamp(config?.imageQuality, 0.1, 1, DEFAULT_IMAGE_QUALITY),
	};
}

let codecsReady: Promise<void> | null = null;

async function compileWasm(path: string): Promise<WebAssembly.Module> {
	return WebAssembly.compile(await Bun.file(path).arrayBuffer());
}

// mozjpeg writes decoder diagnostics (for example "Premature end of JPEG file") to stderr. Collect them
// instead of printing, and attach them to the ImageDecodeError of a failed decode.
let codecMessages: string[] = [];
function collectCodecMessage(message: string): void {
	codecMessages.push(message);
}

// The .wasm files are embedded in the compiled binary; Bun.file reads them from the embedded paths.
function ensureCodecs(): Promise<void> {
	codecsReady ??= (async () => {
		// The WebP encoder picks its SIMD glue with the same check, so the module must match it.
		const encoderPath = (await simd()) ? webpEncodeSimdWasm : webpEncodeWasm;
		const [jpegModule, pngModule, webpDecodeModule, webpEncodeModule, resizeModule] = await Promise.all([
			compileWasm(jpegDecodeWasm),
			compileWasm(pngWasm),
			compileWasm(webpDecodeWasm),
			compileWasm(encoderPath),
			compileWasm(resizeWasm),
		]);
		await Promise.all([
			// The typings omit the (module, overrides) form that the runtime supports.
			(initJpegDecode as (module: unknown, overrides: object) => Promise<void>)(jpegModule, {
				print: collectCodecMessage,
				printErr: collectCodecMessage,
			}),
			initPngDecode(pngModule),
			initWebpDecode(webpDecodeModule),
			initWebpEncode(webpEncodeModule),
			initResize(resizeModule),
		]);
	})().catch((error) => {
		codecsReady = null;
		throw error;
	});
	return codecsReady;
}

async function decode(kind: "jpeg" | "png" | "webp", bytes: Uint8Array): Promise<ImageData> {
	const buffer = bytes.slice().buffer;
	let image: ImageData | null | undefined;
	codecMessages = [];
	try {
		if (kind === "jpeg") {
			// Despite its name, preserveOrientation: true applies the EXIF orientation to the pixels.
			image = await decodeJpeg(buffer, { preserveOrientation: true });
		} else if (kind === "png") {
			image = await decodePng(buffer);
		} else {
			image = await decodeWebp(buffer);
		}
	} catch (error) {
		const detail = codecMessages.length > 0 ? codecMessages.join("; ") : error instanceof Error ? error.message : error;
		throw new ImageDecodeError(`Could not decode ${kind} image: ${detail}`);
	}
	if (!image) throw new ImageDecodeError(`Could not decode ${kind} image`);
	return image;
}

export async function compressImage(bytes: Uint8Array, options: CompressOptions): Promise<CompressResult> {
	const kind = detectImageKind(bytes);
	if (!kind) throw new UnsupportedImageError();
	const original: CompressResult = { bytes, extension: EXTENSION[kind], mime: MIME[kind], compressed: false };
	if (kind === "gif" || kind === "svg" || kind === "avif") return original;

	const declared = readImageDimensions(kind, bytes);
	if (!declared) throw new ImageDecodeError(`Could not read the ${LABEL[kind]} image size`);
	if (declared.width * declared.height > MAX_IMAGE_PIXELS) {
		throw new ImageDecodeError(
			`The image is too large (${declared.width}x${declared.height} pixels, limit ${MAX_IMAGE_PIXELS} pixels)`,
		);
	}

	await ensureCodecs();
	let image = await decode(kind, bytes);
	let encoded: Uint8Array;
	try {
		const target = fitWithin(image.width, image.height, options.maxDimension);
		if (target.width !== image.width || target.height !== image.height) {
			image = await resize(image, target);
		}
		encoded = new Uint8Array(await encodeWebp(image, { quality: Math.round(options.quality * 100) }));
	} catch (error) {
		// A codec trap (for example out of WASM memory) is a problem with this image, not a server fault.
		throw new ImageDecodeError(
			`Could not process the ${LABEL[kind]} image: ${error instanceof Error ? error.message : error}`,
		);
	}
	if (encoded.byteLength >= bytes.byteLength) return original;
	return { bytes: encoded, extension: "webp", mime: "image/webp", compressed: true };
}
