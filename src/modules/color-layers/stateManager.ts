/**
 * State initialization and management for the Color Layers application.
 * Provides factory functions to create initial state and helper functions for state access.
 */

import type {
    AppState,
    CachedElements,
} from "./types";
import { DEFAULT_COLOR_COUNT, DEFAULT_DITHERING, DEFAULT_CONTRAST, DEFAULT_LIGHTNESS, DEFAULT_SPECKLE_CLEANUP, DEFAULT_STROKE_SIZE } from "./constants";

/**
 * Create an empty AppState with all default values.
 * @returns Fresh AppState instance ready for initialization
 */
export const createInitialState = (): AppState => {
    return {
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
};

/**
 * Create an empty CachedElements map.
 * @returns CachedElements with all values set to null
 */
export const createEmptyElements = (): CachedElements => ({
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
