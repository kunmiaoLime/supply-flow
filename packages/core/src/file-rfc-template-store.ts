import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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
  public constructor(private readonly templatePath: string) {}

  public async get(): Promise<RfcTemplate> {
    try {
      return {
        content: await readTemplate(this.templatePath),
        path: this.templatePath
      };
    } catch {
      throw new RfcTemplateError("The repository RFC template is unavailable.");
    }
  }

  public async update(content: string): Promise<RfcTemplate> {
    const template = normalizeTemplateContent(content);
    await mkdir(path.dirname(this.templatePath), { recursive: true });
    await writeFileAtomically(this.templatePath, template);
    return { content: template, path: this.templatePath };
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
