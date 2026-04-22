/// <reference lib="webworker" />

/**
 * Dedicated worker that performs non-UI color processing tasks:
 * quantization, per-layer rendering, and PNG optimization.
 */

import wasmUrl from "oxipng-wasm/oxipng_wasm_bg.wasm?url";
import { __wbg_set_wasm, encode as wasmEncode } from "oxipng-wasm/oxipng_wasm_bg.js";
import initLibImageQuantWasm, { ImageQuantizer } from "libimagequant-wasm/wasm/libimagequant_wasm.js";
import libimagequantWasmUrl from "libimagequant-wasm/wasm/libimagequant_wasm_bg.wasm?url";

const MAX_PALETTE_SIZE = 32;
const BACKGROUND_SENTINEL_INDEX = 255;

// Message payload and protocol types

type QuantizePreviewPayload = {
    imageBitmap: ImageBitmap;
    colorCount: number;
    dithering: number;
    contrast: number;
    lightness: number;
    speckleCleanup: number;
    width: number;
    height: number;
    lockAspectRatio: boolean;
};

type RenderLayerInput = {
    paletteIndex: number;
    color: string;
    opacity: number;
    name?: string;
};

type RenderLayersPayload = {
    width: number;
    height: number;
    indexedPixels?: Uint16Array | ArrayBuffer;
    layers: RenderLayerInput[];
};

type OptimizePngPayload = {
    pngBytes: Uint8Array | ArrayBuffer;
    level?: number;
};

type WorkerRequestMessage =
    | {
          id: number;
          type: "quantize-preview";
          payload: QuantizePreviewPayload;
      }
    | {
          id: number;
          type: "render-layers";
          payload: RenderLayersPayload;
      }
    | {
          id: number;
          type: "optimize-png";
          payload: OptimizePngPayload;
      };

type WorkerSuccessMessage = {
    id: number;
    ok: true;
    result: unknown;
};

type WorkerErrorMessage = {
    id: number;
    ok: false;
    error: string;
};

// Worker-scoped runtime state

// Memoized wasm init promise prevents duplicate initialization work.
let oxiInitPromise: Promise<void> | null = null;
let liqInitPromise: Promise<void> | null = null;
let cachedIndexedPixels: Uint16Array | null = null;
let cachedIndexedPixelsWidth = 0;
let cachedIndexedPixelsHeight = 0;
let renderCanvas: OffscreenCanvas | null = null;
let renderGl: WebGLRenderingContext | null = null;
let renderWidth = 0;
let renderHeight = 0;

const workerScope = self as unknown as Worker;

/**
 * Handle request messages and return typed success/error payloads.
 */
workerScope.addEventListener("message", async (event: MessageEvent<WorkerRequestMessage>) => {
    const { id, type, payload } = event.data;

    try {
        if (type === "quantize-preview") {
            const result = await quantizePreview(payload);
            workerScope.postMessage(
                {
                    id,
                    ok: true,
                    result: {
                        width: result.width,
                        height: result.height,
                        palette: result.palette,
                        indexedPixels: result.indexedPixels.buffer,
                        quantizedRgba: result.quantizedRgba.buffer,
                    },
                } satisfies WorkerSuccessMessage,
                [result.indexedPixels.buffer, result.quantizedRgba.buffer]
            );
            return;
        }

        if (type === "render-layers") {
            const layerPngs = await renderLayers(payload);
            const transfer = layerPngs.map((bytes) => bytes.buffer);
            workerScope.postMessage(
                {
                    id,
                    ok: true,
                    result: {
                        layerPngs: transfer,
                    },
                } satisfies WorkerSuccessMessage,
                transfer
            );
            return;
        }

        if (type === "optimize-png") {
            const pngBytes =
                payload.pngBytes instanceof Uint8Array
                    ? payload.pngBytes
                    : new Uint8Array(payload.pngBytes);
            const optimizedBytes = await optimizePngWithOxi(pngBytes, payload.level || 2);
            workerScope.postMessage(
                {
                    id,
                    ok: true,
                    result: { optimizedBytes: optimizedBytes.buffer },
                } satisfies WorkerSuccessMessage,
                [optimizedBytes.buffer]
            );
            return;
        }

        throw new Error(`Unknown worker message type: ${type}`);
    } catch (error) {
        workerScope.postMessage({
            id,
            ok: false,
            error: error instanceof Error ? error.message : "Unknown worker error",
        } satisfies WorkerErrorMessage);
    }
});

/**
 * Build quantized preview data for settings UI.
 */
