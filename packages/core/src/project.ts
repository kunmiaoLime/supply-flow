import { z } from "zod";

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ProjectRepositorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  remote: z.string().trim().min(1).max(2_048).nullable(),
  local: z.string().trim().min(1).max(4_096)
});

export const ProjectRepositoriesSchema = z.array(ProjectRepositorySchema);

export const RequirementSourceTypeSchema = z.enum([
  "google-doc",
  "confluence",
  "figma",
  "slack"
]);

export const RequirementSourceSchema = z.object({
  type: RequirementSourceTypeSchema,
  link: z.string().trim().url().max(2_048)
});

export const ProjectRequirementsSchema = z.array(RequirementSourceSchema);

export const ProjectRecordSchema = z.object({
  project_name: z.string().trim().min(1).max(120),
  project_id: z.string().regex(PROJECT_ID_PATTERN),
  repos: ProjectRepositoriesSchema.default([]),
  requirements: ProjectRequirementsSchema.default([])
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type ProjectRepository = z.infer<typeof ProjectRepositorySchema>;
export type RequirementSource = z.infer<typeof RequirementSourceSchema>;
export type RequirementSourceType = z.infer<typeof RequirementSourceTypeSchema>;

export const ProjectUpdateSchema = z
  .object({
    repos: ProjectRepositoriesSchema.optional(),
    requirements: ProjectRequirementsSchema.optional()
  })
  .refine(
    (update) => update.repos !== undefined || update.requirements !== undefined,
    "A project update requires repositories or requirements."
  );

export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

export interface ProjectStore {
  create(record: ProjectRecord): Promise<ProjectRecord>;
  get(id: string): Promise<ProjectRecord | null>;
  list(): Promise<ProjectRecord[]>;
  update(id: string, update: ProjectUpdate): Promise<ProjectRecord>;
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
