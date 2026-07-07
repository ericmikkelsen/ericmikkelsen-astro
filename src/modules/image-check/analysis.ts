/**
 * Full-image luminance analysis for the image-check tool.
 *
 * Design decisions (see spec):
 * - D1: measure the FULL raw image (every pixel), so a single glint or deep shadow
 *   is not hidden. Large images are capped to keep a single main-thread pass snappy.
 * - D2: report BOTH the absolute extreme pixel AND a count-weighted percentile, plus
 *   the share of pixels that fail each text threshold, so "one bad pixel" is
 *   distinguishable from "this whole image is wrong".
 * - D4: WCAG 2.x contrast math.
 */

import {
    contrastWithBlack,
    contrastWithWhite,
    maxLuminanceForWhite,
    minLuminanceForBlack,
    relativeLuminance,
    rgbToHex,
    SRGB_TO_LINEAR,
    THRESHOLDS,
    type RGB,
} from "./luminance";

/**
 * Upper bound on pixels analyzed in one main-thread pass. Phone photos (~12MP) stay
 * under this; very large images are downscaled proportionally. Downscaling can soften
 * a lone extreme pixel, so the cap is generous.
 */
const MAX_ANALYSIS_PIXELS = 6_000_000;

/** Pixels with alpha at/below this are treated as not part of the image. */
const ALPHA_THRESHOLD = 8;

/** Number of luminance histogram bins used for percentile estimation. */
const HISTOGRAM_BINS = 1024;

export type ExtremeColor = {
    rgb: RGB;
    hex: string;
    luminance: number;
};

export type TextFailure = {
    /** Fraction of opaque pixels (0-1) that fail this text size. */
    failFraction: number;
    /** Same as a percentage 0-100. */
    failPercent: number;
    /** Count of failing pixels. */
    failCount: number;
    /** Fraction of pixels that pass (1 - failFraction). */
    passFraction: number;
};

export type TextUsability = {
    /** Worst-case contrast using the absolute extreme pixel. */
    worstContrastAbsolute: number;
    /** Worst-case contrast using the weighted percentile extreme. */
    worstContrastPercentile: number;
    /** Pixel-failure stats at the large-text threshold (3:1). */
    large: TextFailure;
    /** Pixel-failure stats at the normal-text threshold (4.5:1). */
    normal: TextFailure;
};

export type LuminanceAnalysis = {
    pixelsAnalyzed: number;
    downscaled: boolean;

    /** Single darkest/lightest pixel in the whole image. */
    darkestAbsolute: ExtremeColor;
    lightestAbsolute: ExtremeColor;

    /** Count-weighted percentile extremes (practical read). */
    darkestPercentile: ExtremeColor;
    lightestPercentile: ExtremeColor;
    /** Lower percentile used for "darkest" (e.g. 0.02). */
    lowPercentile: number;
    /** Upper percentile used for "lightest" (e.g. 0.98). */
    highPercentile: number;

    /** Can I put WHITE text on this? (worst case = lightest area) */
    whiteText: TextUsability;
    /** Can I put BLACK text on this? (worst case = darkest area) */
    blackText: TextUsability;
};

/**
 * Decoded image ready for (repeated) pixel extraction. The bitmap is kept alive so
 * contrast/lightness adjustments can be re-applied without re-decoding the file.
 */
export type DecodedImage = {
    bitmap: ImageBitmap;
    width: number;
    height: number;
    downscaled: boolean;
    /** True source dimensions before any downscale for analysis. */
    naturalWidth: number;
    naturalHeight: number;
};

/**
 * Tone adjustments applied by real per-pixel processing (not CSS/canvas filters).
 * Semantics match color-layers so the two tools behave identically:
 *   out = clamp((v - 128) * contrast + 128 + lightness)
 */
export type ImageAdjustments = {
    /** Contrast multiplier, 0–2 (1 = unchanged). */
    contrast: number;
    /** Lightness offset added per channel, -100…100 (0 = unchanged). */
    lightness: number;
};

/** Identity adjustment (no change). */
export const NO_ADJUSTMENTS: ImageAdjustments = { contrast: 1, lightness: 0 };

const clampByte = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value);

const createSizedCanvas = (
    width: number,
    height: number
): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } => {
    const canvas =
        typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(width, height)
            : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d", {
        willReadFrequently: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
        throw new Error("Could not get a 2D canvas context to read image pixels.");
    }
    return { canvas, ctx };
};

/**
 * Decode a File into a bitmap at analysis resolution (downscaling only above
 * MAX_ANALYSIS_PIXELS). The returned bitmap should be closed when no longer needed.
 */
