import {
    optimizePngWithOxi,
    quantizeForPreview,
    renderLayersWithWebGL,
} from "./quantize";

/**
 * Initializes the Color Layers page controller.
 * Owns UI events, state transitions, and render/export orchestration.
 */

// Configuration constants

const IMAGE_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const TEMP_ERASE_MASK_ID = "paint-erase-mask";
const DEFAULT_COLOR_COUNT = 6;
const DEFAULT_DITHERING = 0.85;
const DEFAULT_CONTRAST = 1;
const DEFAULT_LIGHTNESS = 0;
const DEFAULT_SPECKLE_CLEANUP = 0;
const DEFAULT_STROKE_SIZE = 24;
const MIN_STROKE_SIZE = 1;
const MAX_STROKE_SIZE = 512;
const DEFAULT_OXIPNG_LEVEL = 2;
const OXIPNG_LEVEL_CANDIDATES = [2, 3, 4, 5, 6] as const;
const MIN_COLOR_COUNT = 2;
const MAX_COLOR_COUNT = 32;
const BACKGROUND_SENTINEL_INDEX = 255;
const EMPTY_LAYERS_TEXT = "No layers yet. Upload an image to begin.";

type ToolMode = "none" | "draw" | "erase";

const STATUS = {
    chooseImage: "Choose an image to generate layers.",
    generatingPreview: "Generating layers...",
    layersGenerated: "Layers updated.",
    generateLayersFirst: "Generate layers first.",
    exportedPng: "Exported flattened PNG.",
    optimizingPng: "Optimizing PNG...",
    invalidImage: "Could not decode that image file. Try another image.",
    canvasUnavailable: "Canvas features are unavailable in this browser/device.",
    webglRequired: "WebGL is required for this tool on this browser/device.",
} as const;

// State and DOM cache types

type Layer = {
    id: string;
    color: string;
    opacity: number;
    paletteIndex: number;
};

type BackgroundLayer = {
    color: string;
    opacity: number;
};

type EditingState = {
    mode: ToolMode;
    selectedLayerId: string | null;
    strokeSize: number;
    hasEdits: boolean;
    layerMasks: Record<string, Int8Array>;
    maskVersionByLayer: Record<string, number>;
    isPainting: boolean;
    lastPaintPoint: { x: number; y: number } | null;
};

type AppState = {
    imageInput: {
        file: File | null;
        prefilledFileKey: string | null;
        normalizedPngFile: File | null;
        normalizedFromFileKey: string | null;
        sourceWidth: number | null;
        sourceHeight: number | null;
    };
    settings: {
        colorCount: number;
        dithering: number;
        contrast: number;
        lightness: number;
        speckleCleanup: number;
        lockAspectRatio: boolean;
        width: number;
        height: number;
    };
    palette: number[][];
    preview: {
        requestToken: number;
        width: number;
        height: number;
        baseIndexedPixels: Uint16Array | null;
        indexedPixels: Uint16Array | null;
        quantizedRgba: Uint8ClampedArray | null;
    };
    render: {
        requestToken: number;
        objectUrls: string[];
    };
    background: BackgroundLayer;
    editing: EditingState;
    layers: Layer[];
};

type CachedElements = {
    layoutRoot: HTMLDivElement | null;
    layoutModeInput: HTMLSelectElement | null;
    imageSettingsControls: HTMLLIElement | null;
    fileInput: HTMLInputElement | null;
    colorCountInput: HTMLInputElement | null;
    ditheringInput: HTMLInputElement | null;
    contrastInput: HTMLInputElement | null;
    lightnessInput: HTMLInputElement | null;
    speckleCleanupInput: HTMLInputElement | null;
    lockAspectRatioInput: HTMLInputElement | null;
    widthInput: HTMLInputElement | null;
    heightInput: HTMLInputElement | null;
    layersList: HTMLUListElement | null;
    toolsList: HTMLUListElement | null;
    svgPreview: SVGSVGElement | null;
    paintOverlay: HTMLCanvasElement | null;
    colorsFyiLink: HTMLAnchorElement | null;
    exportButton: HTMLButtonElement | null;
};

// DOM cache bootstrap

const emptyElements = (): CachedElements => ({
    layoutRoot: null,
    layoutModeInput: null,
    imageSettingsControls: null,
    fileInput: null,
    colorCountInput: null,
    ditheringInput: null,
    contrastInput: null,
    lightnessInput: null,
    speckleCleanupInput: null,
    lockAspectRatioInput: null,
    widthInput: null,
    heightInput: null,
    layersList: null,
    toolsList: null,
    svgPreview: null,
    paintOverlay: null,
    colorsFyiLink: null,
    exportButton: null,
});

/**
 * Entry point for wiring the color-layers page behavior.
 */
