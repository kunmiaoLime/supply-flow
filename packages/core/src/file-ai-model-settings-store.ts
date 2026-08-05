import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AiModelSettingsSchema,
  createDefaultAiModelSettings,
  type AiModelSettings
} from "@supply-flow/core/ai-model-settings";

const SETTINGS_DIRECTORY = "settings";
const AI_MODEL_SETTINGS_FILE = "ai_model.json";
const LEGACY_AI_MODEL_SETTINGS_FILE = "ai-models.json";

export class AiModelSettingsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AiModelSettingsError";
  }
}

export class FileAiModelSettingsStore {
  public constructor(private readonly dataDirectory: string) {}

  public async get(): Promise<AiModelSettings> {
    const content =
      (await this.readSettingsFile(this.settingsPath())) ??
      (await this.readSettingsFile(this.legacySettingsPath()));
    if (content === null) {
      return createDefaultAiModelSettings();
    }

    try {
      return AiModelSettingsSchema.parse(JSON.parse(content));
    } catch {
      throw new AiModelSettingsError("AI model settings are invalid.");
    }
  }

  public async update(settings: AiModelSettings): Promise<AiModelSettings> {
    const parsedSettings = AiModelSettingsSchema.parse(settings);
    await mkdir(this.settingsDirectory(), { recursive: true });
    await writeJsonAtomically(this.settingsPath(), parsedSettings);
    await rm(this.legacySettingsPath(), { force: true });
    return parsedSettings;
  }

  private settingsDirectory(): string {
    return path.join(this.dataDirectory, SETTINGS_DIRECTORY);
  }

  private settingsPath(): string {
    return path.join(this.settingsDirectory(), AI_MODEL_SETTINGS_FILE);
  }

  private legacySettingsPath(): string {
    return path.join(this.settingsDirectory(), LEGACY_AI_MODEL_SETTINGS_FILE);
  }

  private async readSettingsFile(settingsPath: string): Promise<string | null> {
    try {
      return await readFile(settingsPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new AiModelSettingsError("Unable to read AI model settings.");
    }
  }
}

async function writeJsonAtomically(targetPath: string, value: unknown): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
