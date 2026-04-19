export type PageSlug = "home" | "blog" | "projects" | "resume" | "toys";

const SECTION_THEMES = {
    home: { bg: "#ffb", accent: "#fbf" },
    resume: { bg: "#7df", accent: "#ffb" },
    blog: { bg: "#fb7", accent: "#ffb" },
    projects: { bg: "#fbf", accent: "#fb7" },
    toys: { bg: "#eee", accent: "#7df" },
} as const;

export const NAV_LINKS = [

    {
        url: "/",
        slug: "home",
        text: "Eric Mikkelsen",
    },
    {
        url: "/resume/",
        slug: "resume",
        text: "Resume",
    },
    {
        slug: "blog",
        text: "Blog",
        url: "/blog/",
    },
] as const;

const PAGE_SLUGS: PageSlug[] = ["home", "blog", "projects", "resume", "toys"];

const isPageSlug = (value: string): value is PageSlug => {
    return PAGE_SLUGS.includes(value as PageSlug);
};

export const normalizePath = (path: string) => {
    if (path === "/") return "/";
    return `/${path.replace(/^\/+|\/+$/g, "")}/`;
};

export const getCurrentPage = (path: string): PageSlug => {
    const normalizedPath = normalizePath(path);

    if (normalizedPath === "/") return "home";

    const firstSegment = normalizedPath.split("/").filter(Boolean)[0] ?? "home";

    return isPageSlug(firstSegment) ? firstSegment : "home";
};

export const getViewTransitionName = (slug: PageSlug) => `dot-${slug}`;

export const getSectionColor = (slug: PageSlug) => SECTION_THEMES[slug].bg;
export const getSectionAccentColor = (slug: PageSlug) => SECTION_THEMES[slug].accent;