export const decodeImage = async (file: File): Promise<DecodedImage> => {
    const source = await createImageBitmap(file);
    const naturalWidth = source.width;
    const naturalHeight = source.height;
    const sourcePixels = naturalWidth * naturalHeight;
    if (sourcePixels <= MAX_ANALYSIS_PIXELS) {
        return {
            bitmap: source,
            width: naturalWidth,
            height: naturalHeight,
            downscaled: false,
            naturalWidth,
            naturalHeight,
        };
    }
    const scale = Math.sqrt(MAX_ANALYSIS_PIXELS / sourcePixels);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    // Re-rasterize to a smaller bitmap so later extractions are cheap.
    const scaled = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height });
    source.close();
    return { bitmap: scaled, width, height, downscaled: true, naturalWidth, naturalHeight };
};

/**
 * Rasterize a decoded image to its unmodified RGBA pixels. Call this once per image;
 * adjustments are then applied to copies via applyToneAdjustments so the source is
 * preserved and re-processing is cheap.
 */
export const extractBaseImageData = (
    image: DecodedImage
): { data: Uint8ClampedArray; width: number; height: number; downscaled: boolean } => {
    const { ctx } = createSizedCanvas(image.width, image.height);
    ctx.drawImage(image.bitmap, 0, 0, image.width, image.height);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    return { data: imageData.data, width: image.width, height: image.height, downscaled: image.downscaled };
};

/**
 * Apply real per-pixel tone processing, returning a NEW RGBA buffer (source untouched).
 * Matches color-layers' applyToneAdjustments exactly:
 *   out = clamp((v - 128) * contrast + 128 + lightness)
 * The alpha channel is preserved.
 */
export const applyToneAdjustments = (
    base: Uint8ClampedArray,
    adjustments: ImageAdjustments
): Uint8ClampedArray => {
    const contrast = Math.min(2, Math.max(0, adjustments.contrast));
    const offset = Math.min(100, Math.max(-100, adjustments.lightness));

    // No-op fast path: hand back a copy so callers can treat the result as owned.
    if (contrast === 1 && offset === 0) {
        return new Uint8ClampedArray(base);
    }

    const out = new Uint8ClampedArray(base.length);
    for (let i = 0; i < base.length; i += 4) {
        out[i] = clampByte(Math.round((base[i] - 128) * contrast + 128 + offset));
        out[i + 1] = clampByte(Math.round((base[i + 1] - 128) * contrast + 128 + offset));
        out[i + 2] = clampByte(Math.round((base[i + 2] - 128) * contrast + 128 + offset));
        out[i + 3] = base[i + 3];
    }
    return out;
};

/**
 * Decode a File into a full-resolution RGBA buffer, downscaling only if the image
 * exceeds MAX_ANALYSIS_PIXELS. Convenience wrapper around decodeImage + extraction.
 */
export const loadImageData = async (
    file: File
): Promise<{ data: Uint8ClampedArray; width: number; height: number; downscaled: boolean }> => {
    const decoded = await decodeImage(file);
    try {
        return extractBaseImageData(decoded);
    } finally {
        decoded.bitmap.close();
    }
};

/**
 * Build a representative average color for a percentile tail directly from binned
 * color sums. Walking bins by rank (rather than re-thresholding pixels by a rounded
 * luminance) avoids off-by-a-bin errors where a whole band gets excluded and only a
 * stray extreme pixel survives.
 *
 * @param direction - "low" walks bins from darkest up; "high" walks from lightest down
 * @param tailFraction - share of pixels to include in the tail (e.g. 0.02)
 */
const tailAverageColor = (
    counts: Float64Array,
    binSumR: Float64Array,
    binSumG: Float64Array,
    binSumB: Float64Array,
    totalWeight: number,
    direction: "low" | "high",
    tailFraction: number
): RGB | null => {
    if (totalWeight <= 0) return null;
    const target = Math.max(1, tailFraction * totalWeight);
    let accumulated = 0;
    let sumR = 0,
        sumG = 0,
        sumB = 0,
        count = 0;
    const bins = counts.length;
    const start = direction === "low" ? 0 : bins - 1;
    const stepDir = direction === "low" ? 1 : -1;
    for (let bin = start; bin >= 0 && bin < bins; bin += stepDir) {
        const c = counts[bin];
        if (c > 0) {
            sumR += binSumR[bin];
            sumG += binSumG[bin];
            sumB += binSumB[bin];
            count += c;
            accumulated += c;
        }
        if (accumulated >= target) break;
    }
    if (count === 0) return null;
    return [Math.round(sumR / count), Math.round(sumG / count), Math.round(sumB / count)];
};

/**
 * Analyze a decoded image for darkest/lightest colors, luminance, and text usability.
 *
 * @param lowPercentile - fraction for the "practical darkest" (default 0.02)
 * @param highPercentile - fraction for the "practical lightest" (default 0.98)
 */
