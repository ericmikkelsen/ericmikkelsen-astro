import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import satori from "satori";
import { getPageFavicon, getSectionColor, type PageSlug } from "./navigation";
import { getOgTitle } from "./og";

const OG_WIDTH = 1200;
const OG_HEIGHT = 627;
const OG_CROPPED_SIZE = 1208;
const OG_PNG_COLORS = 4;
const BASE_TITLE_FONT_SIZE = 124;
const MIN_TITLE_FONT_SIZE = 113;
const MAX_TITLE_FONT_SIZE = 150;

const TITLE_FONT_PATH = path.resolve(process.cwd(), "public/fonts/SpaceCowgirl/ttf/SpaceCowgirl-Bold.ttf");
const OFTEXT_FONT_PATH = path.resolve(process.cwd(), "node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-700-italic.woff");

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

const clamp = (value: number, min: number, max: number) => {
    return Math.min(max, Math.max(min, value));
};

const getDynamicTitleFontSize = (title: string) => {
    const normalizedTitle = title.trim();
    const words = normalizedTitle.split(/\s+/).filter(Boolean);
    const charCount = normalizedTitle.length;
    const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);

    // Short titles (or short words) can be larger; long titles/words get reduced.
    const targetCharCount = 20;
    const targetLongestWord = 10;
    const sizeDeltaFromChars = (targetCharCount - charCount) * 2.1;
    const sizeDeltaFromLongestWord = (targetLongestWord - longestWordLength) * 3.2;
    const dynamicSize = BASE_TITLE_FONT_SIZE + sizeDeltaFromChars + sizeDeltaFromLongestWord;

    return Math.round(clamp(dynamicSize, MIN_TITLE_FONT_SIZE, MAX_TITLE_FONT_SIZE));
};

let cachedTitleFontData: ArrayBuffer | null = null;
let cachedOfTextFontData: ArrayBuffer | null = null;
const cachedPageIcons = new Map<PageSlug, { dataUri: string; aspectRatio: number }>();

const getTitleFontData = async () => {
    if (cachedTitleFontData) return cachedTitleFontData;

    const fontBuffer = await fs.readFile(TITLE_FONT_PATH);
    cachedTitleFontData = toArrayBuffer(fontBuffer);

    return cachedTitleFontData;
};

const getOfTextFontData = async () => {
    if (cachedOfTextFontData) return cachedOfTextFontData;

    const fontBuffer = await fs.readFile(OFTEXT_FONT_PATH);
    cachedOfTextFontData = toArrayBuffer(fontBuffer);

    return cachedOfTextFontData;
};

const getPageIconDataUri = async (slug: PageSlug) => {
    const cachedIcon = cachedPageIcons.get(slug);
    if (cachedIcon) return cachedIcon;

    const iconPath = getPageFavicon(slug).replace(/^\/+/, "");
    const absoluteIconPath = path.resolve(process.cwd(), "public", iconPath);
    const iconSvg = await fs.readFile(absoluteIconPath, "utf8");
    const normalizedIconSvg = iconSvg.replace(/stroke-width="[^"]*"/g, 'stroke-width="2"');
    const viewBoxMatch = normalizedIconSvg.match(/viewBox="([^"]+)"/i);
    const aspectRatio = viewBoxMatch
        ? (() => {
            const [, , w, h] = viewBoxMatch[1].trim().split(/\s+/).map(Number);
            if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return 1;
            return w / h;
        })()
        : 1;

    const iconDataUri = `data:image/svg+xml;base64,${Buffer.from(normalizedIconSvg).toString("base64")}`;
    cachedPageIcons.set(slug, { dataUri: iconDataUri, aspectRatio });

    return { dataUri: iconDataUri, aspectRatio };
};

export const renderOgImage = async ({
    title,
    ofText,
    image,
    slug,
}: {
    title: string;
    ofText?: string;
    image?: string;
    slug: PageSlug;
}) => {
    if (image) {
        return renderCroppedSourceImage(image);
    }

    const [titleFontData, ofTextFontData, pageIcon] = await Promise.all([
        getTitleFontData(),
        getOfTextFontData(),
        getPageIconDataUri(slug),
    ]);

    const safeTitle = getOgTitle(title);
    const safeOfText = ofText?.trim();
    const sectionColor = getSectionColor(slug);
    const titleFontSize = getDynamicTitleFontSize(safeTitle);
    const iconHeight = 74;
    const iconWidth = Math.max(1, Math.round(iconHeight * pageIcon.aspectRatio));

    const svg = await satori(
        {
            type: "div",
            props: {
                style: {
                    width: `${OG_WIDTH}px`,
                    height: `${OG_HEIGHT}px`,
                    display: "flex",
                    boxSizing: "border-box",
                    fontFamily: "Spacegirl",
                    color: "#000",
                    backgroundColor: sectionColor,
                    padding: "48px 58px",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "flex-start",
                    gap: "18px",
                },
                children: [
                    {
                        type: "img",
                        props: {
                            src: pageIcon.dataUri,
                            width: iconWidth,
                            height: iconHeight,
                            style: {
                                marginBottom: "6px",
                            },
                        },
                    },
                    {
                        type: "div",
                        props: {
                            style: {
                                fontSize: `${titleFontSize}px`,
                                lineHeight: "1.03",
                                minWidth: 0,
                                width: "100%",
                                overflow: "hidden",
                                textWrap: "balance",
                            },
                            children: safeTitle,
                        },
                    },
                    safeOfText
                        ? {
                            type: "div",
                            props: {
                                style: {
                                    fontFamily: "SourceSerif4, serif",
                                    fontSize: "48px",
                                    lineHeight: "1.1",
                                    fontWeight: 700,
                                    fontStyle: "italic",
                                },
                                children: safeOfText,
                            },
                        }
                        : null,
                ],
            },
        },
        {
            width: OG_WIDTH,
            height: OG_HEIGHT,
            fonts: [
                {
                    name: "Spacegirl",
                    data: titleFontData,
                    weight: 700,
                    style: "normal",
                },
                {
                    name: "SourceSerif4",
                    data: ofTextFontData,
                    weight: 700,
                    style: "italic",
                },
            ],
        },
    );

    const resvg = new Resvg(svg, {
        fitTo: {
            mode: "width",
            value: OG_WIDTH,
        },
    });

    const pngData = resvg.render();

    return sharp(pngData.asPng())
        .png({
            palette: true,
            colours: OG_PNG_COLORS,
            effort: 10,
            dither: 0.8,
        })
        .toBuffer();
};

const resolveImageToBuffer = async (image: string): Promise<Buffer> => {
    const trimmedImage = image.trim();
    if (!trimmedImage) {
        throw new Error("Social image path is empty.");
    }

    if (/^https?:\/\//i.test(trimmedImage)) {
        const response = await fetch(trimmedImage);
        if (!response.ok) {
            throw new Error(`Failed to fetch social image ${trimmedImage}: ${response.status} ${response.statusText}`);
        }
        const bytes = await response.arrayBuffer();
        return Buffer.from(bytes);
    }

    const normalizedPath = trimmedImage.replace(/^\/+/, "");
    const absolutePath = path.resolve(process.cwd(), "public", normalizedPath);
    return fs.readFile(absolutePath);
};

const renderCroppedSourceImage = async (image: string): Promise<Buffer> => {
    const sourceImage = await resolveImageToBuffer(image);

    return sharp(sourceImage)
        .rotate()
        .resize(OG_CROPPED_SIZE, OG_CROPPED_SIZE, {
            fit: "cover",
            position: "attention",
        })
        .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
        })
        .toBuffer();
};