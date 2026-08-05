import { z } from "zod";

const CONTEXT_ISSUE_ID_PATTERN = /^[a-z]+-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ContextIssueSeveritySchema = z.enum(["blocking", "high", "medium", "low"]);

export const ContextIssueSourceSchema = z.object({
  reference: z.string().trim().min(1).max(4_096),
  detail: z.string().trim().min(1).max(4_000)
});

export const ContextGapSchema = z.object({
  id: z.string().regex(CONTEXT_ISSUE_ID_PATTERN).startsWith("gap-"),
  title: z.string().trim().min(1).max(240),
  severity: ContextIssueSeveritySchema,
  description: z.string().trim().min(1).max(4_000),
  impact: z.string().trim().min(1).max(2_000),
  questions: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  sources: z.array(ContextIssueSourceSchema).min(1).max(20)
});

export const ContextConflictSchema = z.object({
  id: z.string().regex(CONTEXT_ISSUE_ID_PATTERN).startsWith("conflict-"),
  title: z.string().trim().min(1).max(240),
  severity: ContextIssueSeveritySchema,
  description: z.string().trim().min(1).max(4_000),
  impact: z.string().trim().min(1).max(2_000),
  sources: z.array(ContextIssueSourceSchema).min(2).max(20),
  resolution_options: z.array(z.string().trim().min(1).max(2_000)).min(1).max(10)
});

export const ContextGapIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    gaps: z.array(ContextGapSchema).max(200)
  })
  .refine((value) => hasUniqueIds(value.gaps), "Context gap IDs must be unique.");

export const ContextConflictIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    conflicts: z.array(ContextConflictSchema).max(200)
  })
  .refine((value) => hasUniqueIds(value.conflicts), "Context conflict IDs must be unique.");

export type ContextIssueSeverity = z.infer<typeof ContextIssueSeveritySchema>;
export type ContextIssueSource = z.infer<typeof ContextIssueSourceSchema>;
export type ContextGap = z.infer<typeof ContextGapSchema>;
export type ContextConflict = z.infer<typeof ContextConflictSchema>;
export type ContextGapIndex = z.infer<typeof ContextGapIndexSchema>;
export type ContextConflictIndex = z.infer<typeof ContextConflictIndexSchema>;

export interface ContextAnalysis {
  gaps: ContextGap[];
  conflicts: ContextConflict[];
}

function hasUniqueIds(issues: ReadonlyArray<{ id: string }>): boolean {
  return new Set(issues.map((issue) => issue.id)).size === issues.length;
}