const quantizePreview = async ({
    imageBitmap,
    colorCount,
    dithering,
    contrast,
    lightness,
    speckleCleanup,
    width,
    height,
    lockAspectRatio,
}: QuantizePreviewPayload) => {
    const outputSize = getOutputSize({
        imageWidth: imageBitmap.width,
        imageHeight: imageBitmap.height,
        width,
        height,
        lockAspectRatio,
    });

    const sourceCanvas = new OffscreenCanvas(outputSize.width, outputSize.height);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) {
        throw new Error("Failed to create source 2D context for quantization.");
    }

    sourceContext.drawImage(imageBitmap, 0, 0, outputSize.width, outputSize.height);
    imageBitmap.close?.();
    const imageData = sourceContext.getImageData(0, 0, outputSize.width, outputSize.height);
    applyToneAdjustments(imageData.data, contrast, lightness);
    const backgroundMask = detectBackgroundMask(imageData.data, outputSize.width, outputSize.height);
    const quantizationSource = backgroundMask
        ? excludeBackgroundFromQuantization(imageData.data, backgroundMask)
        : imageData.data;

    const safeColorCount = clamp(colorCount, 1, MAX_PALETTE_SIZE);
    await initLibImageQuant();

    const quantizer = new ImageQuantizer();
    let quantResult: ReturnType<ImageQuantizer["quantizeImage"]> | null = null;

    try {
        quantizer.setMaxColors(safeColorCount);
        quantizer.setSpeed(3);
        quantizer.setQuality(0, 100);

        quantResult = quantizer.quantizeImage(quantizationSource, outputSize.width, outputSize.height);
        quantResult.setDithering(clamp(dithering, 0, 1));

        const paletteRgba = quantResult.getPalette() as number[][];
        const paletteIndices = quantResult.getPaletteIndices(
            quantizationSource,
            outputSize.width,
            outputSize.height
        );
        const cleanedIndices = applySpeckleCleanup(
            backgroundMask
                ? applyBackgroundMaskToIndices(paletteIndices, backgroundMask)
                : paletteIndices,
            outputSize.width,
            outputSize.height,
            speckleCleanup
        );

        const palette = paletteRgba.map((entry) => [entry[0], entry[1], entry[2]]);
        const indexedPixels = new Uint16Array(cleanedIndices.length);
        const quantizedRgba = new Uint8ClampedArray(cleanedIndices.length * 4);

        for (let i = 0; i < cleanedIndices.length; i += 1) {
            const paletteIndex = cleanedIndices[i];
            const [r, g, b, a] =
                paletteRgba[paletteIndex] ||
                (backgroundMask?.[i]
                    ? [255, 255, 255, 0]
                    : [0, 0, 0, 255]);
            indexedPixels[i] = paletteIndex;
            const pixelOffset = i * 4;
            quantizedRgba[pixelOffset] = r;
            quantizedRgba[pixelOffset + 1] = g;
            quantizedRgba[pixelOffset + 2] = b;
            quantizedRgba[pixelOffset + 3] = a;
        }

        return {
            width: outputSize.width,
            height: outputSize.height,
            palette,
            indexedPixels,
            quantizedRgba,
        };
    } finally {
        quantResult?.free();
        quantizer.free();
    }
};

const applyToneAdjustments = (
    rgba: Uint8ClampedArray,
    contrast: number,
    lightness: number
): void => {
    const clampedContrast = clamp(contrast, 0, 2);
    const offset = clamp(lightness, -100, 100);

    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = clamp(Math.round((rgba[i] - 128) * clampedContrast + 128 + offset), 0, 255);
        rgba[i + 1] = clamp(Math.round((rgba[i + 1] - 128) * clampedContrast + 128 + offset), 0, 255);
        rgba[i + 2] = clamp(Math.round((rgba[i + 2] - 128) * clampedContrast + 128 + offset), 0, 255);
    }
};

