import "../core/image-data-polyfill.ts";
import jpegEncodeWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm" with { type: "file" };
import encodeJpeg, { init as initJpegEncode } from "@jsquash/jpeg/encode";
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };
import encodePng, { init as initPngEncode } from "@jsquash/png/encode";

let encodersReady: Promise<void> | null = null;

async function compileWasm(path: string): Promise<WebAssembly.Module> {
	return WebAssembly.compile(await Bun.file(path).arrayBuffer());
}

function ensureEncoders(): Promise<void> {
	encodersReady ??= (async () => {
		const [jpegModule, pngModule] = await Promise.all([compileWasm(jpegEncodeWasm), compileWasm(pngWasm)]);
		await initJpegEncode(jpegModule);
		await initPngEncode(pngModule);
	})();
	return encodersReady;
}

/** Deterministic gradient with seeded noise; noise makes the JPEG large enough to shrink. */
export function syntheticImage(width: number, height: number, noise = 24): ImageData {
	const data = new Uint8ClampedArray(width * height * 4);
	let seed = 1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			const n = noise > 0 ? (seed >>> 24) % noise : 0;
			const i = (y * width + x) * 4;
			data[i] = ((x * 255) / width + n) | 0;
			data[i + 1] = ((y * 255) / height + n) | 0;
			data[i + 2] = (((x + y) * 127) / (width + height) + n) | 0;
			data[i + 3] = 255;
		}
	}
	return new ImageData(data, width, height);
}

export async function jpegFixture(
	width: number,
	height: number,
	opts: { quality?: number; noise?: number } = {},
): Promise<Uint8Array> {
	await ensureEncoders();
	const encoded = await encodeJpeg(syntheticImage(width, height, opts.noise ?? 24), { quality: opts.quality ?? 95 });
	return new Uint8Array(encoded);
}

export async function pngFixture(width: number, height: number): Promise<Uint8Array> {
	await ensureEncoders();
	return new Uint8Array(await encodePng(syntheticImage(width, height)));
}

/** Insert an APP1 EXIF segment with one Orientation tag right after the JPEG SOI marker. */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
	const tiff = new Uint8Array([
		0x4d,
		0x4d,
		0x00,
		0x2a,
		0x00,
		0x00,
		0x00,
		0x08, // "MM", 42, IFD0 at offset 8
		0x00,
		0x01, // 1 entry
		0x01,
		0x12,
		0x00,
		0x03,
		0x00,
		0x00,
		0x00,
		0x01, // tag 0x0112 Orientation, SHORT, count 1
		0x00,
		orientation,
		0x00,
		0x00, // value
		0x00,
		0x00,
		0x00,
		0x00, // next IFD
	]);
	const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
	const length = 2 + exifHeader.length + tiff.length;
	const segment = new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...exifHeader, ...tiff]);
	const out = new Uint8Array(jpeg.length + segment.length);
	out.set(jpeg.subarray(0, 2), 0);
	out.set(segment, 2);
	out.set(jpeg.subarray(2), 2 + segment.length);
	return out;
}
