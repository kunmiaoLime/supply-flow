import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  DocumentSourceTypeSchema,
  DocumentTitleSchema,
  type DocumentSourceType
} from "@supply-flow/core/project";

interface Arguments {
  projectDirectory: string;
  sourceType: DocumentSourceType;
  sourceLink: string;
  title: string;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const projectDirectory = path.resolve(arguments_.projectDirectory);
  const projectsDirectory = path.dirname(projectDirectory);
  if (path.basename(projectsDirectory) !== "projects") {
    throw new Error("The project directory must be located beneath a projects directory.");
  }

  const result = await new FileProjectStore(path.dirname(projectsDirectory)).assignMissingDocumentTitle(
    path.basename(projectDirectory),
    {
      type: arguments_.sourceType,
      link: arguments_.sourceLink
    },
    arguments_.title
  );

  console.log(
    result.assigned
      ? `Assigned document title ${JSON.stringify(arguments_.title)}.`
      : "Document title is already set; no change made."
  );
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: assign-project-document-title --project-directory <path> --source-type <type> --source-link <url> --title <title>"
      );
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const sourceType = DocumentSourceTypeSchema.safeParse(arguments_.get("--source-type"));
  const sourceLink = arguments_.get("--source-link")?.trim();
  const title = DocumentTitleSchema.safeParse(arguments_.get("--title"));
  if (
    !projectDirectory ||
    !sourceType.success ||
    !sourceLink ||
    !title.success ||
    arguments_.size !== 4
  ) {
    throw new Error(
      "Usage: assign-project-document-title --project-directory <path> --source-type <type> --source-link <url> --title <title>"
    );
  }

  return {
    projectDirectory,
    sourceType: sourceType.data,
    sourceLink,
    title: title.data
  };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to assign the document title.");
  process.exitCode = 1;
});
