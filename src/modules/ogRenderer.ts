import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import satori from "satori";
import { getPageFavicon, getSectionAccentColor, getSectionColor, type PageSlug } from "./navigation";
import { getOgTitle } from "./og";

const OG_WIDTH = 1200;
const OG_HEIGHT = 627;
const OG_PNG_COLORS = 10;

const TITLE_FONT_PATH = path.resolve(process.cwd(), "public/fonts/SpaceCowgirl/ttf/SpaceCowgirl-Bold.ttf");
const OFTEXT_FONT_PATH = path.resolve(process.cwd(), "node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-700-italic.woff");
const BACKGROUND_PATH = path.resolve(process.cwd(), "public/images/easter-colors.png");

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

let cachedTitleFontData: ArrayBuffer | null = null;
let cachedOfTextFontData: ArrayBuffer | null = null;
let cachedBackgroundImage: string | null = null;
const cachedPageIcons = new Map<PageSlug, string>();

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

const getBackgroundDataUri = async () => {
    if (cachedBackgroundImage) return cachedBackgroundImage;

    const backgroundBuffer = await fs.readFile(BACKGROUND_PATH);
    cachedBackgroundImage = `data:image/png;base64,${backgroundBuffer.toString("base64")}`;

    return cachedBackgroundImage;
};

const getPageIconDataUri = async (slug: PageSlug) => {
    const cachedIcon = cachedPageIcons.get(slug);
    if (cachedIcon) return cachedIcon;

    const iconPath = getPageFavicon(slug).replace(/^\/+/, "");
    const absoluteIconPath = path.resolve(process.cwd(), "public", iconPath);
    const iconSvg = await fs.readFile(absoluteIconPath, "utf8");
    const normalizedIconSvg = iconSvg.replace(/stroke-width="[^"]*"/g, 'stroke-width="2"');

    const iconDataUri = `data:image/svg+xml;base64,${Buffer.from(normalizedIconSvg).toString("base64")}`;
    cachedPageIcons.set(slug, iconDataUri);

    return iconDataUri;
};

export const renderOgImage = async ({
    title,
    ofText,
    slug,
}: {
    title: string;
    ofText?: string;
    slug: PageSlug;
}) => {
    const [titleFontData, ofTextFontData, backgroundDataUri, pageIconDataUri] = await Promise.all([
        getTitleFontData(),
        getOfTextFontData(),
        getBackgroundDataUri(),
        getPageIconDataUri(slug),
    ]);

    const safeTitle = getOgTitle(title);
    const safeOfText = ofText?.trim();
    const sectionColor = getSectionColor(slug);
    const sectionAccentColor = getSectionAccentColor(slug);

    const svg = await satori(
        {
            type: "div",
            props: {
                style: {
                    width: `${OG_WIDTH}px`,
                    height: `${OG_HEIGHT}px`,
                    display: "flex",
                    position: "relative",
                    boxSizing: "border-box",
                    border: "16px solid #000",
                    overflow: "hidden",
                    fontFamily: "Spacegirl",
                    color: "#000",
                    backgroundColor: "#fff",
                },
                children: [
                    {
                        type: "img",
                        props: {
                            src: backgroundDataUri,
                            width: OG_WIDTH,
                            height: OG_HEIGHT,
                            style: {
                                position: "absolute",
                                top: "0px",
                                left: "0px",
                                width: `${OG_WIDTH}px`,
                                height: `${OG_HEIGHT}px`,
                                objectFit: "cover",
                            },
                        },
                    },
                    {
                        type: "div",
                        props: {
                            style: {
                                position: "absolute",
                                inset: "0px",
                                backgroundColor: sectionColor,
                                opacity: 0.62,
                            },
                        },
                    },
                    {
                        type: "div",
                        props: {
                            style: {
                                position: "absolute",
                                inset: "0px",
                                backgroundImage: "linear-gradient(140deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.05) 65%)",
                            },
                        },
                    },
                    {
                        type: "div",
                        props: {
                            style: {
                                display: "flex",
                                width: "100%",
                                height: "100%",
                                position: "relative",
                                padding: "54px 54px 0 0",
                                alignItems: "flex-end",
                            },
                            children: {
                                type: "div",
                                props: {
                                    style: {
                                        display: "flex",
                                        flexDirection: "column",
                                        width: "100%",
                                        minWidth: 0,
                                        maxWidth: "80%",
                                        border: "3px solid #000",
                                        borderTopWidth: "1px",
                                        borderRightWidth: "1px",
                                        borderLeft: "none",
                                        backgroundColor: sectionColor,
                                        padding: "36px 38px",
                                    },
                                    children: [
                                        {
                                            type: "img",
                                            props: {
                                                src: pageIconDataUri,
                                                width: 56,
                                                height: 56,
                                                style: {
                                                    marginBottom: "16px",
                                                },
                                            },
                                        },
                                        {
                                            type: "div",
                                            props: {
                                                style: {
                                                    fontSize: "97px",
                                                    lineHeight: "1.02",
                                                    minWidth: 0,
                                                    width: "100%",
                                                    overflow: "hidden",
                                                    textShadow: `0.025em 0.025em ${sectionAccentColor}`,
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
                                                        fontSize: "34px",
                                                        lineHeight: "1.1",
                                                        marginTop: "14px",
                                                        fontWeight: 700,
                                                        fontStyle: "italic",
                                                        textShadow: `0.1em 0.1em ${sectionColor}`,
                                                    },
                                                    children: safeOfText,
                                                },
                                            }
                                            : null,
                                    ],
                                },
                            },
                        },
                    },
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