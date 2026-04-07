import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

// Expose your defined collection to Astro
// with the `collections` export
const blog = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
    schema: z.object({
        title: z.string(),
        date: z.date(),
        permalink: z.string().optional(),
    }),
});

const projects = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
    schema: z.object({
        title: z.string(),
        description: z.string(),
        url: z.string()
    }),
});

const pages = defineCollection({
    loader: glob({ pattern: './*.md', base: './src/content' }),
    schema: z.object({
        title: z.string(),
        description: z.string(),
    }),
});

// Expose your defined collection to Astro
// with the `collections` export
export const collections = { blog, pages, projects };