import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { createProjectId, type ProjectRecord } from "@supply-flow/core/project";
import { NextResponse } from "next/server";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  projectRoot,
  ProjectSessionError
} from "../[projectId]/sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFile = promisify(execFileCallback);
const MAX_ARCHIVE_BYTES = 512 * 1_024 * 1_024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_LIST_BYTES = 8 * 1_024 * 1_024;
const MAX_PROJECT_METADATA_BYTES = 1_024 * 1_024;
const IMPORT_PROMPT_PATH = path.join(projectRoot, "prompts", "import_project.md");
const importModes = ["separate", "replace", "merge"] as const;

type ImportMode = (typeof importModes)[number];

interface ImportInput {
  archive: File;
  mode: ImportMode | null;
  targetProjectId: string | null;
}

class ProjectImportError extends Error {
  public constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export async function POST(request: Request) {
  let importDirectory: string | null = null;
  let createdProject: ProjectRecord | null = null;
  let retainImportDirectory = false;
  const projectStore = new FileProjectStore(dataDirectory);

  try {
    const input = await parseImportInput(request);
    const importsDirectory = path.join(dataDirectory, "imports");
    await mkdir(importsDirectory, { recursive: true });
    importDirectory = await mkdtemp(path.join(importsDirectory, "import-"));

    const archivePath = path.join(importDirectory, "project.zip");
    await writeFile(archivePath, Buffer.from(await input.archive.arrayBuffer()));
    const importedMetadata = await inspectArchive(archivePath, input.archive.name);

    const projectName = importedMetadata.projectName;
    const projects = await projectStore.list();
    const matchingProjects = projects.filter((project) => hasSameProjectName(project, projectName));
    if (matchingProjects.length > 0 && input.mode === null) {
      return NextResponse.json({
        requiresDecision: true,
        importedProjectName: projectName,
        existingProjects: matchingProjects.map((project) => ({
          project_id: project.project_id,
          project_name: project.project_name
        }))
      });
    }

    const importMode = input.mode ?? "separate";
    let targetProject: ProjectRecord;
    if (importMode === "separate") {
      const newProject = await projectStore.create({
        project_name: projectName,
        project_id: createProjectId(
          projectName,
          projects.map((project) => project.project_id)
        ),
        repos: [],
        documents: [],
        tasks: []
      });
      createdProject = newProject;
      targetProject = newProject;
    } else {
      const existingProject = findTargetProject(matchingProjects, input.targetProjectId);
      if (!existingProject) {
        throw new ProjectImportError(
          "The matching project is no longer available. Start the import again.",
          409
        );
      }
      targetProject = existingProject;
    }

    const session = await createProjectSession(targetProject, {
      action: "import-project",
      title: `Import: ${projectName}`.slice(0, 120),
      goal: await buildImportGoal({
        archivePath,
        importDirectory,
        importMode,
        project: targetProject,
        sourceRootDirectory: importedMetadata.rootDirectory
      }),
      workspacePath: projectDirectory(targetProject.project_id),
      additionalWritableDirectories: [importDirectory],
      loadProjectContext: false
    });
    retainImportDirectory = true;

    return NextResponse.json({ project: targetProject, session }, { status: 201 });
  } catch (error) {
    if (createdProject) {
      try {
        await projectStore.remove(createdProject.project_id);
      } catch {
        // Preserve the original import error if cleanup cannot complete.
      }
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to start the project import."
      },
      { status: errorStatus(error) }
    );
  } finally {
    if (importDirectory && !retainImportDirectory) {
      try {
        await rm(importDirectory, { force: true, recursive: true });
      } catch {
        // Keep the import response intact when staging cleanup cannot complete.
      }
    }
  }
}

async function parseImportInput(request: Request): Promise<ImportInput> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ProjectImportError("Choose a project ZIP archive to import.");
  }

  const archive = form.get("archive");
  if (!(archive instanceof File) || !archive.name.toLowerCase().endsWith(".zip")) {
    throw new ProjectImportError("Choose a ZIP archive exported by Supply Flow.");
  }
  if (archive.size === 0) {
    throw new ProjectImportError("The selected ZIP archive is empty.");
  }
  if (archive.size > MAX_ARCHIVE_BYTES) {
    throw new ProjectImportError("Project archives must be 512 MB or smaller.");
  }

  const mode = parseImportMode(form.get("mode"));
  const targetProjectId = parseTargetProjectId(form.get("targetProjectId"));
  if (mode === null && form.get("mode") !== null) {
    throw new ProjectImportError("Choose a supported project import mode.");
  }

  return { archive, mode, targetProjectId };
}

