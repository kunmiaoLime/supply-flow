import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ContextConflictIndexSchema,
  ContextGapIndexSchema,
  type ContextAnalysis,
  type ContextConflict,
  type ContextGap
} from "@supply-flow/core/context-analysis";

export const CONTEXT_GAPS_FILE = "context_gap.json";
export const CONTEXT_CONFLICTS_FILE = "context_conflicts.json";

export class ContextAnalysisError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ContextAnalysisError";
  }
}

export class FileContextAnalysisStore {
  public constructor(private readonly rootDirectory: string) {}

  public async get(): Promise<ContextAnalysis | null> {
    const [gaps, conflicts] = await Promise.all([this.readGaps(), this.readConflicts()]);

    if (gaps === null && conflicts === null) {
      return null;
    }
    if (gaps === null || conflicts === null) {
      throw new ContextAnalysisError(
        `Project context analysis must include both ${CONTEXT_GAPS_FILE} and ${CONTEXT_CONFLICTS_FILE}.`
      );
    }

    return { gaps, conflicts };
  }

  private async readGaps(): Promise<ContextGap[] | null> {
    try {
      const content = await readFile(this.filePath(CONTEXT_GAPS_FILE), "utf8");
      return ContextGapIndexSchema.parse(JSON.parse(content)).gaps;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new ContextAnalysisError(
        `${CONTEXT_GAPS_FILE} must be valid context-analysis JSON.`
      );
    }
  }

  private async readConflicts(): Promise<ContextConflict[] | null> {
    try {
      const content = await readFile(this.filePath(CONTEXT_CONFLICTS_FILE), "utf8");
      return ContextConflictIndexSchema.parse(JSON.parse(content)).conflicts;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new ContextAnalysisError(
        `${CONTEXT_CONFLICTS_FILE} must be valid context-analysis JSON.`
      );
    }
  }

  private filePath(fileName: string): string {
    return path.join(this.rootDirectory, fileName);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
