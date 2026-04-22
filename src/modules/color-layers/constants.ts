/**
 * Configuration constants for the Color Layers application.
 */

// SVG and XML namespaces
export const IMAGE_NS = "http://www.w3.org/2000/svg";
export const XHTML_NS = "http://www.w3.org/1999/xhtml";

// SVG mask IDs
export const TEMP_ERASE_MASK_ID = "paint-erase-mask";

// Default settings
export const DEFAULT_COLOR_COUNT = 6;
export const DEFAULT_DITHERING = 0.85;
export const DEFAULT_CONTRAST = 1;
export const DEFAULT_LIGHTNESS = 0;
export const DEFAULT_SPECKLE_CLEANUP = 0;
export const DEFAULT_STROKE_SIZE = 24;

// Stroke size constraints
export const MIN_STROKE_SIZE = 1;
export const MAX_STROKE_SIZE = 512;

// PNG optimization
export const DEFAULT_OXIPNG_LEVEL = 2;
export const OXIPNG_LEVEL_CANDIDATES = [2, 3, 4, 5, 6] as const;

// Color palette constraints
export const MIN_COLOR_COUNT = 2;
export const MAX_COLOR_COUNT = 32;

// Special palette indices
export const BACKGROUND_SENTINEL_INDEX = 255;

// UI text
export const EMPTY_LAYERS_TEXT = "No layers yet. Upload an image to begin.";

/**
 * Status messages displayed to the user.
 * Centralized here to make it easy to find and maintain messages.
 */
export const STATUS = {
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