export const initColorLayers = (): void => {
    const state: AppState = {
        imageInput: {
            file: null,
            prefilledFileKey: null,
            normalizedPngFile: null,
            normalizedFromFileKey: null,
            sourceWidth: null,
            sourceHeight: null,
        },
        settings: {
            colorCount: DEFAULT_COLOR_COUNT,
            dithering: DEFAULT_DITHERING,
            contrast: DEFAULT_CONTRAST,
            lightness: DEFAULT_LIGHTNESS,
            speckleCleanup: DEFAULT_SPECKLE_CLEANUP,
            lockAspectRatio: true,
            width: 0,
            height: 0,
        },
        palette: [],
        preview: {
            requestToken: 0,
            width: 0,
            height: 0,
            baseIndexedPixels: null,
            indexedPixels: null,
            quantizedRgba: null,
        },
        render: {
            requestToken: 0,
            objectUrls: [],
        },
        background: {
            color: "#ffffff",
            opacity: 100,
        },
        editing: {
            mode: "none",
            selectedLayerId: null,
            strokeSize: DEFAULT_STROKE_SIZE,
            hasEdits: false,
            layerMasks: {},
            maskVersionByLayer: {},
            isPainting: false,
            lastPaintPoint: null,
        },
        layers: [],
    };

    type EditedLayerWebGLState = {
        canvas: OffscreenCanvas;
        gl: WebGLRenderingContext;
        program: WebGLProgram;
        positionLocation: number;
        positionBuffer: WebGLBuffer;
        indexTexture: WebGLTexture;
        maskTexture: WebGLTexture;
        indexTextureLocation: WebGLUniformLocation;
        maskTextureLocation: WebGLUniformLocation;
        targetIndexLocation: WebGLUniformLocation;
        layerColorLocation: WebGLUniformLocation;
        layerAlphaLocation: WebGLUniformLocation;
        width: number;
        height: number;
    };

    let els: CachedElements = emptyElements();
    let renderInFlight = false;
    let renderQueued = false;
    let clearPreviewAfterRender = false;
    let editedLayerGLState: EditedLayerWebGLState | null = null;
    let editedPreviewCache: {
        key: string;
        rgba: Uint8ClampedArray;
    } | null = null;

    const invalidateEditedPreviewCache = (): void => {
        editedPreviewCache = null;
    };

    /**
     * Cache the DOM nodes used by this controller.
     */
    const cacheElements = (): void => {
        els = {
            layoutRoot: document.querySelector<HTMLDivElement>("#color-layers-layout"),
            layoutModeInput: document.querySelector<HTMLSelectElement>("#layout-mode"),
            imageSettingsControls: document.querySelector<HTMLLIElement>("#image-settings-controls"),
            fileInput: document.querySelector<HTMLInputElement>("#file-upload"),
            colorCountInput: document.querySelector<HTMLInputElement>("#color-count"),
            ditheringInput: document.querySelector<HTMLInputElement>("#dithering"),
            contrastInput: document.querySelector<HTMLInputElement>("#contrast"),
            lightnessInput: document.querySelector<HTMLInputElement>("#lightness"),
            speckleCleanupInput: document.querySelector<HTMLInputElement>("#speckle-cleanup"),
            lockAspectRatioInput: document.querySelector<HTMLInputElement>("#lock-aspect-ratio"),
            widthInput: document.querySelector<HTMLInputElement>("#width"),
            heightInput: document.querySelector<HTMLInputElement>("#height"),
            layersList: document.querySelector<HTMLUListElement>("#layers-list"),
            toolsList: document.querySelector<HTMLUListElement>("#tools-list"),
            svgPreview: document.querySelector<SVGSVGElement>("#layer-preview"),
            paintOverlay: (() => {
                let overlay = document.querySelector<HTMLCanvasElement>("#paint-overlay");
                if (!overlay) {
                    overlay = document.createElement("canvas");
                    overlay.id = "paint-overlay";
                    overlay.style.width = "100%";
                    overlay.style.height = "100%";
                    overlay.style.display = "block";
                    overlay.style.pointerEvents = "none";
                }
                return overlay;
            })(),
            colorsFyiLink: document.querySelector<HTMLAnchorElement>("#colors-fyi-link"),
            exportButton: document.querySelector<HTMLButtonElement>("#export-png"),
        };
    };

    const attachPaintOverlayToSvg = (): void => {
        if (!els.svgPreview || !els.paintOverlay) {
            return;
        }

        const selectedLayer =
            state.editing.mode !== "none"
                ? getSelectedEditableLayer()
                : null;

        let foreignObject = els.svgPreview.querySelector<SVGForeignObjectElement>("#paint-overlay-fo");
        if (!foreignObject) {
            foreignObject = document.createElementNS(IMAGE_NS, "foreignObject");
            foreignObject.id = "paint-overlay-fo";
            foreignObject.setAttribute("x", "0");
            foreignObject.setAttribute("y", "0");
            foreignObject.setAttribute("width", "100%");
            foreignObject.setAttribute("height", "100%");
            foreignObject.style.pointerEvents = "none";
        }

        if (selectedLayer && state.editing.mode !== "none") {
            const selectedLayerImage = els.svgPreview.querySelector<SVGImageElement>(
                `image[data-layer-id="${selectedLayer.id}"]`
            );
            if (selectedLayerImage) {
                selectedLayerImage.insertAdjacentElement("afterend", foreignObject);
            } else {
                els.svgPreview.appendChild(foreignObject);
            }
        } else {
            els.svgPreview.appendChild(foreignObject);
        }

        let wrapper = foreignObject.querySelector<HTMLElement>("#paint-overlay-wrapper");
        if (!wrapper) {
            wrapper = document.createElementNS(XHTML_NS, "div") as HTMLElement;
            wrapper.id = "paint-overlay-wrapper";
            wrapper.style.width = "100%";
            wrapper.style.height = "100%";
            wrapper.style.pointerEvents = "none";
            foreignObject.appendChild(wrapper);
        }

        if (els.paintOverlay.parentElement !== wrapper) {
            wrapper.appendChild(els.paintOverlay);
        }
    };

    const clearLiveEraseMaskPreview = (): void => {
        if (!els.svgPreview) {
            return;
        }

        const maskedImages = els.svgPreview.querySelectorAll<SVGImageElement>(`image[mask="url(#${TEMP_ERASE_MASK_ID})"]`);
        for (const image of maskedImages) {
            image.removeAttribute("mask");
        }

        const existingMask = els.svgPreview.querySelector<SVGMaskElement>(`#${TEMP_ERASE_MASK_ID}`);
        existingMask?.remove();
    };

    const getSelectedLayerSvgImage = (): SVGImageElement | null => {
        if (!els.svgPreview) {
            return null;
        }
        const selectedLayer = getSelectedEditableLayer();
        if (!selectedLayer) {
            return null;
        }
        return els.svgPreview.querySelector<SVGImageElement>(`image[data-layer-id="${selectedLayer.id}"]`);
    };

    const ensureLiveEraseMask = (): SVGMaskElement | null => {
        if (!els.svgPreview || !state.preview.width || !state.preview.height) {
            return null;
        }

        const selectedImage = getSelectedLayerSvgImage();
        if (!selectedImage) {
            return null;
        }

        let mask = els.svgPreview.querySelector<SVGMaskElement>(`#${TEMP_ERASE_MASK_ID}`);
        if (!mask) {
            mask = document.createElementNS(IMAGE_NS, "mask");
            mask.id = TEMP_ERASE_MASK_ID;
            mask.setAttribute("maskUnits", "userSpaceOnUse");
            mask.setAttribute("maskContentUnits", "userSpaceOnUse");
            mask.setAttribute("x", "0");
            mask.setAttribute("y", "0");
            mask.setAttribute("width", String(state.preview.width));
            mask.setAttribute("height", String(state.preview.height));

            const baseRect = document.createElementNS(IMAGE_NS, "rect");
            baseRect.setAttribute("x", "0");
            baseRect.setAttribute("y", "0");
            baseRect.setAttribute("width", String(state.preview.width));
            baseRect.setAttribute("height", String(state.preview.height));
            baseRect.setAttribute("fill", "white");
            mask.appendChild(baseRect);

            const cutouts = document.createElementNS(IMAGE_NS, "g");
            cutouts.setAttribute("id", "paint-erase-cutouts");
            cutouts.setAttribute("fill", "black");
            mask.appendChild(cutouts);

            els.svgPreview.appendChild(mask);
        }

        selectedImage.setAttribute("mask", `url(#${TEMP_ERASE_MASK_ID})`);
        return mask;
    };

    const getSelectedEditableLayer = (): Layer | null => {
        if (!state.editing.selectedLayerId) {
            return null;
        }

        return state.layers.find((layer) => layer.id === state.editing.selectedLayerId) || null;
    };

    const syncEditingLayerSelection = (): void => {
        if (!state.layers.length) {
            state.editing.selectedLayerId = null;
            state.editing.layerMasks = {};
            state.editing.maskVersionByLayer = {};
            state.editing.hasEdits = false;
            state.editing.isPainting = false;
            state.editing.lastPaintPoint = null;
            return;
        }

        const selectedLayer = getSelectedEditableLayer();
        if (selectedLayer) {
            return;
        }

        state.editing.selectedLayerId = state.layers[0]?.id || null;
    };

    const syncEditingLayerMasks = (): void => {
        const nextMasks: Record<string, Int8Array> = {};
        const nextMaskVersions: Record<string, number> = {};
        const pixelCount = state.preview.width * state.preview.height;

        for (const layer of state.layers) {
            const existingMask = state.editing.layerMasks[layer.id];
            if (existingMask && existingMask.length === pixelCount) {
                nextMasks[layer.id] = existingMask;
                nextMaskVersions[layer.id] = state.editing.maskVersionByLayer[layer.id] || 0;
                continue;
            }

            nextMasks[layer.id] = new Int8Array(pixelCount);
            nextMaskVersions[layer.id] = 0;
        }

        state.editing.layerMasks = nextMasks;
        state.editing.maskVersionByLayer = nextMaskVersions;
        state.editing.hasEdits = Object.values(nextMasks).some((mask) => {
            for (let i = 0; i < mask.length; i += 1) {
                if (mask[i] !== 0) {
                    return true;
                }
            }
            return false;
        });
    };

    const isLayerVisibleAtPixel = (layer: Layer, pixelIndex: number): boolean => {
        const baseIndexedPixels = state.preview.baseIndexedPixels || state.preview.indexedPixels;
        const baseVisible = baseIndexedPixels?.[pixelIndex] === layer.paletteIndex;
        const override = state.editing.layerMasks[layer.id]?.[pixelIndex] || 0;

        if (override > 0) {
            return true;
        }
        if (override < 0) {
            return false;
        }

        return Boolean(baseVisible);
    };

    const updateColorsFyiLink = (): void => {
        if (!els.colorsFyiLink) {
            return;
        }

        const colors = [
            state.background.color,
            ...state.layers.map((layer) => layer.color),
        ];

        const uniqueColors = [...new Set(colors)];
        const compareUrl = new URL("https://colors.fyi/compare-colors/");
        compareUrl.searchParams.set("colors", uniqueColors.join(", "));
        els.colorsFyiLink.href = compareUrl.toString();
    };

    const setImageSettingsVisibility = (visible: boolean): void => {
        if (!els.imageSettingsControls) {
            return;
        }
        els.imageSettingsControls.hidden = !visible;
    };

    const applyLayoutMode = (value: string): void => {
        if (!els.layoutRoot) {
            return;
        }

        const nextMode = value === "top-and-bottom"
            ? "top-and-bottom"
            : "side-by-side";
        els.layoutRoot.dataset.layout = nextMode;
    };

    /**
        * Write status text to the settings output region.
     */
    const setStatus = (_message: string): void => {
    };

    const clamp = (value: number, min: number, max: number): number => {
        return Math.max(min, Math.min(max, value));
    };

    const rgbToHex = ([r, g, b]: [number, number, number]): string => {
        const toHex = (value: number): string => value.toString(16).padStart(2, "0");
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };

    const hexToRgb = (hex: string): [number, number, number] => {
        const safeHex = hex.replace("#", "");
        return [
            Number.parseInt(safeHex.slice(0, 2), 16),
            Number.parseInt(safeHex.slice(2, 4), 16),
            Number.parseInt(safeHex.slice(4, 6), 16),
        ];
    };

    const escapeHtml = (value: string): string => {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    };

    const createBrushCursor = (): string => {
        if (!els.svgPreview || !state.preview.width || !state.preview.height) {
            return "crosshair";
        }

        const previewBounds = els.svgPreview.getBoundingClientRect();
        const screenScale = previewBounds.width > 0
            ? previewBounds.width / state.preview.width
            : 1;
        const brushDiameter = clamp(
            Math.round(state.editing.strokeSize * screenScale),
            6,
            96
        );
        const cursorSize = clamp(brushDiameter + 10, 16, 128);
        const hotspot = Math.round(cursorSize / 2);
        const radius = Math.max(2, brushDiameter / 2 - 1);
        const circle = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}"><circle cx="${hotspot}" cy="${hotspot}" r="${radius}" fill="none" stroke="black" stroke-width="3"/><circle cx="${hotspot}" cy="${hotspot}" r="${radius}" fill="none" stroke="white" stroke-width="1.5"/></svg>`;
        return `url("data:image/svg+xml,${encodeURIComponent(circle)}") ${hotspot} ${hotspot}, crosshair`;
    };

    const updatePreviewCursor = (): void => {
        if (!els.svgPreview) {
            return;
        }

        const canEditPreview =
            state.editing.mode !== "none" &&
            Boolean(getSelectedEditableLayer()) &&
            Boolean(state.preview.indexedPixels) &&
            state.preview.width > 0 &&
            state.preview.height > 0;

        if (!canEditPreview) {
            els.svgPreview.style.removeProperty("cursor");
            els.svgPreview.style.removeProperty("touch-action");
            return;
        }

        els.svgPreview.style.cursor = createBrushCursor();
        els.svgPreview.style.touchAction = "none";
    };

    const clearPaintOverlay = (): void => {
        if (!els.paintOverlay) {
            return;
        }
        const ctx = els.paintOverlay.getContext("2d");
        ctx?.clearRect(0, 0, els.paintOverlay.width, els.paintOverlay.height);
    };

    const drawOverlayCircleAtPreviewPixel = (previewX: number, previewY: number): void => {
        if (!els.paintOverlay || !state.preview.width || !state.preview.height) {
            return;
        }
        const layer = getSelectedEditableLayer();
        if (!layer) {
            return;
        }

        const ctx = els.paintOverlay.getContext("2d");
        if (!ctx) {
            return;
        }

        // Match canvas raster space to image-space coordinates for exact stroke alignment.
        const targetW = state.preview.width;
        const targetH = state.preview.height;
        if (els.paintOverlay.width !== targetW || els.paintOverlay.height !== targetH) {
            els.paintOverlay.width = targetW;
            els.paintOverlay.height = targetH;
        }

        const x = previewX + 0.5;
        const y = previewY + 0.5;
        const radiusPx = Math.max(0.5, state.editing.strokeSize / 2);

        ctx.beginPath();
        ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
        ctx.globalAlpha = layer.opacity / 100;
        ctx.fillStyle = layer.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    };

    const drawLiveEraseCircleAtPreviewPixel = (previewX: number, previewY: number): void => {
        const mask = ensureLiveEraseMask();
        if (!mask) {
            return;
        }

        const cutouts = mask.querySelector<SVGGElement>("#paint-erase-cutouts");
        if (!cutouts) {
            return;
        }

        const circle = document.createElementNS(IMAGE_NS, "circle");
        circle.setAttribute("cx", String(previewX + 0.5));
        circle.setAttribute("cy", String(state.preview.height - (previewY + 0.5)));
        circle.setAttribute("r", String(Math.max(0.5, state.editing.strokeSize / 2)));
        cutouts.appendChild(circle);
    };

    const getFileKey = (file: File): string => {
        return `${file.name}:${file.size}:${file.lastModified}`;
    };

    const renderToolsPanel = (): void => {
        if (els.toolsList) {
            els.toolsList.innerHTML = "";
        }
        updatePreviewCursor();
    };

    const getPreviewPixelFromPointer = (event: PointerEvent): { x: number; y: number } | null => {
        if (!els.svgPreview || !state.preview.width || !state.preview.height) {
            return null;
        }

        const bounds = els.svgPreview.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) {
            return null;
        }

        const normalizedX = (event.clientX - bounds.left) / bounds.width;
        const normalizedY = (event.clientY - bounds.top) / bounds.height;
        if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
            return null;
        }

        return {
            x: clamp(Math.floor(normalizedX * state.preview.width), 0, state.preview.width - 1),
            y: clamp(Math.floor(normalizedY * state.preview.height), 0, state.preview.height - 1),
        };
    };

    const applyBrushStroke = (centerX: number, centerY: number): boolean => {
        const selectedLayer = getSelectedEditableLayer();
        if (!selectedLayer || !state.preview.indexedPixels) {
            return false;
        }

        const mask = state.editing.layerMasks[selectedLayer.id];
        if (!mask) {
            return false;
        }

        const radius = Math.max(0.5, state.editing.strokeSize / 2);
        const minX = Math.max(0, Math.floor(centerX - radius));
        const maxX = Math.min(state.preview.width - 1, Math.ceil(centerX + radius));
        const minY = Math.max(0, Math.floor(centerY - radius));
        const maxY = Math.min(state.preview.height - 1, Math.ceil(centerY + radius));
        const radiusSquared = radius * radius;
        let changed = false;

        for (let y = minY; y <= maxY; y += 1) {
            for (let x = minX; x <= maxX; x += 1) {
                const distanceX = x + 0.5 - centerX;
                const distanceY = y + 0.5 - centerY;
                if (distanceX * distanceX + distanceY * distanceY > radiusSquared) {
                    continue;
                }

                const pixelIndex = y * state.preview.width + x;
                if (state.editing.mode === "draw") {
                    if (mask[pixelIndex] !== 1) {
                        mask[pixelIndex] = 1;
                        changed = true;
                    }
                    continue;
                }

                if (state.editing.mode === "erase" && mask[pixelIndex] !== -1) {
                    mask[pixelIndex] = -1;
                    changed = true;
                }
            }
        }

        if (!changed) {
            return false;
        }

        state.editing.hasEdits = true;
        state.editing.maskVersionByLayer[selectedLayer.id] =
            (state.editing.maskVersionByLayer[selectedLayer.id] || 0) + 1;
        return true;
    };

    const paintFromPointer = (event: PointerEvent): void => {
        if (state.editing.mode === "none") {
            return;
        }

        const previewPixel = getPreviewPixelFromPointer(event);
        if (!previewPixel) {
            return;
        }

        const previousPoint = state.editing.lastPaintPoint;

        if (previousPoint) {
            const deltaX = previewPixel.x - previousPoint.x;
            const deltaY = previewPixel.y - previousPoint.y;
            const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY), 1);

            for (let step = 1; step <= steps; step += 1) {
                const x = Math.round(previousPoint.x + (deltaX * step) / steps);
                const y = Math.round(previousPoint.y + (deltaY * step) / steps);
                if (state.editing.mode === "erase") {
                    drawLiveEraseCircleAtPreviewPixel(x, y);
                } else {
                    drawOverlayCircleAtPreviewPixel(x, y);
                }
                applyBrushStroke(x, y);
            }
        } else {
            if (state.editing.mode === "erase") {
                drawLiveEraseCircleAtPreviewPixel(previewPixel.x, previewPixel.y);
            } else {
                drawOverlayCircleAtPreviewPixel(previewPixel.x, previewPixel.y);
            }
            applyBrushStroke(previewPixel.x, previewPixel.y);
        }

        state.editing.lastPaintPoint = previewPixel;
        // Render is deferred to stopPainting so the full pipeline runs only once per stroke.
    };

    const stopPainting = (): void => {
        if (state.editing.isPainting) {
            clearPreviewAfterRender = true;
            requestRender();
        }
        state.editing.isPainting = false;
        state.editing.lastPaintPoint = null;
    };

    const handlePreviewPointerDown = (event: PointerEvent): void => {
        if (state.editing.mode === "none" || !getSelectedEditableLayer()) {
            return;
        }

        // Ensure live overlay is attached to the selected layer before first stroke.
        attachPaintOverlayToSvg();
        event.preventDefault();
        state.editing.isPainting = true;
        state.editing.lastPaintPoint = null;
        els.svgPreview?.setPointerCapture(event.pointerId);
        paintFromPointer(event);
    };

    const handlePreviewPointerMove = (event: PointerEvent): void => {
        if (!state.editing.isPainting) {
            return;
        }

        event.preventDefault();
        paintFromPointer(event);
    };

    const handlePreviewPointerUp = (event: PointerEvent): void => {
        if (els.svgPreview?.hasPointerCapture(event.pointerId)) {
            els.svgPreview.releasePointerCapture(event.pointerId);
        }
        stopPainting();
    };

    /**
     * Keep width and height inputs in sync while aspect-ratio lock is enabled.
     */
    const syncLockedAspectRatioInputs = (changedField: "width" | "height" | "lock"): void => {
        if (!els.lockAspectRatioInput?.checked || !els.widthInput || !els.heightInput) {
            return;
        }

        const sourceWidth = state.imageInput.sourceWidth;
        const sourceHeight = state.imageInput.sourceHeight;
        const ratioFromSource =
            sourceWidth && sourceHeight && sourceWidth > 0 && sourceHeight > 0
                ? sourceWidth / sourceHeight
                : null;

        const currentWidth = Number(els.widthInput.value || 0);
        const currentHeight = Number(els.heightInput.value || 0);
        const ratio =
            ratioFromSource ||
            (currentWidth > 0 && currentHeight > 0 ? currentWidth / currentHeight : null);

        if (!ratio || ratio <= 0) {
            return;
        }

        if (changedField === "height" && currentHeight > 0) {
            els.widthInput.value = String(Math.max(1, Math.round(currentHeight * ratio)));
            return;
        }

        if ((changedField === "width" || changedField === "lock") && currentWidth > 0) {
            els.heightInput.value = String(Math.max(1, Math.round(currentWidth / ratio)));
        }
    };

    /**
     * Normalize uploads to PNG so quantization runs through a single decode path.
     */
    const getNormalizedPngFile = async (file: File): Promise<File> => {
        if (file.type === "image/png") {
            return file;
        }

        const sourceFileKey = getFileKey(file);
        if (
            state.imageInput.normalizedFromFileKey === sourceFileKey &&
            state.imageInput.normalizedPngFile
        ) {
            return state.imageInput.normalizedPngFile;
        }

        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) {
            bitmap.close?.();
            throw new Error("Canvas features are unavailable in this browser/device.");
        }

        context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        bitmap.close?.();

        const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, "image/png");
        });
        if (!blob) {
            throw new Error("Failed to convert source image to PNG.");
        }

        const baseName = file.name.replace(/\.[^/.]+$/, "") || "image";
        const normalizedFile = new File([blob], `${baseName}.png`, {
            type: "image/png",
            lastModified: file.lastModified,
        });

        state.imageInput.normalizedPngFile = normalizedFile;
        state.imageInput.normalizedFromFileKey = sourceFileKey;
        return normalizedFile;
    };

    /**
     * Release object URLs to avoid leaking blob references.
     */
    const revokeObjectUrls = (objectUrls: string[]): void => {
        for (const objectUrl of objectUrls) {
            URL.revokeObjectURL(objectUrl);
        }
    };

    /**
     * Wait for an SVG image element to finish loading or fail.
     */
    const waitForSvgImageLoad = (svgImage: SVGImageElement): Promise<void> => {
        return new Promise((resolve) => {
            const onComplete = (): void => {
                svgImage.removeEventListener("load", onComplete);
                svgImage.removeEventListener("error", onComplete);
                resolve();
            };

            svgImage.addEventListener("load", onComplete);
            svgImage.addEventListener("error", onComplete);
        });
    };

    /**
        * Create lookup map from palette index to current layer config.
     */
    const createLayerByPaletteIndexMap = (): Map<number, Layer> => {
        const map = new Map<number, Layer>();
        for (const layer of state.layers) {
            map.set(layer.paletteIndex, layer);
        }
        return map;
    };

    /**
        * Read and sanitize settings values from the form.
     */
    const readSettingsForm = (): AppState["settings"] => {
        const colorCount = Number(els.colorCountInput?.value || DEFAULT_COLOR_COUNT);
        const dithering = Number(els.ditheringInput?.value || DEFAULT_DITHERING);
        const contrast = Number(els.contrastInput?.value || DEFAULT_CONTRAST);
        const lightness = Number(els.lightnessInput?.value || DEFAULT_LIGHTNESS);
        const speckleCleanup = Number(els.speckleCleanupInput?.value || DEFAULT_SPECKLE_CLEANUP);
        const lockAspectRatio = Boolean(els.lockAspectRatioInput?.checked);
        const width = Number(els.widthInput?.value || 0);
        const height = Number(els.heightInput?.value || 0);

        return {
            colorCount: clamp(colorCount, MIN_COLOR_COUNT, MAX_COLOR_COUNT),
            dithering: clamp(dithering, 0, 1),
            contrast: clamp(contrast, 0, 2),
            lightness: clamp(lightness, -100, 100),
            speckleCleanup: clamp(speckleCleanup, 0, 100),
            lockAspectRatio,
            width: Math.max(0, width),
            height: Math.max(0, height),
        };
    };

    /**
        * Produce quantized preview data and update preview UI state.
     */
    const runQuantizationPreview = async (): Promise<void> => {
        const file = state.imageInput.file;
        if (!file) {
            return;
        }

        // Guards against stale async results overwriting newer settings changes.
        const requestToken = ++state.preview.requestToken;
        setStatus(STATUS.generatingPreview);

        let imageBitmap: ImageBitmap;
        try {
            const normalizedFile = await getNormalizedPngFile(file);
            imageBitmap = await createImageBitmap(normalizedFile);

            // Fill dimensions once per selected file to keep settings predictable.
            const fileKey = getFileKey(file);
            if (state.imageInput.prefilledFileKey !== fileKey) {
                state.imageInput.sourceWidth = imageBitmap.width;
                state.imageInput.sourceHeight = imageBitmap.height;
                if (els.widthInput) {
                    els.widthInput.value = String(imageBitmap.width);
                }
                if (els.heightInput) {
                    els.heightInput.value = String(imageBitmap.height);
                }
                state.settings.width = imageBitmap.width;
                state.settings.height = imageBitmap.height;
                state.imageInput.prefilledFileKey = fileKey;
            }

            const result = await quantizeForPreview({
                imageBitmap,
                colorCount: state.settings.colorCount,
                dithering: state.settings.dithering,
                contrast: state.settings.contrast,
                lightness: state.settings.lightness,
                speckleCleanup: state.settings.speckleCleanup,
                width: state.settings.width,
                height: state.settings.height,
                lockAspectRatio: state.settings.lockAspectRatio,
            });

            if (requestToken !== state.preview.requestToken) {
                return;
            }

            state.palette = result.palette;
            state.preview.width = result.width;
            state.preview.height = result.height;
            state.preview.indexedPixels = result.indexedPixels;
            state.preview.baseIndexedPixels = new Uint16Array(result.indexedPixels);
            state.preview.quantizedRgba = result.quantizedRgba;
            state.editing.layerMasks = {};
            state.editing.maskVersionByLayer = {};
            state.editing.hasEdits = false;
            invalidateEditedPreviewCache();

        } catch (error) {
            if (import.meta.env.DEV) {
                console.error("Quantized preview generation failed", error);
            }
            const message = error instanceof Error ? error.message : "";
            if (message.includes("WebGL") || message.includes("worker")) {
                setStatus(STATUS.webglRequired);
            } else {
                setStatus(STATUS.invalidImage);
            }
        }
    };

    const resetRenderState = (): void => {
        state.palette = [];
        state.layers = [];
        state.preview.width = 0;
        state.preview.height = 0;
        state.preview.baseIndexedPixels = null;
        state.preview.indexedPixels = null;
        state.preview.quantizedRgba = null;
        state.editing.layerMasks = {};
        state.editing.maskVersionByLayer = {};
        state.editing.hasEdits = false;
        invalidateEditedPreviewCache();
        state.imageInput.prefilledFileKey = null;
        state.render.requestToken += 1;
        revokeObjectUrls(state.render.objectUrls);
        state.render.objectUrls = [];
        state.editing.selectedLayerId = null;
        stopPainting();

        if (els.svgPreview) {
            els.svgPreview.removeAttribute("viewBox");
            els.svgPreview.replaceChildren();
        }
        renderLayerList();
        renderToolsPanel();
    };

    const syncLayersToPalette = (): void => {
        const existingByPaletteIndex = createLayerByPaletteIndexMap();
        state.layers = state.palette.map((rgb, index) => {
            const existing = existingByPaletteIndex.get(index);
            const nextColor = rgbToHex(rgb as [number, number, number]);
            if (existing) {
                return {
                    ...existing,
                    color: nextColor,
                    paletteIndex: index,
                };
            }

            return {
                id: `layer-${index + 1}`,
                color: nextColor,
                opacity: 100,
                paletteIndex: index,
            };
        });
    };

    const runLivePipeline = async (): Promise<void> => {
        const file = state.imageInput.file;
        if (!file) {
            resetRenderState();
            setStatus(STATUS.chooseImage);
            return;
        }

        await runQuantizationPreview();
        if (!state.preview.indexedPixels || !state.palette.length) {
            renderToolsPanel();
            return;
        }

        syncLayersToPalette();
        syncEditingLayerSelection();
        syncEditingLayerMasks();
        renderLayerList();
        renderToolsPanel();
        requestRender();
        setStatus(STATUS.layersGenerated);
    };

    /**
        * Render editable layer rows and actions.
     */
    const renderLayerList = (): void => {
        if (!els.layersList) {
            updateColorsFyiLink();
            return;
        }

        els.layersList.innerHTML = "";

        const backgroundItem = document.createElement("li");
        backgroundItem.dataset.layerId = "background";
        backgroundItem.innerHTML = `
            <label>
                <span>Background color</span>
                <input data-action="background-recolor" type="color" value="${state.background.color}" />
            </label>
            <label>
                <span>Opacity</span>
                <input data-lpignore="true" data-action="background-opacity" type="range" min="0" max="100" step="1" value="${state.background.opacity}" />
            </label>
        `;
        els.layersList.appendChild(backgroundItem);

        if (!state.layers.length) {
            const emptyItem = document.createElement("li");
            emptyItem.textContent = EMPTY_LAYERS_TEXT;
            els.layersList.appendChild(emptyItem);
            updateColorsFyiLink();
            return;
        }

        for (let index = 0; index < state.layers.length; index += 1) {
            const layer = state.layers[index];
            const layerItem = document.createElement("li");
            layerItem.dataset.layerId = layer.id;
            const layerEditMode = layer.id === state.editing.selectedLayerId
                ? state.editing.mode
                : "none";
            const showStrokeSize = layer.id === state.editing.selectedLayerId && state.editing.mode !== "none";
            const strokeVisibility = showStrokeSize ? "visible" : "hidden";
            const strokeDisabled = showStrokeSize ? "" : " disabled";
            layerItem.innerHTML = `
                <label>
                    <span>Color</span>
                    <input data-action="recolor" type="color" value="${layer.color}" />
                </label>
                <label>
                    <span>Opacity</span>
                    <input data-lpignore="true"  data-action="opacity" type="range" min="0" max="100" step="1" value="${layer.opacity}" />
                </label>
                <label>
                    <span>Edit mode</span>
                    <select data-action="edit-mode" data-mode="${layerEditMode}" aria-label="Edit mode for layer ${index + 1}">
                        <option value="none"${layerEditMode === "none" ? " selected" : ""}>None</option>
                        <option value="draw"${layerEditMode === "draw" ? " selected" : ""}>Draw</option>
                        <option value="erase"${layerEditMode === "erase" ? " selected" : ""}>Erase</option>
                    </select>
                </label>
                <label style="visibility: ${strokeVisibility};"${showStrokeSize ? "" : ' aria-hidden="true"'}>
                    <span>Stroke width</span>
                    <input data-action="stroke-size" type="number" min="${MIN_STROKE_SIZE}" max="${MAX_STROKE_SIZE}" step="1" value="${state.editing.strokeSize}"${strokeDisabled} />
                </label>
                <button data-action="delete" type="button">Delete</button>
            `;
            els.layersList.appendChild(layerItem);
        }

        updateColorsFyiLink();
    };

    /**
        * Render worker-generated layer PNGs into SVG image nodes.
     */
    const renderWithWebGL = async (): Promise<boolean> => {
        if (!els.svgPreview || !state.preview.indexedPixels) {
            return false;
        }

        // Reject stale render completions after newer edits/reorders.
        const requestToken = ++state.render.requestToken;

        const nextUrls: string[] = [];
        try {
            const layerBytes = state.editing.hasEdits
                ? await renderEditedLayersWithWebGL()
                : await renderLayersWithWebGL({
                    width: state.preview.width,
                    height: state.preview.height,
                    indexedPixels: state.preview.indexedPixels,
                    layers: state.layers.map((layer) => ({
                        paletteIndex: layer.paletteIndex,
                        color: layer.color,
                        opacity: layer.opacity,
                    })),
                });

            if (requestToken !== state.render.requestToken) {
                return false;
            }

            const previousUrls = state.render.objectUrls;
            const nextLayerGroup = document.createElementNS(IMAGE_NS, "g");
            const backgroundRect = document.createElementNS(IMAGE_NS, "rect");
            backgroundRect.setAttribute("x", "0");
            backgroundRect.setAttribute("y", "0");
            backgroundRect.setAttribute("width", String(state.preview.width));
            backgroundRect.setAttribute("height", String(state.preview.height));
            backgroundRect.setAttribute("fill", state.background.color);
            backgroundRect.setAttribute("fill-opacity", String(clamp(state.background.opacity, 0, 100) / 100));
            nextLayerGroup.appendChild(backgroundRect);

            const layerLoadPromises: Promise<void>[] = [];
            for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex += 1) {
                const layer = state.layers[layerIndex];
                const layerBytesPart = new Uint8Array(layerBytes[layerIndex]);
                const layerUrl = URL.createObjectURL(new Blob([layerBytesPart], { type: "image/png" }));
                nextUrls.push(layerUrl);
                const svgImage = document.createElementNS(IMAGE_NS, "image");
                layerLoadPromises.push(waitForSvgImageLoad(svgImage));
                svgImage.setAttribute("href", layerUrl);
                svgImage.setAttribute("x", "0");
                svgImage.setAttribute("y", "0");
                svgImage.setAttribute("width", String(state.preview.width));
                svgImage.setAttribute("height", String(state.preview.height));
                svgImage.setAttribute(
                    "transform",
                    `translate(0 ${state.preview.height}) scale(1 -1)`
                );
                svgImage.setAttribute("data-layer-id", layer.id);
                svgImage.setAttribute("aria-label", `Layer ${layerIndex + 1}`);
                nextLayerGroup.appendChild(svgImage);
            }

            await Promise.all(layerLoadPromises);
            if (requestToken !== state.render.requestToken) {
                revokeObjectUrls(nextUrls);
                return false;
            }

            els.svgPreview.setAttribute("viewBox", `0 0 ${state.preview.width} ${state.preview.height}`);
            els.svgPreview.replaceChildren(nextLayerGroup);
            attachPaintOverlayToSvg();

            if (clearPreviewAfterRender) {
                clearPaintOverlay();
                clearLiveEraseMaskPreview();
                clearPreviewAfterRender = false;
            }

            state.render.objectUrls = nextUrls;
            revokeObjectUrls(previousUrls);
            updatePreviewCursor();
            return true;
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error("Layer rendering failed", error);
            }
            revokeObjectUrls(nextUrls);
            setStatus(STATUS.webglRequired);
            return false;
        }
    };

    const getEditedLayerWebGL = (width: number, height: number): EditedLayerWebGLState => {
        if (editedLayerGLState && editedLayerGLState.width === width && editedLayerGLState.height === height) {
            return editedLayerGLState;
        }

        if (editedLayerGLState) {
            const { gl, program, positionBuffer, indexTexture, maskTexture } = editedLayerGLState;
            gl.deleteTexture(indexTexture);
            gl.deleteTexture(maskTexture);
            gl.deleteBuffer(positionBuffer);
            gl.deleteProgram(program);
            editedLayerGLState = null;
        }

        const canvas = new OffscreenCanvas(width, height);
        const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true }) as WebGLRenderingContext | null;
        if (!gl) {
            throw new Error("WebGL is required for layer rendering.");
        }

        const vertexSource = `
            attribute vec2 a_position;
            varying vec2 v_uv;
            void main() {
                v_uv = (a_position + 1.0) * 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        // Mask texture encoding: 0.0=force-hide, ~0.5=neutral(use base), 1.0=force-show
        const fragmentSource = `
            precision mediump float;
            varying vec2 v_uv;
            uniform sampler2D u_indexTexture;
            uniform sampler2D u_maskTexture;
            uniform float u_targetIndex;
            uniform vec3 u_layerColor;
            uniform float u_layerAlpha;
            void main() {
                float baseVal = texture2D(u_indexTexture, v_uv).r * 255.0;
                float maskVal = texture2D(u_maskTexture, v_uv).r;
                float baseMatch = abs(baseVal - u_targetIndex) < 0.5 ? 1.0 : 0.0;
                float forceShow = step(0.75, maskVal);
                float forceHide = 1.0 - step(0.25, maskVal);
                float visible = clamp(baseMatch + forceShow - forceHide, 0.0, 1.0);
                gl_FragColor = vec4(u_layerColor, visible * u_layerAlpha);
            }
        `;

        const compileShader = (type: number, source: string): WebGLShader => {
            const shader = gl.createShader(type);
            if (!shader) { throw new Error("Failed to create shader."); }
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            return shader;
        };

        const vert = compileShader(gl.VERTEX_SHADER, vertexSource);
        const frag = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
        const program = gl.createProgram();
        if (!program) { throw new Error("Failed to create WebGL program for edited layer rendering."); }
        gl.attachShader(program, vert);
        gl.attachShader(program, frag);
        gl.linkProgram(program);
        gl.deleteShader(vert);
        gl.deleteShader(frag);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error("Failed to link WebGL program for edited layer rendering.");
        }

        const positionLocation = gl.getAttribLocation(program, "a_position");
        const indexTextureLocation = gl.getUniformLocation(program, "u_indexTexture");
        const maskTextureLocation = gl.getUniformLocation(program, "u_maskTexture");
        const targetIndexLocation = gl.getUniformLocation(program, "u_targetIndex");
        const layerColorLocation = gl.getUniformLocation(program, "u_layerColor");
        const layerAlphaLocation = gl.getUniformLocation(program, "u_layerAlpha");
        if (!indexTextureLocation || !maskTextureLocation || !targetIndexLocation || !layerColorLocation || !layerAlphaLocation) {
            throw new Error("Failed to resolve WebGL uniforms for edited layer rendering.");
        }

        const positionBuffer = gl.createBuffer();
        if (!positionBuffer) { throw new Error("Failed to create position buffer."); }
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        const makeTexture = (): WebGLTexture => {
            const tex = gl.createTexture();
            if (!tex) { throw new Error("Failed to create WebGL texture."); }
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return tex;
        };

        const indexTexture = makeTexture();
        const maskTexture = makeTexture();

        gl.useProgram(program);
        gl.viewport(0, 0, width, height);
        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(indexTextureLocation, 0);
        gl.uniform1i(maskTextureLocation, 1);

        editedLayerGLState = {
            canvas, gl, program,
            positionLocation, positionBuffer,
            indexTexture, maskTexture,
            indexTextureLocation, maskTextureLocation,
            targetIndexLocation, layerColorLocation, layerAlphaLocation,
            width, height,
        };

        return editedLayerGLState;
    };

    const renderEditedLayersWithWebGL = async (): Promise<Uint8Array[]> => {
        const width = state.preview.width;
        const height = state.preview.height;
        const pixelCount = width * height;
        const baseIndexedPixels = state.preview.baseIndexedPixels || state.preview.indexedPixels;
        if (!baseIndexedPixels) {
            throw new Error("No pixel data for edited layer rendering.");
        }

        const glState = getEditedLayerWebGL(width, height);
        const { canvas, gl, indexTexture, maskTexture, targetIndexLocation, layerColorLocation, layerAlphaLocation } = glState;
        const supportsLuminance = typeof gl.LUMINANCE === "number";

        // Upload index texture once — same for all layers in this pass.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, indexTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (supportsLuminance) {
            const indexBytes = new Uint8Array(pixelCount);
            for (let i = 0; i < pixelCount; i += 1) { indexBytes[i] = baseIndexedPixels[i]; }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, indexBytes);
        } else {
            const indexBytes = new Uint8Array(pixelCount * 4);
            for (let i = 0; i < pixelCount; i += 1) { indexBytes[i * 4] = baseIndexedPixels[i]; indexBytes[i * 4 + 3] = 255; }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, indexBytes);
        }
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

        const layerPngs: Uint8Array[] = [];
        for (const layer of state.layers) {
            // Encode mask: 255=force-show, 128=neutral, 0=force-hide
            const mask = state.editing.layerMasks[layer.id];
            const maskBytes = new Uint8Array(pixelCount);
            for (let i = 0; i < pixelCount; i += 1) {
                const v = mask?.[i] || 0;
                maskBytes[i] = v > 0 ? 255 : v < 0 ? 0 : 128;
            }

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, maskTexture);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            if (supportsLuminance) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, maskBytes);
            } else {
                const maskBytesRgba = new Uint8Array(pixelCount * 4);
                for (let i = 0; i < pixelCount; i += 1) { maskBytesRgba[i * 4] = maskBytes[i]; maskBytesRgba[i * 4 + 3] = 255; }
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, maskBytesRgba);
            }
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

            const [r, g, b] = hexToRgb(layer.color);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, indexTexture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, maskTexture);
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

        return layerPngs;
    };

    const renderEditedLayersInMainThread = async (): Promise<Uint8Array[]> => {
        const width = state.preview.width;
        const height = state.preview.height;
        const pixelCount = width * height;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            throw new Error("Canvas features are unavailable in this browser/device.");
        }

        const layerBytes: Uint8Array[] = [];
        for (const layer of state.layers) {
            const [r, g, b] = hexToRgb(layer.color);
            const alpha = clamp(Math.round((layer.opacity / 100) * 255), 0, 255);
            const imageData = context.createImageData(width, height);

            for (let i = 0; i < pixelCount; i += 1) {
                if (!isLayerVisibleAtPixel(layer, i)) {
                    continue;
                }

                const y = Math.floor(i / width);
                const x = i - y * width;
                const flippedIndex = (height - 1 - y) * width + x;
                const pixelOffset = flippedIndex * 4;
                imageData.data[pixelOffset] = r;
                imageData.data[pixelOffset + 1] = g;
                imageData.data[pixelOffset + 2] = b;
                imageData.data[pixelOffset + 3] = alpha;
            }

            context.putImageData(imageData, 0, 0);
            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, "image/png");
            });
            if (!blob) {
                throw new Error("Failed to build edited layer PNG.");
            }
            const bytes = new Uint8Array(await blob.arrayBuffer());
            layerBytes.push(bytes);
        }

        return layerBytes;
    };

    const renderEditedCompositePreviewInMainThread = async (): Promise<Uint8Array> => {
        const width = state.preview.width;
        const height = state.preview.height;
        const pixelCount = width * height;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            throw new Error("Canvas features are unavailable in this browser/device.");
        }

        const [bgR, bgG, bgB] = hexToRgb(state.background.color);
        const bgA = clamp(Math.round((state.background.opacity / 100) * 255), 0, 255);
        const imageData = context.createImageData(width, height);

        const selectedLayer = getSelectedEditableLayer();
        const shouldFreezeOtherLayers = Boolean(state.editing.isPainting && selectedLayer);

        const blendPixel = (
            data: Uint8ClampedArray,
            pixelOffset: number,
            fgR: number,
            fgG: number,
            fgB: number,
            fgA: number,
        ): void => {
            const bgRLocal = data[pixelOffset];
            const bgGLocal = data[pixelOffset + 1];
            const bgBLocal = data[pixelOffset + 2];
            const bgALocal = data[pixelOffset + 3];
            const fgAlpha = fgA / 255;
            const bgAlpha = bgALocal / 255;
            const outAlpha = fgAlpha + bgAlpha * (1 - fgAlpha);

            if (outAlpha <= 0) {
                data[pixelOffset] = 0;
                data[pixelOffset + 1] = 0;
                data[pixelOffset + 2] = 0;
                data[pixelOffset + 3] = 0;
                return;
            }

            data[pixelOffset] = Math.round((fgR * fgAlpha + bgRLocal * bgAlpha * (1 - fgAlpha)) / outAlpha);
            data[pixelOffset + 1] = Math.round((fgG * fgAlpha + bgGLocal * bgAlpha * (1 - fgAlpha)) / outAlpha);
            data[pixelOffset + 2] = Math.round((fgB * fgAlpha + bgBLocal * bgAlpha * (1 - fgAlpha)) / outAlpha);
            data[pixelOffset + 3] = Math.round(outAlpha * 255);
        };

        if (shouldFreezeOtherLayers && selectedLayer) {
            const cacheKeyParts = [
                `${width}x${height}`,
                `${state.background.color}:${state.background.opacity}`,
                `selected:${selectedLayer.id}`,
            ];
            for (const layer of state.layers) {
                if (layer.id === selectedLayer.id) {
                    continue;
                }
                cacheKeyParts.push(
                    `${layer.id}:${layer.color}:${layer.opacity}:${state.editing.maskVersionByLayer[layer.id] || 0}`
                );
            }
            const cacheKey = cacheKeyParts.join("|");

            if (!editedPreviewCache || editedPreviewCache.key !== cacheKey) {
                const cachedRgba = new Uint8ClampedArray(pixelCount * 4);
                for (let i = 0; i < pixelCount; i += 1) {
                    let outR = bgR;
                    let outG = bgG;
                    let outB = bgB;
                    let outA = bgA;

                    for (const layer of state.layers) {
                        if (layer.id === selectedLayer.id || !isLayerVisibleAtPixel(layer, i)) {
                            continue;
                        }

                        const [fgR, fgG, fgB] = hexToRgb(layer.color);
                        const fgA = clamp(Math.round((layer.opacity / 100) * 255), 0, 255);
                        const fgAlpha = fgA / 255;
                        const bgAlpha = outA / 255;
                        const outAlpha = fgAlpha + bgAlpha * (1 - fgAlpha);

                        if (outAlpha > 0) {
                            outR = Math.round((fgR * fgAlpha + outR * bgAlpha * (1 - fgAlpha)) / outAlpha);
                            outG = Math.round((fgG * fgAlpha + outG * bgAlpha * (1 - fgAlpha)) / outAlpha);
                            outB = Math.round((fgB * fgAlpha + outB * bgAlpha * (1 - fgAlpha)) / outAlpha);
                        }
                        outA = Math.round(outAlpha * 255);
                    }

                    const y = Math.floor(i / width);
                    const x = i - y * width;
                    const flippedIndex = (height - 1 - y) * width + x;
                    const pixelOffset = flippedIndex * 4;
                    cachedRgba[pixelOffset] = outR;
                    cachedRgba[pixelOffset + 1] = outG;
                    cachedRgba[pixelOffset + 2] = outB;
                    cachedRgba[pixelOffset + 3] = outA;
                }

                editedPreviewCache = {
                    key: cacheKey,
                    rgba: cachedRgba,
                };
            }

            imageData.data.set(editedPreviewCache.rgba);

            const [selectedR, selectedG, selectedB] = hexToRgb(selectedLayer.color);
            const selectedA = clamp(Math.round((selectedLayer.opacity / 100) * 255), 0, 255);
            for (let i = 0; i < pixelCount; i += 1) {
                if (!isLayerVisibleAtPixel(selectedLayer, i)) {
                    continue;
                }

                const y = Math.floor(i / width);
                const x = i - y * width;
                const flippedIndex = (height - 1 - y) * width + x;
                const pixelOffset = flippedIndex * 4;
                blendPixel(imageData.data, pixelOffset, selectedR, selectedG, selectedB, selectedA);
            }
        } else {
            invalidateEditedPreviewCache();

            for (let i = 0; i < pixelCount; i += 1) {
                let outR = bgR;
                let outG = bgG;
                let outB = bgB;
                let outA = bgA;

                for (const layer of state.layers) {
                    if (!isLayerVisibleAtPixel(layer, i)) {
                        continue;
                    }

                    const [fgR, fgG, fgB] = hexToRgb(layer.color);
                    const fgA = clamp(Math.round((layer.opacity / 100) * 255), 0, 255);

                    const fgAlpha = fgA / 255;
                    const bgAlpha = outA / 255;
                    const outAlpha = fgAlpha + bgAlpha * (1 - fgAlpha);

                    if (outAlpha > 0) {
                        outR = Math.round((fgR * fgAlpha + outR * bgAlpha * (1 - fgAlpha)) / outAlpha);
                        outG = Math.round((fgG * fgAlpha + outG * bgAlpha * (1 - fgAlpha)) / outAlpha);
                        outB = Math.round((fgB * fgAlpha + outB * bgAlpha * (1 - fgAlpha)) / outAlpha);
                    }
                    outA = Math.round(outAlpha * 255);
                }

                const y = Math.floor(i / width);
                const x = i - y * width;
                const flippedIndex = (height - 1 - y) * width + x;
                const pixelOffset = flippedIndex * 4;
                imageData.data[pixelOffset] = outR;
                imageData.data[pixelOffset + 1] = outG;
                imageData.data[pixelOffset + 2] = outB;
                imageData.data[pixelOffset + 3] = outA;
            }
        }

        context.putImageData(imageData, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, "image/png");
        });
        if (!blob) {
            throw new Error("Failed to build edited composite preview.");
        }

        return new Uint8Array(await blob.arrayBuffer());
    };

    /**
     * Coalesce rapid render requests so color-drag updates avoid overlapping worker calls.
     */
    const requestRender = (): void => {
        if (renderInFlight) {
            renderQueued = true;
            return;
        }

        renderInFlight = true;
        void renderWithWebGL().finally(() => {
            renderInFlight = false;
            if (renderQueued) {
                renderQueued = false;
                requestRender();
            }
        });
    };

    /**
        * React to settings edits and refresh quantized preview.
     */
    const handleSettingsChanged = async (event?: Event): Promise<void> => {
        const file = els.fileInput?.files?.[0] || null;
        state.imageInput.file = file;

        if (!file) {
            state.imageInput.normalizedPngFile = null;
            state.imageInput.normalizedFromFileKey = null;
            state.imageInput.sourceWidth = null;
            state.imageInput.sourceHeight = null;
            setImageSettingsVisibility(false);
        } else {
            setImageSettingsVisibility(true);
        }

        const target = event?.target;
        if (target instanceof HTMLInputElement) {
            if (target.id === "width") {
                syncLockedAspectRatioInputs("width");
            }
            if (target.id === "height") {
                syncLockedAspectRatioInputs("height");
            }
            if (target.id === "lock-aspect-ratio") {
                syncLockedAspectRatioInputs("lock");
            }
        }

        state.settings = readSettingsForm();
        await runLivePipeline();
    };

    /**
        * Handle layer row button actions.
     */
    const handleLayerListClick = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest<HTMLButtonElement>("button[data-action]");
        if (!button) {
            return;
        }

        const layerItem = button.closest<HTMLLIElement>("li[data-layer-id]");
        if (!layerItem) {
            return;
        }

        const layerIndex = state.layers.findIndex((layer) => layer.id === layerItem.dataset.layerId);
        if (layerIndex < 0) {
            return;
        }

        const action = button.dataset.action;
        if (action === "delete") {
            state.layers.splice(layerIndex, 1);
            syncEditingLayerSelection();
            invalidateEditedPreviewCache();
        }

        renderLayerList();
        renderToolsPanel();
        requestRender();
    };

    /**
        * Handle layer controls (recolor, opacity, edit mode, stroke size).
     */
    const handleLayerListInput = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const control = target.closest<HTMLInputElement | HTMLSelectElement>("input[data-action], select[data-action]");
        if (!control) {
            return;
        }

        const layerItem = control.closest<HTMLLIElement>("li[data-layer-id]");
        if (!layerItem) {
            return;
        }

        const layer = state.layers.find((item) => item.id === layerItem.dataset.layerId);
        const action = control.dataset.action;
        if (action === "background-recolor") {
            if (!(control instanceof HTMLInputElement)) {
                return;
            }
            state.background.color = control.value;
            updateColorsFyiLink();
            invalidateEditedPreviewCache();
            requestRender();
            return;
        }
        if (action === "background-opacity") {
            if (!(control instanceof HTMLInputElement)) {
                return;
            }
            state.background.opacity = clamp(Number(control.value), 0, 100);
            invalidateEditedPreviewCache();
            requestRender();
            return;
        }

        if (!layer) {
            return;
        }

        if (action === "edit-mode" && control instanceof HTMLSelectElement) {
            const nextMode = (["none", "draw", "erase"].includes(control.value)
                ? control.value
                : "none") as ToolMode;
            stopPainting();
            if (nextMode === "none") {
                if (state.editing.selectedLayerId === layer.id) {
                    state.editing.mode = "none";
                }
            } else {
                state.editing.selectedLayerId = layer.id;
                state.editing.mode = nextMode;
            }
            invalidateEditedPreviewCache();
            renderLayerList();
            renderToolsPanel();
            attachPaintOverlayToSvg();
            return;
        }
        if (action === "stroke-size" && control instanceof HTMLInputElement) {
            state.editing.strokeSize = clamp(Number(control.value) || DEFAULT_STROKE_SIZE, MIN_STROKE_SIZE, MAX_STROKE_SIZE);
            renderLayerList();
            updatePreviewCursor();
            return;
        }
        if (action === "recolor" && control instanceof HTMLInputElement) {
            layer.color = control.value;
            updateColorsFyiLink();
            invalidateEditedPreviewCache();
            requestRender();
        }
        if (action === "opacity" && control instanceof HTMLInputElement) {
            const nextOpacity = Number(control.value);
            layer.opacity = clamp(nextOpacity, 0, 100);
            invalidateEditedPreviewCache();
            requestRender();
        }
    };

    /**
        * Export a flattened recolored PNG using current layer mapping.
     */
    const exportFlattenedPng = async (): Promise<void> => {
        if (!state.preview.indexedPixels || !state.layers.length) {
            setStatus(STATUS.generateLayersFirst);
            return;
        }

        const layerByPaletteIndex = createLayerByPaletteIndexMap();
        const maxPaletteIndex = state.layers.reduce((max, layer) => {
            return Math.max(max, layer.paletteIndex);
        }, 0);
        const colorByPaletteIndex = new Uint8Array((maxPaletteIndex + 1) * 3);
        const alphaByPaletteIndex = new Uint8Array(maxPaletteIndex + 1);
        const hasColorForPaletteIndex = new Uint8Array(maxPaletteIndex + 1);
        for (const layer of layerByPaletteIndex.values()) {
            const [r, g, b] = hexToRgb(layer.color);
            const baseOffset = layer.paletteIndex * 3;
            colorByPaletteIndex[baseOffset] = r;
            colorByPaletteIndex[baseOffset + 1] = g;
            colorByPaletteIndex[baseOffset + 2] = b;
            alphaByPaletteIndex[layer.paletteIndex] = Math.round((layer.opacity / 100) * 255);
            hasColorForPaletteIndex[layer.paletteIndex] = 1;
        }

        const [bgR, bgG, bgB] = hexToRgb(state.background.color);
        const bgA = clamp(Math.round((state.background.opacity / 100) * 255), 0, 255);

        const canvas = document.createElement("canvas");
        canvas.width = state.preview.width;
        canvas.height = state.preview.height;
        const context = canvas.getContext("2d");
        if (!context) {
            setStatus(STATUS.canvasUnavailable);
            return;
        }

        const composite = context.createImageData(state.preview.width, state.preview.height);
        for (let i = 0; i < state.preview.indexedPixels.length; i += 1) {
            const pixelOffset = i * 4;
            let outR = bgR;
            let outG = bgG;
            let outB = bgB;
            let outA = bgA;

            for (const layer of state.layers) {
                if (!isLayerVisibleAtPixel(layer, i)) {
                    continue;
                }

                if (layer.paletteIndex > maxPaletteIndex || !hasColorForPaletteIndex[layer.paletteIndex]) {
                    continue;
                }

                const baseOffset = layer.paletteIndex * 3;
                const fgR = colorByPaletteIndex[baseOffset];
                const fgG = colorByPaletteIndex[baseOffset + 1];
                const fgB = colorByPaletteIndex[baseOffset + 2];
                const fgA = alphaByPaletteIndex[layer.paletteIndex];

                const fgAlpha = fgA / 255;
                const bgAlpha = outA / 255;
                const outAlpha = fgAlpha + bgAlpha * (1 - fgAlpha);

                if (outAlpha > 0) {
                    outR = Math.round((fgR * fgAlpha + outR * bgAlpha * (1 - fgAlpha)) / outAlpha);
                    outG = Math.round((fgG * fgAlpha + outG * bgAlpha * (1 - fgAlpha)) / outAlpha);
                    outB = Math.round((fgB * fgAlpha + outB * bgAlpha * (1 - fgAlpha)) / outAlpha);
                }
                outA = Math.round(outAlpha * 255);
            }

            composite.data[pixelOffset] = outR;
            composite.data[pixelOffset + 1] = outG;
            composite.data[pixelOffset + 2] = outB;
            composite.data[pixelOffset + 3] = outA;
        }
        context.putImageData(composite, 0, 0);

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) {
            setStatus(STATUS.canvasUnavailable);
            return;
        }

        const originalBytes = new Uint8Array(await blob.arrayBuffer());
        let outputBytes: Uint8Array = originalBytes;
        setStatus(STATUS.optimizingPng);
        try {
            const candidateLevels = OXIPNG_LEVEL_CANDIDATES.filter((level) => level >= DEFAULT_OXIPNG_LEVEL);
            const optimizedCandidates = await Promise.all(
                candidateLevels.map((level) => optimizePngWithOxi(originalBytes, level))
            );

            outputBytes = optimizedCandidates.reduce((smallest, candidate) => {
                return candidate.byteLength < smallest.byteLength ? candidate : smallest;
            }, originalBytes);
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error("oxipng optimization failed, using unoptimized PNG", error);
            }
        }

        const link = document.createElement("a");
        link.download = "color-layers.png";
        link.href = URL.createObjectURL(new Blob([new Uint8Array(outputBytes)], { type: "image/png" }));
        link.click();
        URL.revokeObjectURL(link.href);
        setStatus(STATUS.exportedPng);
    };

    /**
        * Initialize controller after DOM is available.
     */
    const init = (): void => {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init, { once: true });
            return;
        }

        cacheElements();
        if (!els.fileInput || !els.colorCountInput) {
            return;
        }

        els.colorCountInput.value = String(DEFAULT_COLOR_COUNT);
        if (els.ditheringInput) {
            els.ditheringInput.value = String(DEFAULT_DITHERING);
        }
        if (els.contrastInput) {
            els.contrastInput.value = String(DEFAULT_CONTRAST);
        }
        if (els.lightnessInput) {
            els.lightnessInput.value = String(DEFAULT_LIGHTNESS);
        }
        if (els.speckleCleanupInput) {
            els.speckleCleanupInput.value = String(DEFAULT_SPECKLE_CLEANUP);
        }
        if (els.layoutModeInput) {
            applyLayoutMode(els.layoutModeInput.value);
        }
        setImageSettingsVisibility(false);
        setStatus(STATUS.chooseImage);
        updateColorsFyiLink();
        renderToolsPanel();

        els.fileInput.addEventListener("change", handleSettingsChanged);
        els.colorCountInput.addEventListener("input", handleSettingsChanged);
        els.ditheringInput?.addEventListener("input", handleSettingsChanged);
        els.contrastInput?.addEventListener("input", handleSettingsChanged);
        els.lightnessInput?.addEventListener("input", handleSettingsChanged);
        els.speckleCleanupInput?.addEventListener("input", handleSettingsChanged);
        els.widthInput?.addEventListener("input", handleSettingsChanged);
        els.heightInput?.addEventListener("input", handleSettingsChanged);
        els.lockAspectRatioInput?.addEventListener("change", handleSettingsChanged);
        els.layoutModeInput?.addEventListener("change", () => {
            applyLayoutMode(els.layoutModeInput?.value || "side-by-side");
        });
        els.layersList?.addEventListener("click", handleLayerListClick);
        els.layersList?.addEventListener("input", handleLayerListInput);
        els.svgPreview?.addEventListener("pointerdown", handlePreviewPointerDown);
        els.svgPreview?.addEventListener("pointermove", handlePreviewPointerMove);
        els.svgPreview?.addEventListener("pointerup", handlePreviewPointerUp);
        els.svgPreview?.addEventListener("pointercancel", handlePreviewPointerUp);
        els.svgPreview?.addEventListener("pointerleave", stopPainting);
        window.addEventListener("pointerup", stopPainting);
        window.addEventListener("resize", updatePreviewCursor);
        els.exportButton?.addEventListener("click", exportFlattenedPng);
    };

    init();
};
