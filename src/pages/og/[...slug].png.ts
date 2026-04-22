import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { SITE_TITLE } from "../../consts";
import { getOgPageSlug, getOgRouteParam, type OgPage } from "../../modules/og";
import { renderOgImage } from "../../modules/ogRenderer";

const OG_IMAGE_PATHS = [
    { pathname: "/blog/", title: "Blog" },
    { pathname: "/projects/", title: "Projects" },
    { pathname: "/resume/", title: "Eric Mikkelsen", ofText: "Resume" },
    { pathname: "/toys/prism-graph/", title: SITE_TITLE },
];

const getStaticOgPages = async (): Promise<OgPage[]> => {
    const [pages, blogPosts, projects] = await Promise.all([
        getCollection("pages"),
        getCollection("blog"),
        getCollection("projects"),
    ]);

    const collectionPages: OgPage[] = pages.map((entry) => {
        const id = entry.id.replace(/\.md$/, "");
        const pathname = id === "index" ? "/" : `/${id}/`;

        return {
            pathname,
            title: entry.data.title,
            ofText: entry.data.ofText,
            image: entry.data.image,
            slug: getOgPageSlug(pathname),
        };
    });

    const blogPages: OgPage[] = blogPosts.map((entry) => {
        const pathname = `/blog/${entry.id}/`;

        return {
            pathname,
            title: entry.data.title,
            image: entry.data.image,
            slug: getOgPageSlug(pathname),
        };
    });

    const projectPages: OgPage[] = projects.map((entry) => {
            const pathname = `/projects/${entry.id}/`;

            return {
                pathname,
                title: entry.data.title,
                image: entry.data.image,
                slug: getOgPageSlug(pathname),
            };
        });

    const staticPages: OgPage[] = OG_IMAGE_PATHS.map(({ pathname, title, ofText }) => ({
        pathname,
        title,
        ofText,
        slug: getOgPageSlug(pathname),
    }));

    const pageMap = new Map<string, OgPage>();

    [...collectionPages, ...blogPages, ...projectPages, ...staticPages].forEach((page) => {
        pageMap.set(page.pathname, page);
    });

    return [...pageMap.values()];
};

export const getStaticPaths = async () => {
    const pages = await getStaticOgPages();

    return pages.map((page) => ({
        params: {
            slug: getOgRouteParam(page.pathname),
        },
        props: page,
    }));
};

export const GET: APIRoute = async ({ props }) => {
    const page = props as OgPage;
    const png = await renderOgImage({
        title: page.title,
        ofText: page.ofText,
        image: page.image,
        slug: page.slug,
    });
    const body = new Uint8Array(png);

    return new Response(body, {
        headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
    });
};
