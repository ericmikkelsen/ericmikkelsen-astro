import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

// Expose your defined collection to Astro
// with the `collections` export
const blog = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
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
    loader: glob({ pattern: '*.md', base: './src/content' }),
    schema: z.object({
        title: z.string(),
        ofText: z.string().optional(),
        description: z.string(),
        contact: z.array(z.object({
            url: z.string(),
            text: z.string(),
        })).optional(),
        workHistory: z.array(z.object({
            organization: z.string(),
            jobTitle: z.string(),
            date: z.string(),
            description: z.string().optional(),
            bulletPoints: z.array(z.string()).optional()
        })).optional(),
        skills: z.array(z.string()).optional(),
    }),
});

// Expose your defined collection to Astro
// with the `collections` export
export const collections = { blog, pages, projects };