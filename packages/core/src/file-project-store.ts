import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { BranchIndexSchema } from "@supply-flow/core/branch";
import { PullRequestIndexSchema } from "@supply-flow/core/pull-request";
import {
  ProjectRecordSchema,
  type ProjectRecord,
  type ProjectStore,
  type ProjectUpdate
} from "@supply-flow/core/project";
import { SessionIndexSchema } from "@supply-flow/core/session";

const PROJECT_METADATA_FILE = "project.json";
const SESSIONS_INDEX_FILE = "sessions.json";
const BRANCHES_INDEX_FILE = "branches.json";
const PULL_REQUESTS_INDEX_FILE = "prs.json";

export class FileProjectStore implements ProjectStore {
  public constructor(private readonly rootDirectory: string) {}

  public async create(record: ProjectRecord): Promise<ProjectRecord> {
    const parsedRecord = ProjectRecordSchema.parse(record);
    if (await this.get(parsedRecord.project_id)) {
      throw new Error(`A project with id "${parsedRecord.project_id}" already exists.`);
    }

    await mkdir(this.projectDirectory(parsedRecord.project_id), { recursive: true });
    await writeJsonAtomically(this.projectPath(parsedRecord.project_id), parsedRecord);
    await writeJsonAtomically(
      path.join(this.projectDirectory(parsedRecord.project_id), SESSIONS_INDEX_FILE),
      SessionIndexSchema.parse({ schemaVersion: 1, sessions: [] })
    );
    await writeJsonAtomically(
      path.join(this.projectDirectory(parsedRecord.project_id), BRANCHES_INDEX_FILE),
      BranchIndexSchema.parse({ schemaVersion: 1, branches: [] })
    );
    await writeJsonAtomically(
      path.join(this.projectDirectory(parsedRecord.project_id), PULL_REQUESTS_INDEX_FILE),
      PullRequestIndexSchema.parse({ schemaVersion: 1, prs: [] })
    );
    return parsedRecord;
  }

  public async get(id: string): Promise<ProjectRecord | null> {
    try {
      const projectPath = this.projectPath(id);
      const content = await readFile(projectPath, "utf8");
      const rawProject: unknown = JSON.parse(content);
      const project = ProjectRecordSchema.parse(rawProject);

      if (needsProjectMigration(rawProject)) {
        await writeJsonAtomically(projectPath, project);
      }

      return project;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  public async list(): Promise<ProjectRecord[]> {
    try {
      const entries = await readdir(this.projectsDirectory(), { withFileTypes: true });
      const projects = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.get(entry.name))
      );

      return projects
        .filter((project): project is ProjectRecord => project !== null)
        .sort((first, second) =>
          first.project_name.localeCompare(second.project_name) ||
          first.project_id.localeCompare(second.project_id)
        );
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  public async update(id: string, update: ProjectUpdate): Promise<ProjectRecord> {
    const current = await this.get(id);
    if (!current) {
      throw new Error(`Unknown project "${id}".`);
    }

    const updated = ProjectRecordSchema.parse({
      ...current,
      ...update
    });

    await writeJsonAtomically(this.projectPath(id), updated);
    return updated;
  }

  private projectsDirectory(): string {
    return path.join(this.rootDirectory, "projects");
  }

  private projectPath(id: string): string {
    return path.join(this.projectDirectory(id), PROJECT_METADATA_FILE);
  }

  private projectDirectory(id: string): string {
    assertPathSegment(id, "project id");
    return path.join(this.projectsDirectory(), id);
  }
}

async function writeJsonAtomically(targetPath: string, value: unknown): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

function assertPathSegment(value: string, label: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Invalid ${label}: "${value}".`);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function needsProjectMigration(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (("requirements" in value && !("documents" in value)) || !("tasks" in value))
  );
}
