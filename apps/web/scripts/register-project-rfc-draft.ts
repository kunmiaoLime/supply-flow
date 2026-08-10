import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  DocumentTitleSchema,
  ProjectRepositorySchema,
  ProjectRfcDraftPathSchema
} from "@supply-flow/core/project";

interface Arguments {
  draftLink: string;
  projectDirectory: string;
  repositoryLocals: string[];
  rfcSessionId: string;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const projectDirectory = path.resolve(arguments_.projectDirectory);
  const projectsDirectory = path.dirname(projectDirectory);
  if (path.basename(projectsDirectory) !== "projects") {
    throw new Error("The project directory must be located beneath a projects directory.");
  }

  const draftPath = path.join(projectDirectory, ...arguments_.draftLink.split("/"));
  const metadata = await stat(draftPath);
  if (!metadata.isFile()) {
    throw new Error("The RFC draft path must identify a regular file.");
  }

  const title = rfcTitle(await readFile(draftPath, "utf8"));
  const store = new FileProjectStore(path.dirname(projectsDirectory));
  const projectId = path.basename(projectDirectory);
  const project = await store.get(projectId);
  if (!project) {
    throw new Error(`Unknown project "${projectId}".`);
  }
  const repositoryLocals = new Set(project.repos.map((repository) => repository.local));
  if (arguments_.repositoryLocals.some((local) => !repositoryLocals.has(local))) {
    throw new Error("Every RFC repository scope must be associated with the project.");
  }

  const existing = project.documents.find(
    (document) => document.type === "rfc-draft" && document.link === arguments_.draftLink
  );
  const trackedDraft = {
    type: "rfc-draft" as const,
    link: arguments_.draftLink,
    title,
    rfc_session_id: arguments_.rfcSessionId,
    repository_locals: arguments_.repositoryLocals
  };
  await store.update(project.project_id, {
    documents: existing
      ? project.documents.map((document) =>
          document.type === "rfc-draft" && document.link === arguments_.draftLink
            ? trackedDraft
            : document
        )
      : [...project.documents, trackedDraft]
  });
  console.log(`${existing ? "Updated" : "Tracked"} RFC draft ${JSON.stringify(title)}.`);
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  const repositoryLocals: string[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: register-project-rfc-draft --project-directory <path> --draft-link <rfcs/file.md> --rfc-session-id <id> --repository-local <path> [--repository-local <path> ...]"
      );
    }
    if (flag === "--repository-local") {
      repositoryLocals.push(value);
      continue;
    }
    if (
      (flag !== "--project-directory" && flag !== "--draft-link" && flag !== "--rfc-session-id") ||
      arguments_.has(flag)
    ) {
      throw new Error(
        "Usage: register-project-rfc-draft --project-directory <path> --draft-link <rfcs/file.md> --rfc-session-id <id> --repository-local <path> [--repository-local <path> ...]"
      );
    }
    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const draftLink = ProjectRfcDraftPathSchema.safeParse(arguments_.get("--draft-link"));
  const rfcSessionId = arguments_.get("--rfc-session-id")?.trim();
  const normalizedRepositoryLocals: string[] = [];
  for (const repositoryLocal of repositoryLocals) {
    const parsedRepositoryLocal = ProjectRepositorySchema.shape.local.safeParse(
      repositoryLocal
    );
    if (!parsedRepositoryLocal.success) {
      throw new Error(
        "Usage: register-project-rfc-draft --project-directory <path> --draft-link <rfcs/file.md> --rfc-session-id <id> --repository-local <path> [--repository-local <path> ...]"
      );
    }
    normalizedRepositoryLocals.push(parsedRepositoryLocal.data);
  }
  if (
    !projectDirectory ||
    !draftLink.success ||
    !rfcSessionId ||
    !/^[A-Za-z0-9_-]+$/.test(rfcSessionId) ||
    arguments_.size !== 3 ||
    normalizedRepositoryLocals.length === 0
  ) {
    throw new Error(
      "Usage: register-project-rfc-draft --project-directory <path> --draft-link <rfcs/file.md> --rfc-session-id <id> --repository-local <path> [--repository-local <path> ...]"
    );
  }
  if (new Set(normalizedRepositoryLocals).size !== normalizedRepositoryLocals.length) {
    throw new Error("RFC repository scopes must be unique.");
  }

  return {
    projectDirectory,
    draftLink: draftLink.data,
    rfcSessionId,
    repositoryLocals: normalizedRepositoryLocals
  };
}

function rfcTitle(content: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => /^#\s+(.+?)\s*$/.exec(line)?.[1]?.replace(/^\[RFC\]\s*/i, "").trim())
    .find((value): value is string => Boolean(value));
  if (!heading || /<[^>]+>/.test(heading)) {
    throw new Error("The RFC draft must start with a completed level-one title.");
  }

  const title = DocumentTitleSchema.safeParse(heading);
  if (!title.success) {
    throw new Error("The RFC draft title must be between 1 and 240 characters.");
  }
  return title.data;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to register the RFC draft.");
  process.exitCode = 1;
});
