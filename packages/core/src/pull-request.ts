import { z } from "zod";

export const projectPullRequestStatuses = [
  "unknown",
  "open",
  "draft",
  "closed",
  "merged"
] as const;

export const projectPullRequestCiStatuses = [
  "unknown",
  "none",
  "pending",
  "success",
  "failure"
] as const;

export const ProjectPullRequestStatusSchema = z.enum(projectPullRequestStatuses);
export const ProjectPullRequestCiStatusSchema = z.enum(projectPullRequestCiStatuses);

export type ProjectPullRequestStatus = z.infer<typeof ProjectPullRequestStatusSchema>;
export type ProjectPullRequestCiStatus = z.infer<typeof ProjectPullRequestCiStatusSchema>;

export const ProjectPullRequestSchema = z.object({
  url: z.string().trim().url().max(2_048),
  title: z.string().trim().min(1).max(255),
  number: z.number().int().positive(),
  branch: z.string().trim().min(1).max(255),
  repository_local: z.string().trim().min(1).max(4_096),
  monitoring_enabled: z.boolean().default(false),
  retry_ci_enabled: z.boolean().default(false),
  status: ProjectPullRequestStatusSchema.default("unknown"),
  unresolved_comment_count: z.number().int().nonnegative().default(0),
  unreplied_comment_count: z.number().int().nonnegative().default(0),
  ci_status: ProjectPullRequestCiStatusSchema.default("unknown"),
  last_scanned_at: z.string().datetime().nullable().default(null),
  last_ci_retry_at: z.string().datetime().nullable().default(null),
  last_ci_retry_error: z.string().trim().min(1).max(4_000).nullable().default(null),
  last_session_id: z.string().trim().min(1).max(255).nullable().default(null)
});

export type ProjectPullRequest = z.infer<typeof ProjectPullRequestSchema>;
export type ProjectPullRequestInput = z.input<typeof ProjectPullRequestSchema>;

export const PullRequestIndexSchema = z.object({
  schemaVersion: z.literal(1),
  prs: z.array(ProjectPullRequestSchema)
});

export type PullRequestIndex = z.infer<typeof PullRequestIndexSchema>;
