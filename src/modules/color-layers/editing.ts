/**
 * Editing operations: painting, erasing, brush strokes, and layer masks.
 * Handles all logic related to drawing/erasing on layers, including mask management.
 */

import { AppState, Layer } from "./types";
import { clamp } from "./colorUtils";

/**
 * Get the layer currently selected for editing.
 * @param state - Application state
 * @returns The selected editable layer, or null if none selected
 */
export const getSelectedEditableLayer = (state: AppState): Layer | null => {
    if (!state.editing.selectedLayerId) {
        return null;
    }
    return state.layers.find((layer) => layer.id === state.editing.selectedLayerId) || null;
};

/**
 * Sync editing selection to ensure a valid layer is selected, or clear if no layers exist.
 * Called when layers are added/removed to maintain consistency.
 * @param state - Application state
 */
export const syncEditingLayerSelection = (state: AppState): void => {
    if (!state.layers.length) {
        state.editing.selectedLayerId = null;
        state.editing.layerMasks = {};
        state.editing.maskVersionByLayer = {};
        state.editing.hasEdits = false;
        state.editing.isPainting = false;
        state.editing.lastPaintPoint = null;
        return;
    }

    const selectedLayer = getSelectedEditableLayer(state);
    if (selectedLayer) {
        return;
    }

    state.editing.selectedLayerId = state.layers[0]?.id || null;
};

/**
 * Sync layer masks to match current layers.
 * When image is reloaded, recreate masks with correct pixel count.
 * Preserve existing masks where possible.
 * @param state - Application state
 */
export const syncEditingLayerMasks = (state: AppState): void => {
    const nextMasks: Record<string, Int8Array> = {};
    const nextMaskVersions: Record<string, number> = {};
    const pixelCount = state.preview.width * state.preview.height;

    for (const layer of state.layers) {
        const existingMask = state.editing.layerMasks[layer.id];
        if (existingMask && existingMask.length === pixelCount) {
            // Preserve existing mask with correct size
            nextMasks[layer.id] = existingMask;
            nextMaskVersions[layer.id] = state.editing.maskVersionByLayer[layer.id] || 0;
            continue;
        }

        // Create new empty mask for this layer
        nextMasks[layer.id] = new Int8Array(pixelCount);
        nextMaskVersions[layer.id] = 0;
    }

    state.editing.layerMasks = nextMasks;
    state.editing.maskVersionByLayer = nextMaskVersions;

    // Detect if any edits exist across all masks
    state.editing.hasEdits = Object.values(nextMasks).some((mask) => {
        for (let i = 0; i < mask.length; i += 1) {
            if (mask[i] !== 0) {
                return true;
            }
        }
        return false;
    });
};

/**
 * Check if a pixel is visible in a layer, accounting for both base palette and user edits.
 * Edits override the base palette: drawn pixels (1) are always visible, erased pixels (-1) are hidden.
 * @param state - Application state
 * @param layer - Layer to check visibility for
 * @param pixelIndex - Index in the flattened pixel array
 * @returns True if the pixel is visible in this layer
 */
export const isLayerVisibleAtPixel = (state: AppState, layer: Layer, pixelIndex: number): boolean => {
    const baseIndexedPixels = state.preview.baseIndexedPixels || state.preview.indexedPixels;
    const baseVisible = baseIndexedPixels?.[pixelIndex] === layer.paletteIndex;
    const override = state.editing.layerMasks[layer.id]?.[pixelIndex] || 0;

    // Mask encoding: 1 = drawn (force visible), -1 = erased (force hidden), 0 = use base
    if (override > 0) {
        return true;
    }
    if (override < 0) {
        return false;
    }

    return Boolean(baseVisible);
};

/**
 * Apply a circular brush stroke to the selected layer's mask.
 *
 * Uses antialiasing via distance calculation to create a smooth circular brush.
 * Updates the mask (1 = drawn, -1 = erased, 0 = neutral) and version tracking.
 *
 * @param state - Application state
 * @param centerX - Brush center x in image pixels
 * @param centerY - Brush center y in image pixels
 * @returns True if any pixels were changed, false if brush was outside bounds
 */
export const applyBrushStroke = (state: AppState, centerX: number, centerY: number): boolean => {
    const selectedLayer = getSelectedEditableLayer(state);
    if (!selectedLayer || !state.preview.indexedPixels) {
        return false;
    }

    const mask = state.editing.layerMasks[selectedLayer.id];
    if (!mask) {
        return false;
    }

    // Calculate bounding box of brush
    const radius = Math.max(0.5, state.editing.strokeSize / 2);
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(state.preview.width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(state.preview.height - 1, Math.ceil(centerY + radius));
    const radiusSquared = radius * radius;
    let changed = false;

    // Apply brush using distance formula for antialiasing
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            // Distance from pixel center to brush center
            const distanceX = x + 0.5 - centerX;
            const distanceY = y + 0.5 - centerY;

            // Check if pixel is within brush radius
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

    // Mark that edits exist and increment version for this layer
    state.editing.hasEdits = true;
    state.editing.maskVersionByLayer[selectedLayer.id] =
        (state.editing.maskVersionByLayer[selectedLayer.id] || 0) + 1;

    return true;
};

/**
 * Stop the current painting operation and reset painting state.
 * Should be called when pointer is released or cancelled.
 * @param state - Application state
 */
export const stopPainting = (state: AppState): void => {
    state.editing.isPainting = false;
    state.editing.lastPaintPoint = null;
};

/**
 * Get the stroke size, clamped to valid range.
 * @param size - Requested stroke size
 * @returns Clamped stroke size
 */
export const getClampedStrokeSize = (size: number, minSize: number, maxSize: number): number => {
    return clamp(size, minSize, maxSize);
};
