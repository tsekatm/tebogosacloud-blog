import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
    category: z.enum([
      'AWS & Cloud Architecture',
      'DevOps & Infrastructure',
      'GenAI & AI Engineering',
      'Cloud Security',
      'Career & Leadership',
      'Technical Deep Dives',
    ]),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    heroImage: z.string().optional(),
    techStack: z.array(z.string()),
    role: z.string(),
    year: z.string(),
    liveUrl: z.string().optional(),
    repoUrl: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const speaking = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    event: z.string(),
    date: z.coerce.date(),
    location: z.string(),
    type: z.enum(['conference', 'meetup', 'webinar', 'workshop', 'podcast']),
    slidesUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    description: z.string(),
    upcoming: z.boolean().default(false),
  }),
});

export const collections = { blog, projects, speaking };