async function inspectArchive(
  archivePath: string,
  archiveName: string
): Promise<{ projectName: string; rootDirectory: string }> {
  let listOutput: string;
  try {
    ({ stdout: listOutput } = await execFile("unzip", ["-Z1", archivePath], {
      maxBuffer: MAX_ARCHIVE_LIST_BYTES
    }));
  } catch {
    throw new ProjectImportError("The selected file is not a readable ZIP archive.");
  }

  const entries = listOutput.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) {
    throw new ProjectImportError("The ZIP archive does not contain project files.");
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ProjectImportError("The ZIP archive contains too many files to import.");
  }

  for (const entry of entries) {
    assertSafeArchiveEntry(entry);
  }

  const rootDirectories = new Set(
    entries.map((entry) => entry.split("/", 1)[0]).filter(Boolean)
  );
  if (rootDirectories.size !== 1) {
    throw new ProjectImportError(
      "The ZIP archive must contain one top-level project directory."
    );
  }

  const rootDirectory = Array.from(rootDirectories)[0];
  if (!rootDirectory) {
    throw new ProjectImportError(
      "The ZIP archive must contain one top-level project directory."
    );
  }
  const metadataEntry = `${rootDirectory}/project.json`;
  if (!entries.includes(metadataEntry)) {
    throw new ProjectImportError("The ZIP archive does not contain a project.json file.");
  }

  let projectMetadata = "";
  try {
    ({ stdout: projectMetadata } = await execFile(
      "unzip",
      ["-p", archivePath, metadataEntry],
      { maxBuffer: MAX_PROJECT_METADATA_BYTES }
    ));
  } catch {
    throw new ProjectImportError("Unable to read project.json from the ZIP archive.");
  }

  return {
    projectName: projectNameFromMetadata(projectMetadata, archiveName),
    rootDirectory
  };
}

function assertSafeArchiveEntry(entry: string): void {
  if (
    entry.includes("\0") ||
    entry.includes("\\") ||
    entry.startsWith("/") ||
    entry.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new ProjectImportError("The ZIP archive contains an unsafe file path.");
  }
}

function projectNameFromMetadata(projectMetadata: string, archiveName: string): string {
  try {
    const parsed: unknown = JSON.parse(projectMetadata);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "project_name" in parsed &&
      typeof parsed.project_name === "string"
    ) {
      const projectName = parsed.project_name.trim();
      if (projectName.length > 0 && projectName.length <= 120) {
        return projectName;
      }
    }
  } catch {
    // A newer or older project format may need the importer session to interpret it.
  }

  const fallback = archiveName.replace(/\.zip$/i, "").trim().slice(0, 120);
  return fallback || "Imported project";
}

function parseImportMode(value: FormDataEntryValue | null): ImportMode | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }

  return importModes.find((mode) => mode === value) ?? null;
}

function parseTargetProjectId(value: FormDataEntryValue | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ProjectImportError("Choose a target project for this import.");
  }

  const projectId = value.trim();
  if (!projectId || projectId.length > 120) {
    throw new ProjectImportError("Choose a target project for this import.");
  }

  return projectId;
}

function hasSameProjectName(project: ProjectRecord, importedProjectName: string): boolean {
  return (
    project.project_name.trim().localeCompare(importedProjectName.trim(), undefined, {
      sensitivity: "accent"
    }) === 0
  );
}

function findTargetProject(
  matchingProjects: readonly ProjectRecord[],
  targetProjectId: string | null
): ProjectRecord | null {
  if (matchingProjects.length === 0) {
    return null;
  }
  if (!targetProjectId && matchingProjects.length === 1) {
    return matchingProjects[0] ?? null;
  }

  return matchingProjects.find((project) => project.project_id === targetProjectId) ?? null;
}

async function buildImportGoal({
  archivePath,
  importDirectory,
  importMode,
  project,
  sourceRootDirectory
}: {
  archivePath: string;
  importDirectory: string;
  importMode: ImportMode;
  project: ProjectRecord;
  sourceRootDirectory: string;
}): Promise<string> {
  const template = await readFile(IMPORT_PROMPT_PATH, "utf8");
  return template
    .replaceAll("<SUPPLY_FLOW_ROOT>", JSON.stringify(projectRoot))
    .replaceAll("<IMPORT_ARCHIVE_PATH>", JSON.stringify(archivePath))
    .replaceAll("<IMPORT_DIRECTORY>", JSON.stringify(importDirectory))
    .replaceAll("<SOURCE_ROOT_DIRECTORY>", JSON.stringify(sourceRootDirectory))
    .replaceAll("<IMPORT_MODE>", importMode)
    .replaceAll("<PROJECT_DIRECTORY>", JSON.stringify(projectDirectory(project.project_id)))
    .replaceAll("<PROJECT_ID>", JSON.stringify(project.project_id))
    .replaceAll("<PROJECT_NAME>", JSON.stringify(project.project_name));
}

function errorStatus(error: unknown): number {
  if (error instanceof ProjectImportError || error instanceof ProjectSessionError) {
    return error.status;
  }

  return 500;
}
