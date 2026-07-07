/**
 * Group an image's colors into a handful of perceptual buckets ("gradient circles").
 *
 * Approach (spec D5, Option A): bucket pixels by hue and lightness (with a dedicated
 * low-saturation "grey/neutral" bucket), then merge the least-covered buckets into
 * their nearest neighbor until we reach the requested group count. Each final group
 * exposes its member colors sorted light -> dark so the UI can render a left -> right
 * linear gradient, plus its coverage share so circles can be sized by area (D6).
 */

import { relativeLuminance, rgbToHex, type RGB } from "./luminance";

/** Pixels with alpha at/below this are ignored. */
const ALPHA_THRESHOLD = 8;

/** Saturation (0-1) below which a color is treated as neutral (grey/brown-ish). */
const NEUTRAL_SATURATION = 0.12;

/** Fine bucket resolution before merging. */
const HUE_BINS = 12; // 30° each
const LIGHT_BINS = 4; // dark -> light
const NEUTRAL_LIGHT_BINS = 4;

export type GroupColor = {
    rgb: RGB;
    hex: string;
    luminance: number;
    /** Fraction of the whole image this member color represents. */
    coverage: number;
};

export type ColorGroup = {
    /** Coverage-weighted average color of the group. */
    averageRgb: RGB;
    averageHex: string;
    /** Fraction of the image (0-1) covered by this group. */
    coverage: number;
    /** Human-friendly name, e.g. "Greens" or "Neutrals". */
    name: string;
    /** Member colors sorted light -> dark (for gradient stops). */
    colors: GroupColor[];
    darkest: GroupColor;
    lightest: GroupColor;
};

type FineBucket = {
    sumR: number;
    sumG: number;
    sumB: number;
    count: number;
    neutral: boolean;
    hueBin: number;
    lightBin: number;
    /** Member sub-colors kept for gradient stops (coarse buckets themselves). */
    members: Map<string, { rgb: RGB; count: number }>;
};

/** Convert 0-255 RGB to HSL with h in [0,360), s and l in [0,1]. */
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) {
        return [0, 0, l];
    }
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === rf) {
        h = ((gf - bf) / d) % 6;
    } else if (max === gf) {
        h = (bf - rf) / d + 2;
    } else {
        h = (rf - gf) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
    return [h, s, l];
};

/** Name a hue angle. */
const hueName = (hue: number): string => {
    const ranges: [number, number, string][] = [
        [0, 15, "Reds"],
        [15, 45, "Oranges"],
        [45, 70, "Yellows"],
        [70, 160, "Greens"],
        [160, 200, "Teals"],
        [200, 255, "Blues"],
        [255, 290, "Purples"],
        [290, 330, "Magentas"],
        [330, 360, "Reds"],
    ];
    for (const [start, end, name] of ranges) {
        if (hue >= start && hue < end) return name;
    }
    return "Reds";
};

const bucketKey = (neutral: boolean, hueBin: number, lightBin: number): string =>
    neutral ? `n:${lightBin}` : `h:${hueBin}:${lightBin}`;

/**
 * Build fine hue/lightness buckets from raw image pixels.
 * `step` samples every Nth pixel for speed on large images.
 */
const buildFineBuckets = (data: Uint8ClampedArray, step: number): FineBucket[] => {
    const buckets = new Map<string, FineBucket>();
    const stride = 4 * Math.max(1, step);
    for (let i = 0; i < data.length; i += stride) {
        const a = data[i + 3];
        if (a <= ALPHA_THRESHOLD) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);
        const neutral = s < NEUTRAL_SATURATION;
        const hueBin = neutral ? -1 : Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS));
        const lightBins = neutral ? NEUTRAL_LIGHT_BINS : LIGHT_BINS;
        const lightBin = Math.min(lightBins - 1, Math.floor(l * lightBins));
        const key = bucketKey(neutral, hueBin, lightBin);

        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = {
                sumR: 0,
                sumG: 0,
                sumB: 0,
                count: 0,
                neutral,
                hueBin,
                lightBin,
                members: new Map(),
            };
            buckets.set(key, bucket);
        }
        bucket.sumR += r;
        bucket.sumG += g;
        bucket.sumB += b;
        bucket.count++;

        // Track a coarse member color (quantized to 5 bits/channel) for gradient stops.
        const mKey = `${r >> 3}:${g >> 3}:${b >> 3}`;
        const member = bucket.members.get(mKey);
        if (member) {
            member.count++;
        } else {
            bucket.members.set(mKey, { rgb: [r, g, b], count: 1 });
        }
    }
    return Array.from(buckets.values());
};

