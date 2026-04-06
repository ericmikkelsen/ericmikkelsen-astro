/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module "oxipng-wasm/oxipng_wasm_bg.js" {
	export const __wbg_set_wasm: (wasm: unknown) => void;
	export const encode: (pngBytes: Uint8Array, level?: number) => Uint8Array;
}