const detectBackgroundMask = (
    rgba: Uint8ClampedArray,
    width: number,
    height: number
): Uint8Array | null => {
    if (width < 2 || height < 2) {
        return null;
    }

    const edgePixels: number[] = [];
    const pushPixel = (x: number, y: number): void => {
        edgePixels.push((y * width + x) * 4);
    };

    for (let x = 0; x < width; x += 1) {
        pushPixel(x, 0);
        pushPixel(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
        pushPixel(0, y);
        pushPixel(width - 1, y);
    }

    let candidateCount = 0;
    let redTotal = 0;
    let greenTotal = 0;
    let blueTotal = 0;

    for (const offset of edgePixels) {
        const alpha = rgba[offset + 3];
        if (alpha < 200) {
            continue;
        }
        const red = rgba[offset];
        const green = rgba[offset + 1];
        const blue = rgba[offset + 2];
        const maxChannel = Math.max(red, green, blue);
        const minChannel = Math.min(red, green, blue);
        if (maxChannel < 170 || maxChannel - minChannel > 48) {
            continue;
        }

        candidateCount += 1;
        redTotal += red;
        greenTotal += green;
        blueTotal += blue;
    }

    if (candidateCount < edgePixels.length * 0.2) {
        return null;
    }

    const backgroundColor: [number, number, number] = [
        Math.round(redTotal / candidateCount),
        Math.round(greenTotal / candidateCount),
        Math.round(blueTotal / candidateCount),
    ];

    const mask = new Uint8Array(width * height);
    let maskedCount = 0;

    for (let i = 0; i < width * height; i += 1) {
        const offset = i * 4;
        const alpha = rgba[offset + 3];
        if (alpha < 200) {
            continue;
        }
        const red = rgba[offset];
        const green = rgba[offset + 1];
        const blue = rgba[offset + 2];
        const maxChannel = Math.max(red, green, blue);
        const minChannel = Math.min(red, green, blue);
        const distance = Math.abs(red - backgroundColor[0]) + Math.abs(green - backgroundColor[1]) + Math.abs(blue - backgroundColor[2]);
        if (maxChannel >= 160 && maxChannel - minChannel <= 60 && distance <= 72) {
            mask[i] = 1;
            maskedCount += 1;
        }
    }

    if (maskedCount < width * height * 0.03) {
        return null;
    }

    return mask;
};

const excludeBackgroundFromQuantization = (
    rgba: Uint8ClampedArray,
    backgroundMask: Uint8Array
): Uint8ClampedArray => {
    const masked = new Uint8ClampedArray(rgba);

    for (let i = 0; i < backgroundMask.length; i += 1) {
        if (backgroundMask[i] !== 1) {
            continue;
        }
        const offset = i * 4;
        masked[offset] = 255;
        masked[offset + 1] = 255;
        masked[offset + 2] = 255;
        masked[offset + 3] = 0;
    }

    return masked;
};

const applyBackgroundMaskToIndices = (
    indices: ArrayLike<number>,
    backgroundMask: Uint8Array
): Uint16Array => {
    const maskedIndices = new Uint16Array(indices.length);

    for (let i = 0; i < indices.length; i += 1) {
        maskedIndices[i] = backgroundMask[i] === 1 ? BACKGROUND_SENTINEL_INDEX : indices[i];
    }

    return maskedIndices;
};

/**
 * Remove tiny isolated color islands from indexed pixels.
 * Strength 0 disables cleanup; higher values run more passes and replace less-supported pixels.
 */
const applySpeckleCleanup = (
    indices: ArrayLike<number>,
    width: number,
    height: number,
    strength: number
): Uint16Array => {
    const clampedStrength = clamp(strength, 0, 100);
    const base = new Uint16Array(indices.length);
    for (let i = 0; i < indices.length; i += 1) {
        base[i] = indices[i];
    }

    if (clampedStrength === 0 || width < 3 || height < 3) {
        return base;
    }

    const normalized = clampedStrength / 100;
    const passes = normalized < 0.34 ? 1 : normalized < 0.67 ? 2 : 3;
    const isolationThreshold = normalized < 0.34 ? 1 : normalized < 0.67 ? 2 : 3;
    const minMajority = normalized < 0.5 ? 3 : 2;

    let source = base;
    let target = new Uint16Array(base.length);

    const neighborCounts = new Uint8Array(MAX_PALETTE_SIZE);
    const touched = new Uint8Array(8);

    for (let pass = 0; pass < passes; pass += 1) {
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = y * width + x;
                const center = source[index];

                if (center === BACKGROUND_SENTINEL_INDEX) {
                    target[index] = center;
                    continue;
                }

                let sameNeighborCount = 0;
                let touchedCount = 0;
                let bestColor = center;
                let bestCount = 0;

                for (let oy = -1; oy <= 1; oy += 1) {
                    for (let ox = -1; ox <= 1; ox += 1) {
                        if (ox === 0 && oy === 0) {
                            continue;
                        }
                        const nx = x + ox;
                        const ny = y + oy;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                            continue;
                        }

                        const neighbor = source[ny * width + nx];
                        if (neighbor === BACKGROUND_SENTINEL_INDEX) {
                            continue;
                        }
                        if (neighbor === center) {
                            sameNeighborCount += 1;
                        }

                        if (neighbor < MAX_PALETTE_SIZE) {
                            if (neighborCounts[neighbor] === 0 && touchedCount < touched.length) {
                                touched[touchedCount] = neighbor;
                                touchedCount += 1;
                            }
                            neighborCounts[neighbor] += 1;
                            if (neighborCounts[neighbor] > bestCount) {
                                bestCount = neighborCounts[neighbor];
                                bestColor = neighbor;
                            }
                        }
                    }
                }

                if (
                    sameNeighborCount <= isolationThreshold &&
                    bestColor !== center &&
                    bestCount >= minMajority
                ) {
                    target[index] = bestColor;
                } else {
                    target[index] = center;
                }

                for (let touchedIndex = 0; touchedIndex < touchedCount; touchedIndex += 1) {
                    neighborCounts[touched[touchedIndex]] = 0;
                }
            }
        }

        const temp = source;
        source = target;
        target = temp;
    }

    return source;
};