const bucketAverage = (bucket: FineBucket): RGB => [
    Math.round(bucket.sumR / bucket.count),
    Math.round(bucket.sumG / bucket.count),
    Math.round(bucket.sumB / bucket.count),
];

/** Perceptual-ish distance between two buckets for merging (hue wrap-aware). */
const bucketDistance = (a: FineBucket, b: FineBucket): number => {
    // Neutrals only merge with neutrals; colors only with colors.
    if (a.neutral !== b.neutral) return Infinity;
    if (a.neutral) {
        return Math.abs(a.lightBin - b.lightBin);
    }
    let hueDiff = Math.abs(a.hueBin - b.hueBin);
    if (hueDiff > HUE_BINS / 2) hueDiff = HUE_BINS - hueDiff;
    const lightDiff = Math.abs(a.lightBin - b.lightBin);
    // Weight hue more heavily than lightness so we split "dark vs light greens" last.
    return hueDiff * 2 + lightDiff;
};

type MergeGroup = {
    buckets: FineBucket[];
    count: number;
    neutral: boolean;
    hueBinAvg: number;
    lightBinAvg: number;
};

const toMergeGroup = (bucket: FineBucket): MergeGroup => ({
    buckets: [bucket],
    count: bucket.count,
    neutral: bucket.neutral,
    hueBinAvg: bucket.hueBin,
    lightBinAvg: bucket.lightBin,
});

const groupDistance = (a: MergeGroup, b: MergeGroup): number => {
    if (a.neutral !== b.neutral) return Infinity;
    if (a.neutral) return Math.abs(a.lightBinAvg - b.lightBinAvg);
    let hueDiff = Math.abs(a.hueBinAvg - b.hueBinAvg);
    if (hueDiff > HUE_BINS / 2) hueDiff = HUE_BINS - hueDiff;
    const lightDiff = Math.abs(a.lightBinAvg - b.lightBinAvg);
    return hueDiff * 2 + lightDiff;
};

/**
 * Reduce fine buckets to `targetGroups` by repeatedly merging the smallest group into
 * its nearest neighbor.
 */
const mergeToTarget = (buckets: FineBucket[], targetGroups: number): MergeGroup[] => {
    let groups = buckets.map(toMergeGroup);
    if (groups.length <= targetGroups) return groups;

    while (groups.length > targetGroups) {
        // Among the groups that actually have a compatible neighbor, pick the smallest
        // one and merge it into its nearest neighbor. Skipping groups with no compatible
        // neighbor (e.g. a lone neutral among colors) keeps merging going instead of
        // halting the whole loop early.
        let bestSmallestIdx = -1;
        let bestNearestIdx = -1;
        let bestSmallestCount = Infinity;

        for (let i = 0; i < groups.length; i++) {
            let nearestIdx = -1;
            let nearestDist = Infinity;
            for (let j = 0; j < groups.length; j++) {
                if (i === j) continue;
                const d = groupDistance(groups[i], groups[j]);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestIdx = j;
                }
            }
            if (nearestIdx === -1 || nearestDist === Infinity) continue;
            if (groups[i].count < bestSmallestCount) {
                bestSmallestCount = groups[i].count;
                bestSmallestIdx = i;
                bestNearestIdx = nearestIdx;
            }
        }

        if (bestSmallestIdx === -1) {
            // No compatible pair remains anywhere (e.g. only mutually-incompatible
            // classes left): stop merging.
            break;
        }

        const smallest = groups[bestSmallestIdx];
        const target = groups[bestNearestIdx];
        const totalCount = target.count + smallest.count;
        target.buckets = target.buckets.concat(smallest.buckets);
        target.hueBinAvg =
            (target.hueBinAvg * target.count + smallest.hueBinAvg * smallest.count) / totalCount;
        target.lightBinAvg =
            (target.lightBinAvg * target.count + smallest.lightBinAvg * smallest.count) / totalCount;
        target.count = totalCount;
        groups.splice(bestSmallestIdx, 1);
    }
    return groups;
};

