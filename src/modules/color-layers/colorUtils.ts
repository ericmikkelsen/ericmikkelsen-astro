/**
 * Color manipulation and blending utilities.
 * Shared functions for converting between color formats and performing color blending operations.
 */

export type RGB = [number, number, number];

/**
 * Convert hex color string to RGB triple.
 * @param hex - Color in #RRGGBB format
 * @returns RGB tuple with values 0-255
 * @example hexToRgb("#FF00FF") => [255, 0, 255]
 */
export const hexToRgb = (hex: string): RGB => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return [255, 255, 255];
    }
    return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
};

/**
 * Convert RGB triple to hex color string.
 * @param rgb - RGB tuple with values 0-255
 * @returns Color in #RRGGBB format
 * @example rgbToHex([255, 0, 255]) => "#FF00FF"
 */
export const rgbToHex = (rgb: RGB): string => {
    return (
        "#" +
        rgb
            .map((x) => {
                const hex = x.toString(16);
                return hex.length === 1 ? "0" + hex : hex;
            })
            .join("")
            .toUpperCase()
    );
};

/**
 * Clamp a value between min and max bounds.
 * @param value - The value to clamp
 * @param min - Minimum bound (inclusive)
 * @param max - Maximum bound (inclusive)
 * @returns Value clamped to [min, max]
 */
export const clamp = (value: number, min: number, max: number): number => {
    return Math.min(Math.max(value, min), max);
};

/**
 * Blend two colors using standard alpha compositing.
 *
 * Formula: out = fg + bg * (1 - fgAlpha) for each channel
 * Properly handles semi-transparent colors by accounting for both alphas.
 *
 * @param fg - Foreground RGB color (0-255)
 * @param bg - Background RGB color (0-255)
 * @param fgAlpha - Foreground alpha (0-255)
 * @param bgAlpha - Background alpha (0-255)
 * @returns Blended RGBA as [r, g, b, a] with values 0-255
 */
export const blendColors = (
    fg: RGB,
    bg: RGB,
    fgAlpha: number,
    bgAlpha: number
): [number, number, number, number] => {
    const fgAlphaF = fgAlpha / 255;
    const bgAlphaF = bgAlpha / 255;
    const outAlpha = fgAlphaF + bgAlphaF * (1 - fgAlphaF);

    if (outAlpha <= 0) {
        return [0, 0, 0, 0];
    }

    const [fgR, fgG, fgB] = fg;
    const [bgR, bgG, bgB] = bg;

    return [
        Math.round((fgR * fgAlphaF + bgR * bgAlphaF * (1 - fgAlphaF)) / outAlpha),
        Math.round((fgG * fgAlphaF + bgG * bgAlphaF * (1 - fgAlphaF)) / outAlpha),
        Math.round((fgB * fgAlphaF + bgB * bgAlphaF * (1 - fgAlphaF)) / outAlpha),
        Math.round(outAlpha * 255),
    ];
};

/**
 * Pre-compute lookup tables for faster color blending in tight loops.
 * Used when rendering many pixels with the same color.
 *
 * @param color - RGB color to pre-compute
 * @param opacity - Opacity as percentage (0-100)
 * @returns Object with precomputed values for use in loops
 */
export const precomputeColorBlend = (color: string, opacity: number) => {
    const [r, g, b] = hexToRgb(color);
    const alpha = clamp(Math.round((opacity / 100) * 255), 0, 255);
    const alphaF = alpha / 255;
    return { r, g, b, alpha, alphaF };
};
