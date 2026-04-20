import { getCurrentPage, normalizePath, type PageSlug } from "./navigation";

export type OgPage = {
    pathname: string;
    title: string;
    ofText?: string;
    slug: PageSlug;
};

export const getOgRouteParam = (pathname: string) => {
    const normalizedPath = normalizePath(pathname);

    if (normalizedPath === "/") return "index";

    return normalizedPath.slice(1, -1);
};

export const getOgImagePath = (pathname: string) => {
    return `/og/${getOgRouteParam(pathname)}.png`;
};

export const getOgPageSlug = (pathname: string) => getCurrentPage(pathname);

export const getOgTitle = (title: string) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) return "Eric Mikkelsen";

    if (trimmedTitle.length <= 96) return trimmedTitle;

    return `${trimmedTitle.slice(0, 93).trimEnd()}...`;
};