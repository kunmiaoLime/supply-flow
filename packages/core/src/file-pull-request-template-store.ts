import { readFile } from "node:fs/promises";
import path from "node:path";
import { githubRepositoryFromRemote } from "@supply-flow/core/github-pull-request";

const TEMPLATE_DIRECTORY = path.join("templates", "PR");
const TEMPLATE_MAPPING_FILE = "pr-template-mapping.json";

export interface PullRequestTemplate {
  content: string;
  path: string;
  repository: string;
}

export class PullRequestTemplateError extends Error {
  public constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message);
    this.name = "PullRequestTemplateError";
  }
}

export class FilePullRequestTemplateStore {
  public constructor(private readonly dataDirectory: string) {}

  public async resolve(remote: string | null): Promise<PullRequestTemplate | null> {
    const repository = githubRepositoryFromRemote(remote);
    if (!repository) {
      return null;
    }

    const mapping = await this.readMapping();
    if (!mapping) {
      return null;
    }

    const configuredTemplatePath = mapping[repository];
    if (!configuredTemplatePath) {
      return null;
    }

    const templatePath = this.resolveTemplatePath(configuredTemplatePath);
    let content: string;
    try {
      content = await readFile(templatePath, "utf8");
    } catch {
      throw new PullRequestTemplateError(
        `Mapped PR template for ${repository} does not exist: ${templatePath}`
      );
    }

    if (!content.trim()) {
      throw new PullRequestTemplateError(
        `Mapped PR template for ${repository} is empty: ${templatePath}`
      );
    }

    return { content, path: templatePath, repository };
  }

  private async readMapping(): Promise<Record<string, string> | null> {
    let content: string;
    try {
      content = await readFile(path.join(this.templatesDirectory(), TEMPLATE_MAPPING_FILE), "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new PullRequestTemplateError("Unable to read the local PR template mapping.");
    }

    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new PullRequestTemplateError("The local PR template mapping is not valid JSON.");
    }

    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Object.entries(value).every(
        ([repository, templatePath]) =>
          isRepositoryName(repository) && typeof templatePath === "string" && templatePath.trim()
      )
    ) {
      throw new PullRequestTemplateError(
        "The local PR template mapping must map GitHub owner/repository names to template paths."
      );
    }

    return Object.fromEntries(
      Object.entries(value).map(([repository, templatePath]) => [
        repository.toLowerCase(),
        templatePath.trim()
      ])
    );
  }

  private resolveTemplatePath(configuredPath: string): string {
    if (path.isAbsolute(configuredPath)) {
      throw new PullRequestTemplateError(
        "Local PR template paths must be relative to .supply-flow/templates/PR."
      );
    }

    const templateDirectory = this.templatesDirectory();
    const templatePath = path.resolve(templateDirectory, configuredPath);
    const relativePath = path.relative(templateDirectory, templatePath);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new PullRequestTemplateError(
        "Local PR template paths must stay within .supply-flow/templates/PR."
      );
    }

    return templatePath;
  }

  private templatesDirectory(): string {
    return path.join(this.dataDirectory, TEMPLATE_DIRECTORY);
  }
}

function isRepositoryName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
