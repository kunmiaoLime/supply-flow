import { stat } from "node:fs/promises";
import path from "node:path";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";

interface Arguments {
  projectDirectory: string;
  repositoryLocal: string;
  branch: string;
  reviewResult: string;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const projectDirectory = path.resolve(arguments_.projectDirectory);
  const projectsDirectory = path.dirname(projectDirectory);
  if (path.basename(projectsDirectory) !== "projects") {
    throw new Error("The project directory must be located directly beneath a projects directory.");
  }

  const reviewsDirectory = path.join(projectDirectory, "reviews");
  const reviewPath = path.join(reviewsDirectory, arguments_.reviewResult);
  if (path.dirname(reviewPath) !== reviewsDirectory) {
    throw new Error("The review result must be a Markdown file directly beneath the reviews directory.");
  }

  const metadata = await stat(reviewPath);
  if (!metadata.isFile()) {
    throw new Error("The review result file does not exist.");
  }

  const store = new FileBranchStore(projectDirectory);
  const branch = (await store.list()).find(
    (candidate) =>
      candidate.name === arguments_.branch &&
      candidate.repository_local === arguments_.repositoryLocal
  );
  if (!branch) {
    throw new Error("The tracked branch no longer exists.");
  }

  await store.update(branch, {
    ...branch,
    review_result: arguments_.reviewResult
  });
  console.log(`Saved review result ${arguments_.reviewResult} for ${branch.name}.`);
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: set-project-branch-review-result --project-directory <path> --repository-local <path> --branch <name> --review-result <file.md>"
      );
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  const reviewResult = arguments_.get("--review-result")?.trim();
  if (
    !projectDirectory ||
    !repositoryLocal ||
    !branch ||
    !reviewResult ||
    !isReviewFilename(reviewResult) ||
    arguments_.size !== 4
  ) {
    throw new Error(
      "Usage: set-project-branch-review-result --project-directory <path> --repository-local <path> --branch <name> --review-result <file.md>"
    );
  }

  return { projectDirectory, repositoryLocal, branch, reviewResult };
}

function isReviewFilename(value: string): boolean {
  return (
    path.basename(value) === value &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,250}\.md$/.test(value)
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to save the branch review result.");
  process.exitCode = 1;
});
