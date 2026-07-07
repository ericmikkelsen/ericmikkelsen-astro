/// <reference lib="webworker" />

/**
 * Dedicated worker for image-check's off-thread pixel work.
 *
 * It owns the decoded image (base RGBA) between messages so tone adjustments can be
 * re-applied without re-sending pixels across the boundary. Two operations:
 * - `load`:   decode a File, extract the unmodified base pixels, keep them. Returns
 *             natural + analysis dimensions so the UI can prefill width/height.
 * - `analyze`: apply contrast/lightness (real per-pixel processing), run the WCAG
 *              analysis and color grouping, and return the processed RGBA (transferred)
 *              so the main thread can paint the preview canvas.
 */

import {
    decodeImage,
    extractBaseImageData,
    applyToneAdjustments,
    analyzeLuminance,
    type LuminanceAnalysis,
} from "./analysis";
import { groupColors, type ColorGroup } from "./grouping";

type LoadPayload = { file: File };
type AnalyzePayload = { contrast: number; lightness: number; groupCount: number };

type WorkerRequestMessage =
    | { id: number; type: "load"; payload: LoadPayload }
    | { id: number; type: "analyze"; payload: AnalyzePayload };

type WorkerSuccessMessage = { id: number; ok: true; result: unknown };
type WorkerErrorMessage = { id: number; ok: false; error: string };

// Worker-scoped state: the base (unmodified) pixels for the current image.
let baseData: Uint8ClampedArray | null = null;
let baseWidth = 0;
let baseHeight = 0;
let baseDownscaled = false;

const workerScope = self as unknown as Worker;

const handleLoad = async (payload: LoadPayload) => {
    const decoded = await decodeImage(payload.file);
    try {
        const base = extractBaseImageData(decoded);
        baseData = base.data;
        baseWidth = base.width;
        baseHeight = base.height;
        baseDownscaled = base.downscaled;
        return {
            naturalWidth: decoded.naturalWidth,
            naturalHeight: decoded.naturalHeight,
            width: base.width,
            height: base.height,
            downscaled: base.downscaled,
        };
    } finally {
        decoded.bitmap.close();
    }
};

const handleAnalyze = (
    payload: AnalyzePayload
): {
    message: { analysis: LuminanceAnalysis; groups: ColorGroup[]; processed: ArrayBuffer; width: number; height: number; downscaled: boolean };
    transfer: Transferable[];
} => {
    if (!baseData) {
        throw new Error("No image loaded. Call load before analyze.");
    }
    const processed = applyToneAdjustments(baseData, {
        contrast: payload.contrast,
        lightness: payload.lightness,
    });
    const image = { data: processed, width: baseWidth, height: baseHeight, downscaled: baseDownscaled };
    const analysis = analyzeLuminance(image);
    const groups = groupColors(processed, payload.groupCount);

    // Transfer the processed buffer to the main thread for the preview canvas.
    return {
        message: {
            analysis,
            groups,
            processed: processed.buffer,
            width: baseWidth,
            height: baseHeight,
            downscaled: baseDownscaled,
        },
        transfer: [processed.buffer],
    };
};

workerScope.addEventListener("message", async (event: MessageEvent<WorkerRequestMessage>) => {
    const { id, type, payload } = event.data;
    try {
        if (type === "load") {
            const result = await handleLoad(payload);
            workerScope.postMessage({ id, ok: true, result } satisfies WorkerSuccessMessage);
            return;
        }
        if (type === "analyze") {
            const { message, transfer } = handleAnalyze(payload);
            workerScope.postMessage({ id, ok: true, result: message } satisfies WorkerSuccessMessage, transfer);
            return;
        }
        workerScope.postMessage({
            id,
            ok: false,
            error: `Unknown request type: ${String(type)}`,
        } satisfies WorkerErrorMessage);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Worker request failed.";
        workerScope.postMessage({ id, ok: false, error: errorMessage } satisfies WorkerErrorMessage);
    }
});
