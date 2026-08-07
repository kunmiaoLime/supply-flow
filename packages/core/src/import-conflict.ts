import { z } from "zod";
import { ContextIssueSeveritySchema } from "@supply-flow/core/context-analysis";

const IMPORT_CONFLICT_ID_PATTERN = /^import-conflict-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ImportConflictValueSchema = z.object({
  reference: z.string().trim().min(1).max(4_096),
  detail: z.string().trim().min(1).max(4_000)
});

export const ImportConflictSchema = z.object({
  id: z.string().regex(IMPORT_CONFLICT_ID_PATTERN),
  title: z.string().trim().min(1).max(240),
  severity: ContextIssueSeveritySchema,
  path: z.string().trim().min(1).max(4_096),
  description: z.string().trim().min(1).max(4_000),
  existing: ImportConflictValueSchema,
  imported: ImportConflictValueSchema,
  resolution_options: z.array(z.string().trim().min(1).max(2_000)).min(1).max(10)
});

export const ImportConflictIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    conflicts: z.array(ImportConflictSchema).max(200)
  })
  .refine(
    (value) => new Set(value.conflicts.map((conflict) => conflict.id)).size === value.conflicts.length,
    "Import conflict IDs must be unique."
  );

export type ImportConflictValue = z.infer<typeof ImportConflictValueSchema>;
export type ImportConflict = z.infer<typeof ImportConflictSchema>;
export type ImportConflictIndex = z.infer<typeof ImportConflictIndexSchema>;