const initLibImageQuant = async (): Promise<void> => {
    if (liqInitPromise) {
        return liqInitPromise;
    }

    liqInitPromise = (async () => {
        await initLibImageQuantWasm({ module_or_path: libimagequantWasmUrl });
    })();

    return liqInitPromise;
};

/**
 * Render one PNG per logical layer from indexed image data.
 */
const renderLayers = async ({ width, height, indexedPixels, layers }: RenderLayersPayload): Promise<Uint8Array[]> => {
    let indexData: Uint16Array;
    if (indexedPixels) {
        indexData = indexedPixels instanceof Uint16Array ? indexedPixels : new Uint16Array(indexedPixels);
        cachedIndexedPixels = indexData;
        cachedIndexedPixelsWidth = width;
        cachedIndexedPixelsHeight = height;
    } else if (
        cachedIndexedPixels &&
        cachedIndexedPixelsWidth === width &&
        cachedIndexedPixelsHeight === height
    ) {
        indexData = cachedIndexedPixels;
    } else {
        throw new Error("Missing indexed pixel buffer for layer rendering.");
    }

    const { canvas, gl } = getRenderSurface(width, height);

    const vertexSource = `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
            v_uv = (a_position + 1.0) * 0.5;
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `;

    const fragmentSource = `
        precision mediump float;
        varying vec2 v_uv;
        uniform sampler2D u_indexTexture;
        uniform float u_targetIndex;
        uniform vec3 u_layerColor;
        uniform float u_layerAlpha;
        void main() {
            float sampled = texture2D(u_indexTexture, v_uv).r * 255.0;
            float alpha = abs(sampled - u_targetIndex) < 0.5 ? 1.0 : 0.0;
            gl_FragColor = vec4(u_layerColor, alpha * u_layerAlpha);
        }
    `;

    const program = buildProgram(gl, vertexSource, fragmentSource);
    if (!program) {
        throw new Error("Failed to build WebGL program for layer rendering.");
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const indexTextureLocation = gl.getUniformLocation(program, "u_indexTexture");
    const targetIndexLocation = gl.getUniformLocation(program, "u_targetIndex");
    const layerColorLocation = gl.getUniformLocation(program, "u_layerColor");
    const layerAlphaLocation = gl.getUniformLocation(program, "u_layerAlpha");

    if (
        !Number.isInteger(positionLocation) ||
        !indexTextureLocation ||
        !targetIndexLocation ||
        !layerColorLocation ||
        !layerAlphaLocation
    ) {
        throw new Error("Failed to resolve WebGL locations for layer rendering.");
    }

    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) {
        throw new Error("Failed to create WebGL position buffer for layer rendering.");
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
    );

    const texture = gl.createTexture();
    if (!texture) {
        throw new Error("Failed to create WebGL index texture for layer rendering.");
    }

    const supportsLuminanceTexture = typeof gl.LUMINANCE === "number";
    const textureBytes = supportsLuminanceTexture
        ? new Uint8Array(width * height)
        : new Uint8Array(width * height * 4);

    if (supportsLuminanceTexture) {
        for (let i = 0; i < indexData.length; i += 1) {
            textureBytes[i] = indexData[i];
        }
    } else {
        for (let i = 0; i < indexData.length; i += 1) {
            const pixelOffset = i * 4;
            const indexValue = indexData[i];
            textureBytes[pixelOffset] = indexValue;
            textureBytes[pixelOffset + 1] = 0;
            textureBytes[pixelOffset + 2] = 0;
            textureBytes[pixelOffset + 3] = 255;
        }
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (supportsLuminanceTexture) {
        // LUMINANCE is 1 byte per pixel, so rows may not be 4-byte aligned.
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.LUMINANCE,
            width,
            height,
            0,
            gl.LUMINANCE,
            gl.UNSIGNED_BYTE,
            textureBytes
        );
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    } else {
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            width,
            height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            textureBytes
        );
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.useProgram(program);
    gl.viewport(0, 0, width, height);
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(indexTextureLocation, 0);

    const layerPngs: Uint8Array[] = [];
    try {
        for (const layer of layers) {
            const [r, g, b] = hexToRgb(layer.color);
            gl.useProgram(program);
            gl.uniform1f(targetIndexLocation, layer.paletteIndex);
            gl.uniform3f(layerColorLocation, r / 255, g / 255, b / 255);
            gl.uniform1f(layerAlphaLocation, clamp(layer.opacity, 0, 100) / 100);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            const blob = await canvas.convertToBlob({ type: "image/png" });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            layerPngs.push(bytes);
        }
    } finally {
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        gl.deleteProgram(program);
    }

    return layerPngs;
};

