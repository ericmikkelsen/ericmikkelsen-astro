/**
 * Type definitions for the Color Layers application.
 */

export type ToolMode = "none" | "draw" | "erase";

/**
 * Represents a single editable color layer.
 */
export type Layer = {
    id: string;
    color: string;
    opacity: number;
    paletteIndex: number;
};

/**
 * Background layer configuration.
 */
export type BackgroundLayer = {
    color: string;
    opacity: number;
};

/**
 * Editing state: tracks drawing/erasing mode, selected layer, stroke size, and masks.
 */
export type EditingState = {
    mode: ToolMode;
    selectedLayerId: string | null;
    strokeSize: number;
    hasEdits: boolean;
    layerMasks: Record<string, Int8Array>;
    maskVersionByLayer: Record<string, number>;
    isPainting: boolean;
    lastPaintPoint: { x: number; y: number } | null;
};

/**
 * Image input state: tracks uploaded file and normalized PNG output.
 */
export type ImageInputState = {
    file: File | null;
    prefilledFileKey: string | null;
    normalizedPngFile: File | null;
    normalizedFromFileKey: string | null;
    sourceWidth: number | null;
    sourceHeight: number | null;
};

/**
 * Image settings: color count, dithering, contrast, dimensions, etc.
 */
export type SettingsState = {
    colorCount: number;
    dithering: number;
    contrast: number;
    lightness: number;
    speckleCleanup: number;
    lockAspectRatio: boolean;
    width: number;
    height: number;
};

/**
 * Preview state: quantization output (indexed pixels, palette, RGBA bitmap).
 */
export type PreviewState = {
    requestToken: number;
    width: number;
    height: number;
    baseIndexedPixels: Uint16Array | null;
    indexedPixels: Uint16Array | null;
    quantizedRgba: Uint8ClampedArray | null;
};

/**
 * Render state: tracks async render requests and generated layer PNGs.
 */
export type RenderState = {
    requestToken: number;
    objectUrls: string[];
};

/**
 * Complete application state: single source of truth for all data.
 */
export type AppState = {
    imageInput: ImageInputState;
    settings: SettingsState;
    palette: number[][];
    preview: PreviewState;
    render: RenderState;
    background: BackgroundLayer;
    editing: EditingState;
    layers: Layer[];
};

/**
 * DOM element cache: all queryable elements for quick access.
 */
export type CachedElements = {
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

/**
 * WebGL rendering state for editing layers.
 * Caches the WebGL context and related resources to avoid re-initialization.
 */
export type EditedLayerWebGLState = {
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

/**
 * Cache entry for pre-rendered composite previews with frozen background.
 */
export type EditedPreviewCache = {
    key: string;
    rgba: Uint8ClampedArray;
};
