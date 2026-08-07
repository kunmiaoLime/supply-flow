import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ImportConflictIndexSchema,
  type ImportConflict
} from "@supply-flow/core/import-conflict";

export const IMPORT_CONFLICTS_FILE = "import_conflicts.json";

export class ImportConflictStoreError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export class FileImportConflictStore {
  public constructor(private readonly rootDirectory: string) {}

  public async get(): Promise<ImportConflict[] | null> {
    try {
      const content = await readFile(this.filePath(), "utf8");
      return ImportConflictIndexSchema.parse(JSON.parse(content)).conflicts;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new ImportConflictStoreError(
        `${IMPORT_CONFLICTS_FILE} must be valid import-conflict JSON.`
      );
    }
  }

  private filePath(): string {
    return path.join(this.rootDirectory, IMPORT_CONFLICTS_FILE);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
