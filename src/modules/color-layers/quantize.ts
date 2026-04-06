/**
 * Main-thread worker client for color-layer processing.
 * Wrap request/response messaging into typed async helpers.
 */

// Request/response payload types

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

type QuantizePreviewResult = {
    width: number;
    height: number;
    palette: number[][];
    indexedPixels: ArrayBuffer;
    quantizedRgba: ArrayBuffer;
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
    indexedPixels: Uint16Array;
    layers: RenderLayerInput[];
};

type RenderLayersWorkerPayload = {
    width: number;
    height: number;
    indexedPixels?: Uint16Array;
    layers: RenderLayerInput[];
};

type RenderLayersResult = {
    layerPngs: ArrayBuffer[];
};

type OptimizePngPayload = {
    pngBytes: Uint8Array;
    level: number;
};

type OptimizePngResult = {
    optimizedBytes: ArrayBuffer;
};

// Worker RPC type mapping

type WorkerRequestMap = {
    "quantize-preview": {
        payload: QuantizePreviewPayload;
        result: QuantizePreviewResult;
    };
    "render-layers": {
        payload: RenderLayersWorkerPayload;
        result: RenderLayersResult;
    };
    "optimize-png": {
        payload: OptimizePngPayload;
        result: OptimizePngResult;
    };
};

type WorkerRequestType = keyof WorkerRequestMap;

type WorkerSuccessResponse<T extends WorkerRequestType> = {
    id: number;
    ok: true;
    result: WorkerRequestMap[T]["result"];
};

type WorkerErrorResponse = {
    id: number;
    ok: false;
    error: string;
};

type PendingResolver<T extends WorkerRequestType = WorkerRequestType> = {
    resolve: (value: WorkerRequestMap[T]["result"]) => void;
    reject: (reason?: unknown) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};

// Worker instance and request lifecycle state

let requestId = 0;
// Tracks unresolved worker RPC calls by generated request id.
const pending = new Map<number, PendingResolver>();
const WORKER_REQUEST_TIMEOUT_MS = 30000;
let lastRenderIndexedPixels: Uint16Array | null = null;
let lastRenderWidth = 0;
let lastRenderHeight = 0;

const worker = new Worker(new URL("./color-processing.worker.ts", import.meta.url), {
    type: "module",
});

/**
 * Resolve or reject pending promises from worker responses.
 */
worker.addEventListener("message", (event: MessageEvent<WorkerSuccessResponse<WorkerRequestType> | WorkerErrorResponse>) => {
    const { id, ok } = event.data;
    const resolver = pending.get(id);
    if (!resolver) {
        return;
    }
    pending.delete(id);
    clearTimeout(resolver.timeoutId);

    if (ok) {
        resolver.resolve(event.data.result as never);
        return;
    }

    resolver.reject(new Error(event.data.error || "Worker request failed."));
});

const rejectAllPending = (message: string): void => {
    for (const [id, resolver] of pending.entries()) {
        pending.delete(id);
        clearTimeout(resolver.timeoutId);
        resolver.reject(new Error(message));
    }
};

worker.addEventListener("error", (event) => {
    const detail = event.message || "unknown error";
    rejectAllPending(`Worker crashed while processing image data: ${detail}`);
});

worker.addEventListener("messageerror", () => {
    rejectAllPending("Worker sent an unreadable message.");
});

const callWorker = <T extends WorkerRequestType>(
    type: T,
    payload: WorkerRequestMap[T]["payload"],
    transfer: Transferable[] = []
): Promise<WorkerRequestMap[T]["result"]> => {
    return new Promise((resolve, reject) => {
        const id = ++requestId;
        // Timeout prevents requests from hanging forever after worker/runtime failures.
        const timeoutId = setTimeout(() => {
            const resolver = pending.get(id);
            if (!resolver) {
                return;
            }
            pending.delete(id);
            resolver.reject(new Error(`Worker request timed out: ${type}`));
        }, WORKER_REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve, reject, timeoutId } as PendingResolver);

        try {
            worker.postMessage({ id, type, payload }, transfer);
        } catch (error) {
            pending.delete(id);
            clearTimeout(timeoutId);
            reject(error instanceof Error ? error : new Error("Failed to send worker message."));
        }
    });
};

/**
 * Run quantization preview in the worker and normalize binary results to typed arrays.
 */
export const quantizeForPreview = async (
    params: QuantizePreviewPayload
): Promise<{
    width: number;
    height: number;
    palette: number[][];
    indexedPixels: Uint16Array;
    quantizedRgba: Uint8ClampedArray;
}> => {
    const result = await callWorker("quantize-preview", params, [params.imageBitmap]);

    return {
        width: result.width,
        height: result.height,
        palette: result.palette,
        indexedPixels: new Uint16Array(result.indexedPixels),
        quantizedRgba: new Uint8ClampedArray(result.quantizedRgba),
    };
};

/**
 * Render per-layer transparent PNGs in the worker using indexed pixels.
 */
export const renderLayersWithWebGL = async ({
    width,
    height,
    indexedPixels,
    layers,
}: RenderLayersPayload): Promise<Uint8Array[]> => {
    const shouldSendIndexedPixels =
        indexedPixels !== lastRenderIndexedPixels ||
        width !== lastRenderWidth ||
        height !== lastRenderHeight;

    const payload: RenderLayersWorkerPayload = {
        width,
        height,
        layers,
    };

    if (shouldSendIndexedPixels) {
        payload.indexedPixels = indexedPixels;
        lastRenderIndexedPixels = indexedPixels;
        lastRenderWidth = width;
        lastRenderHeight = height;
    }

    const result = await callWorker("render-layers", {
        ...payload,
    });

    return result.layerPngs.map((buffer) => new Uint8Array(buffer));
};

/**
 * Optimize a PNG byte array using oxipng wasm in the worker.
 */
export const optimizePngWithOxi = async (pngBytes: Uint8Array, level = 2): Promise<Uint8Array> => {
    const result = await callWorker("optimize-png", { pngBytes, level });
    return new Uint8Array(result.optimizedBytes);
};