const getRenderSurface = (
    width: number,
    height: number
): { canvas: OffscreenCanvas; gl: WebGLRenderingContext } => {
    if (renderCanvas && renderGl && renderWidth === width && renderHeight === height) {
        return { canvas: renderCanvas, gl: renderGl };
    }

    if (renderGl) {
        const loseContext = renderGl.getExtension("WEBGL_lose_context");
        loseContext?.loseContext();
    }

    renderCanvas = new OffscreenCanvas(width, height);
    renderGl = renderCanvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!renderGl) {
        renderCanvas = null;
        throw new Error("WebGL is required for layer rendering.");
    }

    renderWidth = width;
    renderHeight = height;
    return { canvas: renderCanvas, gl: renderGl };
};

/**
 * Optimize PNG bytes after ensuring wasm runtime is initialized.
 */
const optimizePngWithOxi = async (pngBytes: Uint8Array, level = 2): Promise<Uint8Array> => {
    await initOxipng();
    return wasmEncode(pngBytes, level);
};

/**
 * Initialize wasm bindings once for the worker lifetime.
 */
const initOxipng = async (): Promise<void> => {
    if (oxiInitPromise) {
        return oxiInitPromise;
    }

    oxiInitPromise = (async () => {
        const response = await fetch(wasmUrl);
        if (!response.ok) {
            throw new Error(
                `Failed to initialize oxipng wasm from ${response.url || wasmUrl}: ${response.status} ${response.statusText}`,
            );
        }
        const wasmBytes = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(wasmBytes, {});
        __wbg_set_wasm(instance.exports as Parameters<typeof __wbg_set_wasm>[0]);
    })();

    return oxiInitPromise;
};

/**
 * Compute output dimensions from user settings.
 */
const getOutputSize = ({
    imageWidth,
    imageHeight,
    width,
    height,
    lockAspectRatio,
}: {
    imageWidth: number;
    imageHeight: number;
    width: number;
    height: number;
    lockAspectRatio: boolean;
}): { width: number; height: number } => {
    if (!width && !height) {
        return { width: imageWidth, height: imageHeight };
    }
    if (!lockAspectRatio) {
        return {
            width: Math.max(1, width || imageWidth),
            height: Math.max(1, height || imageHeight),
        };
    }
    if (width && !height) {
        return {
            width,
            height: Math.max(1, Math.round((imageHeight / imageWidth) * width)),
        };
    }
    if (!width && height) {
        return {
            width: Math.max(1, Math.round((imageWidth / imageHeight) * height)),
            height,
        };
    }
    return { width: Math.max(1, width), height: Math.max(1, height) };
};

/**
 * Compile and link a shader program.
 */
const buildProgram = (
    gl: WebGLRenderingContext,
    vertexSource: string,
    fragmentSource: string
): WebGLProgram | null => {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) {
        if (vertexShader) {
            gl.deleteShader(vertexShader);
        }
        if (fragmentShader) {
            gl.deleteShader(fragmentShader);
        }
        return null;
    }

    const program = gl.createProgram();
    if (!program) {
        return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
    }

    return program;
};

/**
 * Compile a single shader stage.
 */
const compileShader = (
    gl: WebGLRenderingContext,
    type: number,
    source: string
): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) {
        return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        return null;
    }

    return shader;
};

/**
 * Convert a hex color string into RGB tuple.
 */
const hexToRgb = (hex: string): [number, number, number] => {
    const safeHex = hex.replace("#", "");
    return [
        Number.parseInt(safeHex.slice(0, 2), 16),
        Number.parseInt(safeHex.slice(2, 4), 16),
        Number.parseInt(safeHex.slice(4, 6), 16),
    ];
};

/**
 * Constrain a value within an inclusive range.
 */
const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
};
