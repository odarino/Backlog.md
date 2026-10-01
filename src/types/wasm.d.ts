declare module "*.wasm" {
	const path: string;
	export default path;
}

// These packages ship a sibling .wasm.d.ts (wasm-bindgen exports) that wins over the wildcard above.
declare module "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" {
	const path: string;
	export default path;
}

declare module "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm" {
	const path: string;
	export default path;
}