/**
 * Build the final ColorGroup list from an image's pixels.
 *
 * @param data - RGBA pixel buffer
 * @param targetGroups - desired number of circles (slider value)
 */
export const groupColors = (data: Uint8ClampedArray, targetGroups: number): ColorGroup[] => {
    // Sample enough pixels for stable buckets without scanning huge buffers repeatedly.
    const totalPixels = data.length / 4;
    const step = Math.max(1, Math.floor(totalPixels / 500_000));
    const fine = buildFineBuckets(data, step);
    if (fine.length === 0) return [];

    const totalSampled = fine.reduce((sum, bucket) => sum + bucket.count, 0) || 1;
    const merged = mergeToTarget(fine, Math.max(1, targetGroups));

    const groups: ColorGroup[] = merged.map((group) => {
        let sumR = 0,
            sumG = 0,
            sumB = 0,
            count = 0;
        const memberMap = new Map<string, { rgb: RGB; count: number }>();
        let dominantHue = 0;
        let dominantHueWeight = -1;

        for (const bucket of group.buckets) {
            sumR += bucket.sumR;
            sumG += bucket.sumG;
            sumB += bucket.sumB;
            count += bucket.count;
            if (!bucket.neutral) {
                const avg = bucketAverage(bucket);
                const [h] = rgbToHsl(avg[0], avg[1], avg[2]);
                if (bucket.count > dominantHueWeight) {
                    dominantHueWeight = bucket.count;
                    dominantHue = h;
                }
            }
            for (const [k, m] of bucket.members) {
                const existing = memberMap.get(k);
                if (existing) existing.count += m.count;
                else memberMap.set(k, { rgb: m.rgb, count: m.count });
            }
        }

        const averageRgb: RGB = [
            Math.round(sumR / count),
            Math.round(sumG / count),
            Math.round(sumB / count),
        ];

        // Build member gradient stops sorted light -> dark, keeping the most common ones.
        const colors: GroupColor[] = Array.from(memberMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 6)
            .map((m) => ({
                rgb: m.rgb,
                hex: rgbToHex(m.rgb),
                luminance: relativeLuminance(m.rgb),
                coverage: m.count / totalSampled,
            }))
            .sort((a, b) => b.luminance - a.luminance); // light -> dark

        const name = group.neutral ? "Neutrals" : hueName(dominantHue);
        const avgLum = relativeLuminance(averageRgb);
        const qualified = group.neutral
            ? avgLum < 0.15
                ? "Dark neutrals"
                : avgLum > 0.6
                  ? "Light neutrals"
                  : "Neutrals"
            : avgLum < 0.18
              ? `Dark ${name.toLowerCase()}`
              : avgLum > 0.55
                ? `Light ${name.toLowerCase()}`
                : name;

        return {
            averageRgb,
            averageHex: rgbToHex(averageRgb),
            coverage: count / totalSampled,
            name: qualified,
            colors,
            lightest: colors[0],
            darkest: colors[colors.length - 1],
        };
    });

    // Largest coverage first.
    return groups.sort((a, b) => b.coverage - a.coverage);
};
