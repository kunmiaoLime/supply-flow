import { z } from "zod";

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ProjectRepositorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  remote: z.string().trim().min(1).max(2_048).nullable(),
  local: z.string().trim().min(1).max(4_096)
});

export const ProjectRepositoriesSchema = z.array(ProjectRepositorySchema);

export const DocumentSourceTypeSchema = z.enum([
  "google-doc",
  "confluence",
  "figma",
  "slack",
  "markdown",
  "rfc-draft"
]);

export const DocumentTitleSchema = z.string().trim().min(1).max(240);
const ProjectSessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/, "RFC draft session ids must be safe path segments.");
export const ProjectMarkdownPathSchema = z
  .string()
  .trim()
  .max(1_024)
  .regex(
    /^markdowns\/[^/\\\0]+\.md$/i,
    "Markdown documents must be stored beneath the project markdowns directory."
  );
export const ProjectRfcDraftPathSchema = z
  .string()
  .trim()
  .max(1_024)
  .regex(
    /^rfcs\/[^/\\\0]+\.md$/i,
    "RFC drafts must be stored beneath the project rfcs directory."
  );
export const ProjectLocalDocumentPathSchema = z.union([
  ProjectMarkdownPathSchema,
  ProjectRfcDraftPathSchema
]);

const ExternalDocumentLinkSchema = z.string().trim().url().max(2_048);

export const DocumentSourceSchema = z
  .object({
    type: DocumentSourceTypeSchema,
    link: z.string().trim().min(1).max(2_048),
    title: DocumentTitleSchema.nullable().optional(),
    rfc_session_id: ProjectSessionIdSchema.optional(),
    repository_locals: z.array(ProjectRepositorySchema.shape.local).min(1).max(64).optional()
  })
  .superRefine((document, context) => {
    const linkSchema =
      document.type === "markdown"
        ? ProjectMarkdownPathSchema
        : document.type === "rfc-draft"
          ? ProjectRfcDraftPathSchema
          : ExternalDocumentLinkSchema;
    const result = linkSchema.safeParse(document.link);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message:
          document.type === "markdown"
            ? "Markdown documents must reference a project-local Markdown file."
            : document.type === "rfc-draft"
              ? "RFC drafts must reference a project-local RFC draft file."
              : "Document links must be valid URLs.",
        path: ["link"]
      });
    }

    const hasRfcMetadata =
      document.rfc_session_id !== undefined || document.repository_locals !== undefined;
    if (document.type !== "rfc-draft" && hasRfcMetadata) {
      context.addIssue({
        code: "custom",
        message: "RFC draft session metadata is only supported for RFC drafts.",
        path: ["rfc_session_id"]
      });
    }
    if (
      document.type === "rfc-draft" &&
      document.repository_locals !== undefined &&
      new Set(document.repository_locals).size !== document.repository_locals.length
    ) {
      context.addIssue({
        code: "custom",
        message: "RFC draft repository scopes must be unique.",
        path: ["repository_locals"]
      });
    }
  })
  .transform(({ title, ...document }) => ({
    ...document,
    title: title ?? null
  }));

export const ProjectDocumentsSchema = z.array(DocumentSourceSchema);

export const ProjectTaskStatusSchema = z.object({
  id: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  category: z.string().trim().min(1).max(255),
  color_name: z.string().trim().min(1).max(255).optional()
});

export const ProjectTaskSchema = z.object({
  title: z.string().trim().min(1).max(255),
  jira_ticket: z.string().trim().url().max(2_048),
  jira_status: ProjectTaskStatusSchema.optional()
});

export const ProjectTasksSchema = z.array(ProjectTaskSchema);

export const ProjectRecordSchema = z
  .object({
    project_name: z.string().trim().min(1).max(120),
    project_id: z.string().regex(PROJECT_ID_PATTERN),
    repos: ProjectRepositoriesSchema.default([]),
    documents: ProjectDocumentsSchema.optional(),
    requirements: ProjectDocumentsSchema.optional(),
    tasks: ProjectTasksSchema.optional()
  })
  .transform(({ documents, requirements, tasks, ...record }) => ({
    ...record,
    documents: documents ?? requirements ?? [],
    tasks: tasks ?? []
  }));

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type ProjectRepository = z.infer<typeof ProjectRepositorySchema>;
export type DocumentSource = z.infer<typeof DocumentSourceSchema>;
export type DocumentSourceType = z.infer<typeof DocumentSourceTypeSchema>;
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;
export type ProjectTaskStatus = z.infer<typeof ProjectTaskStatusSchema>;

export const ProjectUpdateSchema = z
  .object({
    repos: ProjectRepositoriesSchema.optional(),
    documents: ProjectDocumentsSchema.optional(),
    tasks: ProjectTasksSchema.optional()
  })
  .refine(
    (update) =>
      update.repos !== undefined || update.documents !== undefined || update.tasks !== undefined,
    "A project update requires repositories, documents, or tasks."
  );

export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

export function isProjectLocalDocumentType(type: DocumentSourceType): boolean {
  return type === "markdown" || type === "rfc-draft";
}

export interface ProjectStore {
  create(record: ProjectRecord): Promise<ProjectRecord>;
  get(id: string): Promise<ProjectRecord | null>;
  list(): Promise<ProjectRecord[]>;
  update(id: string, update: ProjectUpdate): Promise<ProjectRecord>;
  remove(id: string): Promise<boolean>;
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
