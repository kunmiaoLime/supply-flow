import {
  AiProviderIdSchema,
  ReasoningEffortSchema,
  supportsReasoningEffort
} from "@supply-flow/core/ai-model-settings";
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

export const ProjectBranchReviewSessionConfigurationSchema = z
  .object({
    provider_id: AiProviderIdSchema,
    model: z.string().trim().min(1).max(120).nullable(),
    reasoning_effort: ReasoningEffortSchema.nullable(),
    read_only: z.boolean(),
    yolo_mode: z.boolean()
  })
  .superRefine((configuration, context) => {
    if (!supportsReasoningEffort(configuration.provider_id, configuration.reasoning_effort)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The reasoning effort is not supported by the selected AI provider.",
        path: ["reasoning_effort"]
      });
    }
  });

export type ProjectBranchReviewSessionConfiguration = z.infer<
  typeof ProjectBranchReviewSessionConfigurationSchema
>;

export const ProjectBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  repository_local: z.string().trim().min(1).max(4_096),
  jira_ticket: z.string().trim().url().max(2_048).nullable().default(null),
  implementation_session_id: z.string().trim().min(1).max(255).nullable().default(null),
  review_session_id: z.string().trim().min(1).max(255).nullable().default(null),
  review_session_configuration: ProjectBranchReviewSessionConfigurationSchema.nullable().default(
    null
  ),
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
