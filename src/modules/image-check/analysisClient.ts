/**
 * Main-thread RPC client for the image-check analysis worker.
 *
 * Mirrors the color-layers `quantize.ts` client: id-tagged request/response promises,
 * a per-request timeout, and typed helpers. The worker keeps the decoded image between
 * calls, so `analyze` only sends adjustment settings, not pixels.
 */

import type { LuminanceAnalysis } from "./analysis";
import type { ColorGroup } from "./grouping";

type LoadResult = {
    naturalWidth: number;
    naturalHeight: number;
    width: number;
    height: number;
    downscaled: boolean;
};

type AnalyzeWireResult = {
    analysis: LuminanceAnalysis;
    groups: ColorGroup[];
    processed: ArrayBuffer;
    width: number;
    height: number;
    downscaled: boolean;
};

export type AnalyzeResult = {
    analysis: LuminanceAnalysis;
    groups: ColorGroup[];
    processed: Uint8ClampedArray;
    width: number;
    height: number;
    downscaled: boolean;
};

type RequestMap = {
    load: { payload: { file: File }; result: LoadResult };
    analyze: {
        payload: { contrast: number; lightness: number; groupCount: number };
        result: AnalyzeWireResult;
    };
};

type RequestType = keyof RequestMap;

type SuccessResponse<T extends RequestType> = { id: number; ok: true; result: RequestMap[T]["result"] };
type ErrorResponse = { id: number; ok: false; error: string };

type PendingResolver = {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};

const WORKER_REQUEST_TIMEOUT_MS = 30000;

let requestId = 0;
const pending = new Map<number, PendingResolver>();

const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });

worker.addEventListener("message", (event: MessageEvent<SuccessResponse<RequestType> | ErrorResponse>) => {
    const { id, ok } = event.data;
    const resolver = pending.get(id);
    if (!resolver) return;
    pending.delete(id);
    clearTimeout(resolver.timeoutId);
    if (ok) {
        resolver.resolve(event.data.result);
    } else {
        resolver.reject(new Error(event.data.error || "Worker request failed."));
    }
});

const rejectAllPending = (message: string): void => {
    for (const [id, resolver] of pending.entries()) {
        pending.delete(id);
        clearTimeout(resolver.timeoutId);
        resolver.reject(new Error(message));
    }
};

worker.addEventListener("error", (event) => {
    rejectAllPending(`Analysis worker crashed: ${event.message || "unknown error"}`);
});
worker.addEventListener("messageerror", () => {
    rejectAllPending("Analysis worker sent an unreadable message.");
});

const callWorker = <T extends RequestType>(
    type: T,
    payload: RequestMap[T]["payload"],
    transfer: Transferable[] = []
): Promise<RequestMap[T]["result"]> => {
    return new Promise((resolve, reject) => {
        const id = ++requestId;
        const timeoutId = setTimeout(() => {
            const resolver = pending.get(id);
            if (!resolver) return;
            pending.delete(id);
            resolver.reject(new Error(`Analysis worker request timed out: ${type}`));
        }, WORKER_REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeoutId });

        try {
            worker.postMessage({ id, type, payload }, transfer);
        } catch (error) {
            pending.delete(id);
            clearTimeout(timeoutId);
            reject(error instanceof Error ? error : new Error("Failed to send worker message."));
        }
    });
};

/** Decode + cache an image in the worker; returns its dimensions. */
export const loadImage = (file: File): Promise<LoadResult> => callWorker("load", { file });

/** Process (contrast/lightness) + analyze + group the loaded image in the worker. */
export const analyzeImage = async (params: {
    contrast: number;
    lightness: number;
    groupCount: number;
}): Promise<AnalyzeResult> => {
    const result = await callWorker("analyze", params);
    return {
        analysis: result.analysis,
        groups: result.groups,
        processed: new Uint8ClampedArray(result.processed),
        width: result.width,
        height: result.height,
        downscaled: result.downscaled,
    };
};
