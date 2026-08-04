import { z } from "zod";

export const ProjectBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  repository_local: z.string().trim().min(1).max(4_096)
});

export type ProjectBranch = z.infer<typeof ProjectBranchSchema>;

export const BranchIndexSchema = z.object({
  schemaVersion: z.literal(1),
  branches: z.array(ProjectBranchSchema)
});

export type BranchIndex = z.infer<typeof BranchIndexSchema>;
