import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const TEMPLATE_DIRECTORY = path.join("templates", "RFC");
const TEMPLATE_FILE = "rfc_template.md";
export const MAX_RFC_TEMPLATE_LENGTH = 100_000;

export interface RfcTemplate {
  content: string;
  path: string;
}

export class RfcTemplateError extends Error {
  public constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message);
  }
}

export class FileRfcTemplateStore {
  public constructor(
    private readonly dataDirectory: string,
    private readonly defaultTemplatePath: string
  ) {}

  public async get(): Promise<RfcTemplate> {
    const localTemplatePath = this.localTemplatePath();
    try {
      return { content: await readTemplate(localTemplatePath), path: localTemplatePath };
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw new RfcTemplateError("Unable to read the local RFC template.");
      }
    }

    try {
      return {
        content: await readTemplate(this.defaultTemplatePath),
        path: this.defaultTemplatePath
      };
    } catch {
      throw new RfcTemplateError("The default RFC template is unavailable.");
    }
  }

  public async update(content: string): Promise<RfcTemplate> {
    const template = normalizeTemplateContent(content);
    const templatePath = this.localTemplatePath();
    await mkdir(path.dirname(templatePath), { recursive: true });
    await writeFileAtomically(templatePath, template);
    return { content: template, path: templatePath };
  }

  private localTemplatePath(): string {
    return path.join(this.dataDirectory, TEMPLATE_DIRECTORY, TEMPLATE_FILE);
  }
}

async function readTemplate(templatePath: string): Promise<string> {
  const content = await readFile(templatePath, "utf8");
  return normalizeTemplateContent(content);
}

function normalizeTemplateContent(value: string): string {
  if (!value.trim()) {
    throw new RfcTemplateError("An RFC template cannot be empty.", 400);
  }
  if (value.length > MAX_RFC_TEMPLATE_LENGTH) {
    throw new RfcTemplateError(
      `An RFC template cannot exceed ${MAX_RFC_TEMPLATE_LENGTH.toLocaleString()} characters.`,
      400
    );
  }

  return value;
}

async function writeFileAtomically(targetPath: string, content: string): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, targetPath);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
