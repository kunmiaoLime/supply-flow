import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

    return this.get(repository);
  }

  public async list(): Promise<PullRequestTemplate[]> {
    const mapping = await this.readMapping();
    if (!mapping) {
      return [];
    }

    const templates = await Promise.all(
      Object.entries(mapping).map(([repository, configuredTemplatePath]) =>
        this.readMappedTemplate(repository, configuredTemplatePath)
      )
    );

    return templates.sort((first, second) => first.repository.localeCompare(second.repository));
  }

  public async get(repository: string): Promise<PullRequestTemplate | null> {
    const normalizedRepository = normalizeRepositoryName(repository);
    const mapping = await this.readMapping();
    if (!mapping) {
      return null;
    }

    const configuredTemplatePath = mapping[normalizedRepository];
    if (!configuredTemplatePath) {
      return null;
    }

    return this.readMappedTemplate(normalizedRepository, configuredTemplatePath);
  }

  public async create(repository: string, content: string): Promise<PullRequestTemplate> {
    const normalizedRepository = normalizeRepositoryName(repository);
    const templateContent = normalizeTemplateContent(content);
    const mapping = (await this.readMapping()) ?? {};
    if (mapping[normalizedRepository]) {
      throw new PullRequestTemplateError(
        `A PR template is already configured for ${normalizedRepository}. Edit the existing template instead.`,
        409
      );
    }

    const configuredTemplatePath = defaultTemplatePath(normalizedRepository);
    const templatePath = this.resolveTemplatePath(configuredTemplatePath);
    await mkdir(this.templatesDirectory(), { recursive: true });
    await writeFileAtomically(templatePath, templateContent);
    await this.writeMapping({
      ...mapping,
      [normalizedRepository]: configuredTemplatePath
    });
    return {
      content: templateContent,
      path: templatePath,
      repository: normalizedRepository
    };
  }

  public async update(repository: string, content: string): Promise<PullRequestTemplate> {
    const normalizedRepository = normalizeRepositoryName(repository);
    const templateContent = normalizeTemplateContent(content);
    const mapping = await this.readMapping();
    const configuredTemplatePath = mapping?.[normalizedRepository];
    if (!configuredTemplatePath) {
      throw new PullRequestTemplateError(
        `No PR template is configured for ${normalizedRepository}. Import a pull request first.`,
        404
      );
    }

    const templatePath = this.resolveTemplatePath(configuredTemplatePath);
    await mkdir(path.dirname(templatePath), { recursive: true });
    await writeFileAtomically(templatePath, templateContent);
    return {
      content: templateContent,
      path: templatePath,
      repository: normalizedRepository
    };
  }

  private async readMappedTemplate(
    repository: string,
    configuredTemplatePath: string
  ): Promise<PullRequestTemplate> {
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
        normalizeRepositoryName(repository),
        templatePath.trim()
      ])
    );
  }

  private async writeMapping(mapping: Record<string, string>): Promise<void> {
    await mkdir(this.templatesDirectory(), { recursive: true });
    const sortedMapping = Object.fromEntries(
      Object.entries(mapping).sort(([firstRepository], [secondRepository]) =>
        firstRepository.localeCompare(secondRepository)
      )
    );
    await writeFileAtomically(
      path.join(this.templatesDirectory(), TEMPLATE_MAPPING_FILE),
      `${JSON.stringify(sortedMapping, null, 2)}\n`
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

function normalizeRepositoryName(value: string): string {
  const repository = value.trim().toLowerCase();
  if (!isRepositoryName(repository)) {
    throw new PullRequestTemplateError(
      "A PR template repository must use the GitHub owner/repository format.",
      400
    );
  }

  return repository;
}

function normalizeTemplateContent(value: string): string {
  if (!value.trim()) {
    throw new PullRequestTemplateError("A PR template cannot be empty.", 400);
  }

  return value;
}

function defaultTemplatePath(repository: string): string {
  return `${repository.replace("/", "-")}-pr-template.md`;
}

async function writeFileAtomically(targetPath: string, content: string): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, targetPath);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
