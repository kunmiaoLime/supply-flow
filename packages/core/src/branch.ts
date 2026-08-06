import { z } from "zod";

const untrackableBranchNames = new Set(["main", "master"]);

export const projectBranchReviewStates = [
  "coding",
  "code_complete",
  "reviewing",
  "review_issue_found",
  "review_passed"
] as const;

export const ProjectBranchReviewStateSchema = z.enum(projectBranchReviewStates);

export type ProjectBranchReviewState = z.infer<typeof ProjectBranchReviewStateSchema>;

export const ProjectBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  repository_local: z.string().trim().min(1).max(4_096),
  jira_ticket: z.string().trim().url().max(2_048).nullable().default(null),
  implementation_session_id: z.string().trim().min(1).max(255).nullable().default(null),
  review_session_id: z.string().trim().min(1).max(255).nullable().default(null),
  last_session_id: z.string().trim().min(1).max(255).nullable().default(null),
  review_result: z.string().trim().min(1).max(255).nullable().default(null),
  review_state: ProjectBranchReviewStateSchema.default("coding"),
  auto_resolve: z.boolean().default(false)
});

export type ProjectBranch = z.infer<typeof ProjectBranchSchema>;

export const BranchIndexSchema = z.object({
  schemaVersion: z.literal(1),
  branches: z.array(ProjectBranchSchema)
});

export type BranchIndex = z.infer<typeof BranchIndexSchema>;

export function isTrackableProjectBranchName(name: string): boolean {
  return !untrackableBranchNames.has(name.trim().toLowerCase());
}
