import { z } from "zod";

export const ProjectPullRequestSchema = z.object({
  url: z.string().trim().url().max(2_048),
  title: z.string().trim().min(1).max(255),
  number: z.number().int().positive(),
  branch: z.string().trim().min(1).max(255),
  repository_local: z.string().trim().min(1).max(4_096)
});

export type ProjectPullRequest = z.infer<typeof ProjectPullRequestSchema>;

export const PullRequestIndexSchema = z.object({
  schemaVersion: z.literal(1),
  prs: z.array(ProjectPullRequestSchema)
});

export type PullRequestIndex = z.infer<typeof PullRequestIndexSchema>;
