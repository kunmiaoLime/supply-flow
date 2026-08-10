import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  DocumentSourceSchema,
  DocumentTitleSchema,
  ProjectRfcDraftPathSchema
} from "@supply-flow/core/project";

interface Arguments {
  confluenceLink: string;
  draftLink: string;
  projectDirectory: string;
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
  const document = DocumentSourceSchema.parse({
    type: "confluence",
    link: arguments_.confluenceLink,
    title
  });

  const store = new FileProjectStore(path.dirname(projectsDirectory));
  const projectId = path.basename(projectDirectory);
  const project = await store.get(projectId);
  if (!project) {
    throw new Error(`Unknown project "${projectId}".`);
  }

  if (
    project.documents.some(
      (currentDocument) =>
        currentDocument.type === "confluence" && currentDocument.link === document.link
    )
  ) {
    console.log("Confluence RFC is already tracked; no change made.");
    return;
  }

  await store.update(project.project_id, {
    documents: [...project.documents, document]
  });
  console.log(`Tracked Confluence RFC ${JSON.stringify(document.title)}.`);
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: track-project-rfc --project-directory <path> --draft-link <rfcs/file.md> --confluence-link <url>"
      );
    }
    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const draftLink = ProjectRfcDraftPathSchema.safeParse(arguments_.get("--draft-link"));
  const confluenceLink = arguments_.get("--confluence-link")?.trim();
  if (
    !projectDirectory ||
    !draftLink.success ||
    !confluenceLink ||
    arguments_.size !== 3
  ) {
    throw new Error(
      "Usage: track-project-rfc --project-directory <path> --draft-link <rfcs/file.md> --confluence-link <url>"
    );
  }

  return {
    projectDirectory,
    draftLink: draftLink.data,
    confluenceLink
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
  console.error(error instanceof Error ? error.message : "Unable to track the Confluence RFC.");
  process.exitCode = 1;
});
