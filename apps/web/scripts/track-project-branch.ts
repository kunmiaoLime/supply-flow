import { FileBranchStore } from "@supply-flow/core/file-branch-store";

interface Arguments {
  projectDirectory: string;
  repositoryLocal: string;
  branch: string;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const result = await new FileBranchStore(arguments_.projectDirectory).ensure({
    name: arguments_.branch,
    repository_local: arguments_.repositoryLocal
  });

  console.log(
    result.created
      ? `Tracked branch ${result.branch.name}.`
      : `Branch ${result.branch.name} is already tracked.`
  );
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name>"
      );
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  if (!projectDirectory || !repositoryLocal || !branch || arguments_.size !== 3) {
    throw new Error(
      "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name>"
    );
  }

  return { projectDirectory, repositoryLocal, branch };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to track project branch.");
  process.exitCode = 1;
});
