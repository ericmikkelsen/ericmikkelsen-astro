/**
 * Page controller for the image-check toy.
 *
 * Flow:
 * 1. User uploads a photo; we decode it once (kept as a bitmap).
 * 2. Contrast/lightness settings apply a canvas filter and re-run the WCAG analysis,
 *    so the user can tweak a photo toward passing.
 * 3. Contrast results are rendered as prose ("Can I use white text? No, because…")
 *    with per-pixel pass rates.
 * 4. Color groups render as coverage-scaled gradient circles under the results.
 */

import {
    type LuminanceAnalysis,
    type TextUsability,
    type ExtremeColor,
} from "./analysis";
import { classifyContrast } from "./luminance";
import { type ColorGroup } from "./grouping";
import { loadImage, analyzeImage } from "./analysisClient";
import { storeHandoffImage } from "../image-handoff";

type Elements = {
    grid: HTMLElement | null;
    fileInput: HTMLInputElement | null;
    status: HTMLElement | null;
    preview: HTMLElement | null;
    results: HTMLElement | null;
    groupCount: HTMLInputElement | null;
    groupCountValue: HTMLElement | null;
    groups: HTMLElement | null;
    colorsFyiLink: HTMLAnchorElement | null;
    sendToColorLayers: HTMLButtonElement | null;
    contrast: HTMLInputElement | null;
    lightness: HTMLInputElement | null;
    width: HTMLInputElement | null;
    height: HTMLInputElement | null;
    lockAspect: HTMLInputElement | null;
    layoutMode: HTMLSelectElement | null;
};

const DEFAULT_GROUP_COUNT = 5;

const fmtRatio = (ratio: number): string => `${ratio.toFixed(2)}:1`;
const fmtLum = (lum: number): string => lum.toFixed(3);
const fmtPct = (fraction: number): string => {
    const pct = fraction * 100;
    if (pct > 0 && pct < 0.1) return "<0.1%";
    if (pct < 100 && pct > 99.9) return ">99.9%";
    return `${pct.toFixed(1)}%`;
};

const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> = {},
    children: (Node | string)[] = []
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) {
        node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
};

/** Small inline color chip for use inside prose. */
const inlineSwatch = (hex: string): HTMLElement =>
    el("span", { className: "ic-swatch-inline", style: `background:${hex}` });

/** A small ratio badge classified on the WCAG ladder. */
const ratioBadge = (ratio: number): HTMLElement => {
    const c = classifyContrast(ratio);
    return el("span", { className: `ic-badge ic-badge--${c.level}`, title: c.label }, [fmtRatio(ratio)]);
};

/** Pass-rate list for normal (4.5:1) and large (3:1) text. */
const passRates = (usability: TextUsability): HTMLElement =>
    el("ul", { className: "ic-passrates" }, [
        el("li", {}, [
            "Normal text (4.5:1): ",
            el("strong", {}, [fmtPct(usability.normal.passFraction)]),
            " of pixels pass",
        ]),
        el("li", {}, [
            "Large text (3:1): ",
            el("strong", {}, [fmtPct(usability.large.passFraction)]),
            " of pixels pass",
        ]),
    ]);

/**
 * Render one prose contrast section, e.g.:
 *   "Can I use white text?
 *    No — your brightest pixel #FFFFFF has only 1.00:1 contrast against white text."
 */
