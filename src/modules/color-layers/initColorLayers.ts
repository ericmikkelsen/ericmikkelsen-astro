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
const DEFAULT_COLOR_COUNT = 6;
const DEFAULT_DITHERING = 0.85;
const DEFAULT_CONTRAST = 1;
const DEFAULT_LIGHTNESS = 0;
const DEFAULT_SPECKLE_CLEANUP = 0;
const DEFAULT_OXIPNG_LEVEL = 2;
const OXIPNG_LEVEL_CANDIDATES = [2, 3, 4, 5, 6] as const;
const MIN_COLOR_COUNT = 2;
const MAX_COLOR_COUNT = 32;
const EMPTY_LAYERS_TEXT = "No layers yet. Upload an image to begin.";

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
    name: string;
    color: string;
    opacity: number;
    paletteIndex: number;
};

type BackgroundLayer = {
    color: string;
    opacity: number;
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
        indexedPixels: Uint16Array | null;
        quantizedRgba: Uint8ClampedArray | null;
    };
    render: {
        requestToken: number;
        objectUrls: string[];
    };
    background: BackgroundLayer;
    layers: Layer[];
};

type CachedElements = {
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
    settingsStatus: HTMLOutputElement | null;
    layersList: HTMLUListElement | null;
    svgPreview: SVGSVGElement | null;
    colorsFyiLink: HTMLAnchorElement | null;
    exportButton: HTMLButtonElement | null;
};

// DOM cache bootstrap

const emptyElements = (): CachedElements => ({
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
    settingsStatus: null,
    layersList: null,
    svgPreview: null,
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
        layers: [],
    };

    let els: CachedElements = emptyElements();
    let renderInFlight = false;
    let renderQueued = false;

    /**
     * Cache the DOM nodes used by this controller.
     */
    const cacheElements = (): void => {
        els = {
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
            settingsStatus: document.querySelector<HTMLOutputElement>("#settings-status"),
            layersList: document.querySelector<HTMLUListElement>("#layers-list"),
            svgPreview: document.querySelector<SVGSVGElement>("#layer-preview"),
            colorsFyiLink: document.querySelector<HTMLAnchorElement>("#colors-fyi-link"),
            exportButton: document.querySelector<HTMLButtonElement>("#export-png"),
        };
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

    /**
        * Write status text to the settings output region.
     */
    const setStatus = (message: string): void => {
        if (els.settingsStatus) {
            els.settingsStatus.textContent = message;
        }
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

    const getFileKey = (file: File): string => {
        return `${file.name}:${file.size}:${file.lastModified}`;
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
            state.preview.quantizedRgba = result.quantizedRgba;

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
        state.preview.indexedPixels = null;
        state.preview.quantizedRgba = null;
        state.imageInput.prefilledFileKey = null;
        state.render.requestToken += 1;
        revokeObjectUrls(state.render.objectUrls);
        state.render.objectUrls = [];

        if (els.svgPreview) {
            els.svgPreview.removeAttribute("viewBox");
            els.svgPreview.replaceChildren();
        }
        renderLayerList();
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
                name: `Layer ${index + 1}`,
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
            return;
        }

        syncLayersToPalette();
        renderLayerList();
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
                <input data-action="background-opacity" type="range" min="0" max="100" step="1" value="${state.background.opacity}" />
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
            layerItem.innerHTML = `
                <label>
                    <span>Layer name</span>
                    <input data-action="rename" type="text" value="${escapeHtml(layer.name)}" />
                </label>
                <label>
                    <span>Color</span>
                    <input data-action="recolor" type="color" value="${layer.color}" />
                </label>
                <label>
                    <span>Opacity</span>
                    <input data-action="opacity" type="range" min="0" max="100" step="1" value="${layer.opacity}" />
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
            const layerBytes = await renderLayersWithWebGL({
                width: state.preview.width,
                height: state.preview.height,
                indexedPixels: state.preview.indexedPixels,
                layers: state.layers.map((layer) => ({
                    paletteIndex: layer.paletteIndex,
                    color: layer.color,
                    opacity: layer.opacity,
                    name: layer.name,
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
                svgImage.setAttribute("aria-label", layer.name);
                nextLayerGroup.appendChild(svgImage);
            }

            await Promise.all(layerLoadPromises);
            if (requestToken !== state.render.requestToken) {
                revokeObjectUrls(nextUrls);
                return false;
            }

            els.svgPreview.setAttribute("viewBox", `0 0 ${state.preview.width} ${state.preview.height}`);
            els.svgPreview.replaceChildren(nextLayerGroup);

            state.render.objectUrls = nextUrls;
            revokeObjectUrls(previousUrls);
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
        }

        renderLayerList();
        requestRender();
    };

    /**
        * Handle layer rename/recolor input changes.
     */
    const handleLayerListInput = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const input = target.closest<HTMLInputElement>("input[data-action]");
        if (!input) {
            return;
        }

        const layerItem = input.closest<HTMLLIElement>("li[data-layer-id]");
        if (!layerItem) {
            return;
        }

        const layer = state.layers.find((item) => item.id === layerItem.dataset.layerId);
        const action = input.dataset.action;
        if (action === "background-recolor") {
            state.background.color = input.value;
            updateColorsFyiLink();
            requestRender();
            return;
        }
        if (action === "background-opacity") {
            state.background.opacity = clamp(Number(input.value), 0, 100);
            requestRender();
            return;
        }

        if (!layer) {
            return;
        }

        if (action === "rename") {
            layer.name = input.value || layer.name;
        }
        if (action === "recolor") {
            layer.color = input.value;
            updateColorsFyiLink();
            requestRender();
        }
        if (action === "opacity") {
            const nextOpacity = Number(input.value);
            layer.opacity = clamp(nextOpacity, 0, 100);
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

            const paletteIndex = state.preview.indexedPixels[i];
            if (paletteIndex <= maxPaletteIndex && hasColorForPaletteIndex[paletteIndex]) {
                const baseOffset = paletteIndex * 3;
                const fgR = colorByPaletteIndex[baseOffset];
                const fgG = colorByPaletteIndex[baseOffset + 1];
                const fgB = colorByPaletteIndex[baseOffset + 2];
                const fgA = alphaByPaletteIndex[paletteIndex];

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
        setImageSettingsVisibility(false);
        setStatus(STATUS.chooseImage);
        updateColorsFyiLink();

        els.fileInput.addEventListener("change", handleSettingsChanged);
        els.colorCountInput.addEventListener("input", handleSettingsChanged);
        els.ditheringInput?.addEventListener("input", handleSettingsChanged);
        els.contrastInput?.addEventListener("input", handleSettingsChanged);
        els.lightnessInput?.addEventListener("input", handleSettingsChanged);
        els.speckleCleanupInput?.addEventListener("input", handleSettingsChanged);
        els.widthInput?.addEventListener("input", handleSettingsChanged);
        els.heightInput?.addEventListener("input", handleSettingsChanged);
        els.lockAspectRatioInput?.addEventListener("change", handleSettingsChanged);
        els.layersList?.addEventListener("click", handleLayerListClick);
        els.layersList?.addEventListener("input", handleLayerListInput);
        els.exportButton?.addEventListener("click", exportFlattenedPng);
    };

    init();
};
