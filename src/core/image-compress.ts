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
			initJpegDecode(jpegModule),
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
		throw new ImageDecodeError(`Could not decode ${kind} image: ${error instanceof Error ? error.message : error}`);
	}
	if (!image) throw new ImageDecodeError(`Could not decode ${kind} image`);
	return image;
}

export async function compressImage(bytes: Uint8Array, options: CompressOptions): Promise<CompressResult> {
	const kind = detectImageKind(bytes);
	if (!kind) throw new UnsupportedImageError();
	const original: CompressResult = { bytes, extension: EXTENSION[kind], mime: MIME[kind], compressed: false };
	if (kind === "gif" || kind === "svg" || kind === "avif") return original;

	await ensureCodecs();
	let image = await decode(kind, bytes);
	const target = fitWithin(image.width, image.height, options.maxDimension);
	if (target.width !== image.width || target.height !== image.height) {
		image = await resize(image, target);
	}
	const encoded = new Uint8Array(await encodeWebp(image, { quality: Math.round(options.quality * 100) }));
	if (encoded.byteLength >= bytes.byteLength) return original;
	return { bytes: encoded, extension: "webp", mime: "image/webp", compressed: true };
}
