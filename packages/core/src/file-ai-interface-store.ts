import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AiInterfaceIdSchema,
  AiInterfaceStatusIndexSchema,
  AiInterfaceStatusSchema,
  createDefaultAiInterfaceStatus,
  type AiInterfaceId,
  type AiInterfaceStatus,
  type AiInterfaceStatusIndex
} from "@supply-flow/core/ai-interface";

const SETTINGS_DIRECTORY = "settings";
export const AI_INTERFACES_FILE = "ai_interfaces.json";

export class AiInterfaceStoreError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export class FileAiInterfaceStore {
  public constructor(private readonly dataDirectory: string) {}

  public async get(): Promise<AiInterfaceStatusIndex> {
    const content = await this.readStatusFile();
    if (content === null) {
      return createDefaultAiInterfaceStatus();
    }

    try {
      return AiInterfaceStatusIndexSchema.parse(JSON.parse(content));
    } catch {
      throw new AiInterfaceStoreError("AI interface status is invalid.");
    }
  }

  public async initialize(): Promise<AiInterfaceStatusIndex> {
    const current = await this.get();
    const content = await this.readStatusFile();
    if (content === null) {
      await this.update(current);
    }
    return current;
  }

  public async update(status: AiInterfaceStatusIndex): Promise<AiInterfaceStatusIndex> {
    const parsedStatus = AiInterfaceStatusIndexSchema.parse(status);
    await mkdir(this.settingsDirectory(), { recursive: true });
    await writeJsonAtomically(this.statusPath(), parsedStatus);
    return parsedStatus;
  }

  public async updateInterface(
    interfaceId: AiInterfaceId,
    status: AiInterfaceStatus,
    detail: string | null
  ): Promise<AiInterfaceStatusIndex> {
    const parsedInterface = AiInterfaceIdSchema.parse(interfaceId);
    const parsedStatus = AiInterfaceStatusSchema.parse(status);
    const current = await this.get();
    const normalizedDetail = detail?.trim() || null;
    const updated = {
      ...current,
      interfaces: {
        ...current.interfaces,
        [parsedInterface]: {
          status: parsedStatus,
          checkedAt: new Date().toISOString(),
          detail: normalizedDetail
        }
      }
    };

    return this.update(updated);
  }

  private settingsDirectory(): string {
    return path.join(this.dataDirectory, SETTINGS_DIRECTORY);
  }

  private statusPath(): string {
    return path.join(this.settingsDirectory(), AI_INTERFACES_FILE);
  }

  private async readStatusFile(): Promise<string | null> {
    try {
      return await readFile(this.statusPath(), "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new AiInterfaceStoreError("Unable to read AI interface status.");
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