export const analyzeLuminance = (
    image: { data: Uint8ClampedArray; width: number; height: number; downscaled: boolean },
    lowPercentile = 0.02,
    highPercentile = 0.98
): LuminanceAnalysis => {
    const { data, downscaled } = image;

    let minLum = Infinity;
    let maxLum = -Infinity;
    let darkestRgb: RGB = [0, 0, 0];
    let lightestRgb: RGB = [255, 255, 255];

    const histogram = new Float64Array(HISTOGRAM_BINS);
    // Per-bin color sums so we can build a representative tail color without a second pass.
    const binSumR = new Float64Array(HISTOGRAM_BINS);
    const binSumG = new Float64Array(HISTOGRAM_BINS);
    const binSumB = new Float64Array(HISTOGRAM_BINS);

    // Failing-pixel thresholds (luminance boundaries) for white and black text.
    const whiteFailLargeAbove = maxLuminanceForWhite(THRESHOLDS.aaLarge); // lighter than this fails white large
    const whiteFailNormalAbove = maxLuminanceForWhite(THRESHOLDS.aaNormal);
    const blackFailLargeBelow = minLuminanceForBlack(THRESHOLDS.aaLarge); // darker than this fails black large
    const blackFailNormalBelow = minLuminanceForBlack(THRESHOLDS.aaNormal);

    let whiteFailLarge = 0,
        whiteFailNormal = 0,
        blackFailLarge = 0,
        blackFailNormal = 0;

    let opaquePixels = 0;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
        const a = data[i + 3];
        if (a <= ALPHA_THRESHOLD) {
            continue;
        }
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.2126 * SRGB_TO_LINEAR[r] + 0.7152 * SRGB_TO_LINEAR[g] + 0.0722 * SRGB_TO_LINEAR[b];
        opaquePixels++;

        if (lum < minLum) {
            minLum = lum;
            darkestRgb = [r, g, b];
        }
        if (lum > maxLum) {
            maxLum = lum;
            lightestRgb = [r, g, b];
        }

        let bin = (lum * HISTOGRAM_BINS) | 0;
        if (bin >= HISTOGRAM_BINS) bin = HISTOGRAM_BINS - 1;
        histogram[bin] += 1;
        binSumR[bin] += r;
        binSumG[bin] += g;
        binSumB[bin] += b;

        if (lum > whiteFailLargeAbove) whiteFailLarge++;
        if (lum > whiteFailNormalAbove) whiteFailNormal++;
        if (lum < blackFailLargeBelow) blackFailLarge++;
        if (lum < blackFailNormalBelow) blackFailNormal++;
    }

    if (opaquePixels === 0) {
        // Degenerate (fully transparent) image: report neutral values.
        minLum = 0;
        maxLum = 1;
    }

    // Percentile tail representative colors, built directly from binned sums.
    const darkestPercentileRgb: RGB =
        tailAverageColor(histogram, binSumR, binSumG, binSumB, opaquePixels, "low", lowPercentile) ??
        darkestRgb;
    const lightestPercentileRgb: RGB =
        tailAverageColor(
            histogram,
            binSumR,
            binSumG,
            binSumB,
            opaquePixels,
            "high",
            1 - highPercentile
        ) ?? lightestRgb;

    const makeExtreme = (rgb: RGB): ExtremeColor => ({
        rgb,
        hex: rgbToHex(rgb),
        luminance: relativeLuminance(rgb),
    });

    const darkestAbsolute = makeExtreme(darkestRgb);
    const lightestAbsolute = makeExtreme(lightestRgb);
    const darkestPercentile = makeExtreme(darkestPercentileRgb);
    const lightestPercentile = makeExtreme(lightestPercentileRgb);

    const denom = opaquePixels || 1;
    const makeFailure = (count: number): TextFailure => ({
        failFraction: count / denom,
        failPercent: (count / denom) * 100,
        failCount: count,
        passFraction: 1 - count / denom,
    });

    const whiteText: TextUsability = {
        // White text worst case is the lightest area.
        worstContrastAbsolute: contrastWithWhite(lightestAbsolute.luminance),
        worstContrastPercentile: contrastWithWhite(lightestPercentile.luminance),
        large: makeFailure(whiteFailLarge),
        normal: makeFailure(whiteFailNormal),
    };

    const blackText: TextUsability = {
        // Black text worst case is the darkest area.
        worstContrastAbsolute: contrastWithBlack(darkestAbsolute.luminance),
        worstContrastPercentile: contrastWithBlack(darkestPercentile.luminance),
        large: makeFailure(blackFailLarge),
        normal: makeFailure(blackFailNormal),
    };

    return {
        pixelsAnalyzed: opaquePixels,
        downscaled,
        darkestAbsolute,
        lightestAbsolute,
        darkestPercentile,
        lightestPercentile,
        lowPercentile,
        highPercentile,
        whiteText,
        blackText,
    };
};