const textSection = (
    heading: string,
    textColorName: "white" | "black",
    extremeLabel: string,
    extreme: ExtremeColor,
    usability: TextUsability
): HTMLElement => {
    const ratio = usability.worstContrastAbsolute;
    const c = classifyContrast(ratio);

    let verdictWord: HTMLElement;
    let reason: (Node | string)[];
    if (c.passesAANormal) {
        verdictWord = el("span", { className: "ic-yes" }, ["Yes"]);
        reason = [
            ` — even your ${extremeLabel} pixel `,
            inlineSwatch(extreme.hex),
            el("code", {}, [extreme.hex]),
            ` keeps `,
            ratioBadge(ratio),
            ` contrast against ${textColorName} text (4.5:1 needed for normal text).`,
        ];
    } else if (c.passesAALarge) {
        verdictWord = el("span", { className: "ic-no" }, ["Only for large text"]);
        reason = [
            ` — your ${extremeLabel} pixel `,
            inlineSwatch(extreme.hex),
            el("code", {}, [extreme.hex]),
            ` has `,
            ratioBadge(ratio),
            ` contrast against ${textColorName} text, which clears large text (3:1) but not normal text (4.5:1).`,
        ];
    } else {
        verdictWord = el("span", { className: "ic-no" }, ["No"]);
        reason = [
            ` — your ${extremeLabel} pixel `,
            inlineSwatch(extreme.hex),
            el("code", {}, [extreme.hex]),
            ` has only `,
            ratioBadge(ratio),
            ` contrast against ${textColorName} text (you need 4.5:1 for normal, 3:1 for large).`,
        ];
    }

    return el("div", { className: "ic-result-block" }, [
        el("h3", {}, [heading]),
        el("p", { className: "ic-verdict ic-prose" }, [verdictWord, ...reason]),
        passRates(usability),
        el("p", { className: "ic-lum" }, [
            `${extremeLabel[0].toUpperCase()}${extremeLabel.slice(1)} luminance ${fmtLum(extreme.luminance)}.`,
        ]),
    ]);
};

/** Plain-English one-liner summarizing usability. */
const buildSummary = (a: LuminanceAnalysis): string => {
    const whiteOk = a.whiteText.worstContrastAbsolute >= 4.5;
    const blackOk = a.blackText.worstContrastAbsolute >= 4.5;
    const whiteMostly = a.whiteText.normal.passFraction >= 0.98;
    const blackMostly = a.blackText.normal.passFraction >= 0.98;

    if (whiteOk && blackOk) return "This image works with both white and black text everywhere.";
    if (whiteOk) return "White text works everywhere; black text does not (the image has dark areas).";
    if (blackOk) return "Black text works everywhere; white text does not (the image has bright areas).";
    if (whiteMostly && !blackMostly)
        return "White text works over almost the whole image — a few bright pixels aside, small edits could make it pass.";
    if (blackMostly && !whiteMostly)
        return "Black text works over almost the whole image — a few dark pixels aside, small edits could make it pass.";
    return "Neither white nor black text is safe everywhere. Try nudging contrast or lightness, or check the pass rates to see how far off you are.";
};

/** Render the prose contrast results. */
const renderResults = (container: HTMLElement, analysis: LuminanceAnalysis): void => {
    container.replaceChildren();
    container.append(
        textSection(
            "Can I use white text?",
            "white",
            "brightest",
            analysis.lightestAbsolute,
            analysis.whiteText
        ),
        textSection(
            "Can I use black text?",
            "black",
            "darkest",
            analysis.darkestAbsolute,
            analysis.blackText
        ),
        el("p", { className: "ic-summary" }, [buildSummary(analysis)])
    );

    if (analysis.downscaled) {
        container.append(
            el("p", { className: "ic-muted ic-note" }, [
                "Note: this image was large, so it was scaled down for analysis. A single stray extreme pixel may be softened.",
            ])
        );
    }
};

/** Render the gradient circles. */
const renderGroups = (container: HTMLElement, groups: ColorGroup[]): void => {
    container.replaceChildren();
    if (groups.length === 0) return;

    const maxCoverage = groups[0].coverage || 1;
    for (const group of groups) {
        const rel = Math.sqrt(group.coverage / maxCoverage);
        const size = 3 + rel * 6; // rem, 3–9rem
        const stops =
            group.colors.length >= 2
                ? group.colors.map((c) => c.hex).join(", ")
                : `${group.averageHex}, ${group.averageHex}`;

        const circle = el("div", {
            className: "ic-circle",
            style: `width:${size}rem;height:${size}rem;background:linear-gradient(to right, ${stops});`,
        });
        const meta = el("div", { className: "ic-circle-meta" }, [
            el("strong", {}, [group.name]),
            el("span", { className: "ic-lum" }, [`${fmtPct(group.coverage)} of image`]),
            el("span", { className: "ic-lum" }, [
                `light ${fmtLum(group.lightest.luminance)} → dark ${fmtLum(group.darkest.luminance)}`,
            ]),
        ]);
        container.append(el("div", { className: "ic-circle-wrap" }, [circle, meta]));
    }
};

