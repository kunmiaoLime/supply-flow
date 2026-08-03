import { z } from "zod";

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ProjectRecordSchema = z.object({
  project_name: z.string().trim().min(1).max(120),
  project_id: z.string().regex(PROJECT_ID_PATTERN)
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export interface ProjectStore {
  create(record: ProjectRecord): Promise<ProjectRecord>;
  get(id: string): Promise<ProjectRecord | null>;
  list(): Promise<ProjectRecord[]>;
}

export function createProjectId(name: string, existingProjectIds: Iterable<string>): string {
  const baseId = toKebabCase(name);
  const ids = new Set(existingProjectIds);

  if (!ids.has(baseId)) {
    return baseId;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (!ids.has(candidate)) {
      return candidate;
    }
  }
}

function toKebabCase(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return normalized || "project";
}
