/**
 * WCAG 2.x luminance and contrast helpers for the image-check tool.
 *
 * All math follows the WCAG relative-luminance and contrast-ratio definitions so
 * results line up with colors.fyi and standard contrast checkers.
 */

export type RGB = [number, number, number];

/**
 * Precomputed sRGB channel (0-255) -> linear-light value lookup table.
 * Avoids repeating the piecewise gamma curve for every pixel in a tight loop.
 */
export const SRGB_TO_LINEAR: Float64Array = (() => {
    const table = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
        const c = i / 255;
        table[i] = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return table;
})();

/**
 * WCAG relative luminance of an sRGB color.
 * @param rgb - channel values 0-255
 * @returns luminance in [0, 1] (0 = black, 1 = white)
 */
export const relativeLuminance = (rgb: RGB): number => {
    const [r, g, b] = rgb;
    return 0.2126 * SRGB_TO_LINEAR[r] + 0.7152 * SRGB_TO_LINEAR[g] + 0.0722 * SRGB_TO_LINEAR[b];
};

/**
 * WCAG contrast ratio between two relative luminances.
 * @returns ratio in [1, 21]
 */
export const contrastRatio = (l1: number, l2: number): number => {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Contrast of white (#fff) text sitting on a background of the given luminance.
 * White is the worst case over the lightest area of an image.
 */
export const contrastWithWhite = (backgroundLuminance: number): number => {
    return 1.05 / (backgroundLuminance + 0.05);
};

/**
 * Contrast of black (#000) text sitting on a background of the given luminance.
 * Black is the worst case over the darkest area of an image.
 */
export const contrastWithBlack = (backgroundLuminance: number): number => {
    return (backgroundLuminance + 0.05) / 0.05;
};

/**
 * Maximum background luminance that still yields the target contrast with white text.
 * Backgrounds lighter than this fail white text at that ratio.
 */
export const maxLuminanceForWhite = (targetRatio: number): number => {
    return 1.05 / targetRatio - 0.05;
};

/**
 * Minimum background luminance that still yields the target contrast with black text.
 * Backgrounds darker than this fail black text at that ratio.
 */
export const minLuminanceForBlack = (targetRatio: number): number => {
    return 0.05 * targetRatio - 0.05;
};

/** WCAG contrast thresholds. */
export const THRESHOLDS = {
    aaLarge: 3,
    aaNormal: 4.5,
    aaaLarge: 4.5,
    aaaNormal: 7,
} as const;

/**
 * Where a contrast ratio lands on the WCAG ladder.
 * `fail` < AA large (3) < AA normal (4.5) < AAA large (4.5) < AAA normal (7).
 * Note: AA normal and AAA large share the 4.5 boundary; `aaaLarge` is the higher rung.
 */
export type ContrastLevel = "fail" | "aa-large" | "aa-normal" | "aaa-large" | "aaa-normal";

export type ContrastClassification = {
    ratio: number;
    level: ContrastLevel;
    /** Human-readable summary, e.g. "AAA (normal text)". */
    label: string;
    passesAALarge: boolean;
    passesAANormal: boolean;
    passesAAALarge: boolean;
    passesAAANormal: boolean;
};

/**
 * Classify a contrast ratio against the WCAG ladder.
 * Reports the highest rung cleared and per-threshold pass flags.
 */
export const classifyContrast = (ratio: number): ContrastClassification => {
    const passesAALarge = ratio >= THRESHOLDS.aaLarge;
    const passesAANormal = ratio >= THRESHOLDS.aaNormal;
    const passesAAALarge = ratio >= THRESHOLDS.aaaLarge;
    const passesAAANormal = ratio >= THRESHOLDS.aaaNormal;

    let level: ContrastLevel = "fail";
    let label = "Fails AA";
    if (passesAAANormal) {
        level = "aaa-normal";
        label = "AAA (normal text)";
    } else if (passesAANormal) {
        // 4.5–6.99: clears AA normal and AAA large (same 4.5 boundary).
        level = "aaa-large";
        label = "AA normal / AAA large text";
    } else if (passesAALarge) {
        level = "aa-large";
        label = "AA large text only";
    }

    return {
        ratio,
        level,
        label,
        passesAALarge,
        passesAANormal,
        passesAAALarge,
        passesAAANormal,
    };
};

/**
 * Convert an RGB triple to an uppercase #RRGGBB hex string.
 */
export const rgbToHex = (rgb: RGB): string => {
    return (
        "#" +
        rgb
            .map((x) => {
                const clamped = Math.max(0, Math.min(255, Math.round(x)));
                const hex = clamped.toString(16);
                return hex.length === 1 ? "0" + hex : hex;
            })
            .join("")
            .toUpperCase()
    );
};