/** Build the "colors.fyi" compare link from the extreme + group colors. */
const buildColorsFyiLink = (analysis: LuminanceAnalysis, groups: ColorGroup[]): string => {
    const hexes = new Set<string>();
    hexes.add(analysis.darkestAbsolute.hex.replace("#", ""));
    hexes.add(analysis.lightestAbsolute.hex.replace("#", ""));
    for (const group of groups) hexes.add(group.averageHex.replace("#", ""));
    return `https://colors.fyi/compare-colors/?colors=${Array.from(hexes).join(",")}`;
};

export const initImageCheck = (): void => {
    const els: Elements = {
        grid: document.querySelector<HTMLElement>("#image-check-layout"),
        fileInput: document.querySelector<HTMLInputElement>("#image-input"),
        status: document.querySelector<HTMLElement>("#ic-status"),
        preview: document.querySelector<HTMLElement>("#ic-preview"),
        results: document.querySelector<HTMLElement>("#ic-results"),
        groupCount: document.querySelector<HTMLInputElement>("#group-count"),
        groupCountValue: document.querySelector<HTMLElement>("#group-count-value"),
        groups: document.querySelector<HTMLElement>("#ic-groups"),
        colorsFyiLink: document.querySelector<HTMLAnchorElement>("#colors-fyi-link"),
        sendToColorLayers: document.querySelector<HTMLButtonElement>("#send-to-color-layers"),
        contrast: document.querySelector<HTMLInputElement>("#contrast"),
        lightness: document.querySelector<HTMLInputElement>("#lightness"),
        width: document.querySelector<HTMLInputElement>("#width"),
        height: document.querySelector<HTMLInputElement>("#height"),
        lockAspect: document.querySelector<HTMLInputElement>("#lock-aspect"),
        layoutMode: document.querySelector<HTMLSelectElement>("#layout-mode"),
    };

    let previewCanvas: HTMLCanvasElement | null = null;
    let currentAnalysis: LuminanceAnalysis | null = null;
    let currentFile: File | null = null;
    let naturalWidth = 0;
    let naturalHeight = 0;
    let imageLoaded = false;

    // Coalesce rapid slider input: only one analyze runs at a time; if input arrives
    // while one is in flight, we run once more with the latest settings when it returns.
    let analyzeInFlight = false;
    let analyzeQueued = false;

    const setStatus = (message: string): void => {
        if (els.status) els.status.textContent = message;
    };

    const readGroupCount = (): number =>
        els.groupCount ? Number(els.groupCount.value) : DEFAULT_GROUP_COUNT;

    /** Paint an already-processed RGBA buffer into the preview canvas. */
    const paintPreview = (data: Uint8ClampedArray, width: number, height: number): void => {
        if (!previewCanvas) return;
        previewCanvas.width = width;
        previewCanvas.height = height;
        const ctx = previewCanvas.getContext("2d");
        if (!ctx) return;
        ctx.putImageData(new ImageData(data, width, height), 0, 0);
    };

    /**
     * Ask the worker to process (contrast/lightness), analyze, and group the loaded
     * image, then paint the returned processed pixels and render the results. Runs off
     * the main thread; requests are coalesced so slider drags stay responsive.
     */
    const runAnalysis = async (): Promise<void> => {
        if (!imageLoaded) return;
        if (analyzeInFlight) {
            analyzeQueued = true;
            return;
        }
        analyzeInFlight = true;
        try {
            const contrast = els.contrast ? Number(els.contrast.value) : 1;
            const lightness = els.lightness ? Number(els.lightness.value) : 0;
            const groupCount = readGroupCount();
            if (els.groupCountValue) els.groupCountValue.textContent = String(groupCount);

            const result = await analyzeImage({ contrast, lightness, groupCount });
            currentAnalysis = result.analysis;

            // The processed buffer is transferred back from the worker; safe to use.
            paintPreview(result.processed, result.width, result.height);
            if (els.results) renderResults(els.results, result.analysis);
            renderGroups(els.groups!, result.groups);
            if (els.colorsFyiLink) {
                els.colorsFyiLink.href = buildColorsFyiLink(result.analysis, result.groups);
            }
            setStatus(`Analyzed ${result.analysis.pixelsAnalyzed.toLocaleString()} pixels.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error.";
            setStatus(`Could not analyze image: ${message}`);
        } finally {
            analyzeInFlight = false;
            if (analyzeQueued) {
                analyzeQueued = false;
                void runAnalysis();
            }
        }
    };

    const applyPreviewSize = (): void => {
        const frame = els.preview?.querySelector<HTMLElement>(".ic-preview-frame");
        if (!frame) return;
        const w = els.width ? Number(els.width.value) : 0;
        const h = els.height ? Number(els.height.value) : 0;
        if (w > 0 && h > 0) {
            frame.style.setProperty("--ic-aspect", `${w} / ${h}`);
            frame.style.maxWidth = `${w}px`;
        }
    };

    /** Build the preview: a canvas showing the processed pixels + text sample overlay. */
    const buildPreview = (): void => {
        if (!els.preview) return;
        previewCanvas = el("canvas", { className: "ic-preview-img" }) as HTMLCanvasElement;
        const samples = el("div", { className: "ic-samples" }, [
            el("span", { className: "ic-sample ic-sample--white" }, ["White text sample"]),
            el("span", { className: "ic-sample ic-sample--black" }, ["Black text sample"]),
        ]);
        const frame = el("div", { className: "ic-preview-frame" }, [previewCanvas, samples]);
        els.preview.replaceChildren(frame);
        applyPreviewSize();
    };

    const prefillDimensions = (): void => {
        if (els.width) els.width.value = String(naturalWidth);
        if (els.height) els.height.value = String(naturalHeight);
    };

    const applyLayout = (): void => {
        if (els.grid && els.layoutMode) {
            els.grid.dataset.layout = els.layoutMode.value;
        }
    };

    const handleFile = async (file: File): Promise<void> => {
        try {
            setStatus("Loading image…");
            currentFile = file;
            imageLoaded = false;
            const info = await loadImage(file);
            naturalWidth = info.naturalWidth;
            naturalHeight = info.naturalHeight;
            imageLoaded = true;
            prefillDimensions();
            buildPreview();
            void runAnalysis();
            if (els.sendToColorLayers) els.sendToColorLayers.disabled = false;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error.";
            setStatus(`Could not load image: ${message}`);
        }
    };

    const sendToColorLayers = async (): Promise<void> => {
        if (!currentFile) return;
        try {
            if (els.sendToColorLayers) els.sendToColorLayers.disabled = true;
            setStatus("Sending image to Color Layers…");
            await storeHandoffImage(currentFile);
            window.location.href = "/toys/color-layers/";
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error.";
            setStatus(`Could not send image: ${message}`);
            if (els.sendToColorLayers) els.sendToColorLayers.disabled = false;
        }
    };

    // Width/height with optional aspect lock (display sizing only).
    const syncDimension = (changed: "width" | "height"): void => {
        if (!imageLoaded || !els.lockAspect?.checked || !els.width || !els.height || naturalHeight === 0) {
            applyPreviewSize();
            return;
        }
        const ratio = naturalWidth / naturalHeight;
        if (changed === "width") {
            const w = Number(els.width.value);
            if (w > 0) els.height.value = String(Math.round(w / ratio));
        } else {
            const h = Number(els.height.value);
            if (h > 0) els.width.value = String(Math.round(h * ratio));
        }
        applyPreviewSize();
    };

    const updateRangeOutput = (input: HTMLInputElement | null): void => {
        if (!input) return;
        const out = document.getElementById(`${input.id}-value`);
        if (out) out.textContent = input.value;
    };

    els.fileInput?.addEventListener("change", () => {
        const file = els.fileInput?.files?.[0];
        if (file) void handleFile(file);
    });
    els.groupCount?.addEventListener("input", () => void runAnalysis());
    els.sendToColorLayers?.addEventListener("click", () => void sendToColorLayers());
    els.contrast?.addEventListener("input", () => {
        updateRangeOutput(els.contrast);
        void runAnalysis();
    });
    els.lightness?.addEventListener("input", () => {
        updateRangeOutput(els.lightness);
        void runAnalysis();
    });
    els.width?.addEventListener("input", () => syncDimension("width"));
    els.height?.addEventListener("input", () => syncDimension("height"));
    els.layoutMode?.addEventListener("change", applyLayout);

    applyLayout();
};
