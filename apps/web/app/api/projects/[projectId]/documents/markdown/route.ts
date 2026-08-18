import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  DocumentTitleSchema,
  isProjectLocalDocumentType,
  ProjectLocalDocumentPathSchema,
  ProjectMarkdownPathSchema,
  type DocumentSource,
  type ProjectRecord
} from "@supply-flow/core/project";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MARKDOWN_BYTES = 5 * 1_024 * 1_024;
const MARKDOWN_DIRECTORY = "markdowns";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface MarkdownUpload {
  filename: string;
  content: Buffer;
  title: string | null;
  documentIndex: number | null;
}

class MarkdownDocumentError extends Error {
  public constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export async function GET(request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;
  const relativePath = new URL(request.url).searchParams.get("path");
  const parsedPath = ProjectLocalDocumentPathSchema.safeParse(relativePath);
  if (!parsedPath.success) {
    return NextResponse.json({ error: "Choose a valid project-local document." }, { status: 400 });
  }

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }
    if (
      !project.documents.some(
        (document) =>
          isProjectLocalDocumentType(document.type) && document.link === parsedPath.data
      )
    ) {
      return NextResponse.json({ error: "Unknown project-local document." }, { status: 404 });
    }

    const content = await readFile(localDocumentFilePath(project.project_id, parsedPath.data), "utf8");
    return new Response(content, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return NextResponse.json({ error: "The local document file is unavailable." }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read the local document." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;
  const store = new FileProjectStore(dataDirectory);
  let createdMarkdownPath: string | null = null;

  try {
    const upload = await parseMarkdownUpload(request);
    const project = await store.get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }
    if (
      upload.documentIndex !== null &&
      !project.documents[upload.documentIndex]
    ) {
      throw new MarkdownDocumentError("The document is no longer associated with the project.", 409);
    }

    const markdownDirectory = path.join(projectDirectory(project.project_id), MARKDOWN_DIRECTORY);
    const filename = await writeMarkdownFile(markdownDirectory, upload.filename, upload.content);
    const document: DocumentSource = {
      type: "markdown",
      link: `${MARKDOWN_DIRECTORY}/${filename}`,
      title: upload.title
    };
    createdMarkdownPath = document.link;

    const previousDocument =
      upload.documentIndex === null ? null : project.documents[upload.documentIndex] ?? null;
    const documents =
      upload.documentIndex === null
        ? [...project.documents, document]
        : project.documents.map((currentDocument, index) =>
            index === upload.documentIndex ? document : currentDocument
          );
    const updatedProject = await store.update(project.project_id, { documents });
    await removeUntrackedMarkdownFile(project, updatedProject, previousDocument?.link ?? null);

    return NextResponse.json({ project: updatedProject }, { status: 201 });
  } catch (error) {
    if (createdMarkdownPath) {
      try {
        await rm(markdownFilePath(projectId, createdMarkdownPath), { force: true });
      } catch {
        // Preserve the original upload error if cleanup cannot complete.
      }
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to upload the Markdown document."
      },
      { status: markdownErrorStatus(error) }
    );
  }
}

async function parseMarkdownUpload(request: Request): Promise<MarkdownUpload> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new MarkdownDocumentError("Choose a Markdown file to upload.");
  }

  const titleValue = form.get("title");
  if (titleValue !== null && typeof titleValue !== "string") {
    throw new MarkdownDocumentError("Enter a valid document title.");
  }
  const titleText = titleValue?.trim() ?? "";
  const title = titleText ? DocumentTitleSchema.safeParse(titleText) : null;
  if (title !== null && !title.success) {
    throw new MarkdownDocumentError("Enter a title of 240 characters or fewer.");
  }

  return {
    ...(await readMarkdownSource(form.get("file"), form.get("path"))),
    title: title === null ? null : title.data,
    documentIndex: parseDocumentIndex(form.get("documentIndex"))
  };
}

function parseDocumentIndex(value: FormDataEntryValue | null): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new MarkdownDocumentError("The document being replaced is invalid.");
  }

  const index = Number(value);
  if (!Number.isSafeInteger(index)) {
    throw new MarkdownDocumentError("The document being replaced is invalid.");
  }

  return index;
}

async function readMarkdownSource(
  fileValue: FormDataEntryValue | null,
  pathValue: FormDataEntryValue | null
): Promise<Pick<MarkdownUpload, "filename" | "content">> {
  if (fileValue instanceof File && fileValue.name) {
    validateMarkdownFilename(fileValue.name);
    if (fileValue.size === 0) {
      throw new MarkdownDocumentError("The Markdown file is empty.");
    }
    if (fileValue.size > MAX_MARKDOWN_BYTES) {
      throw new MarkdownDocumentError("Markdown files must be 5 MB or smaller.");
    }

    return {
      filename: fileValue.name,
      content: validateMarkdownContent(Buffer.from(await fileValue.arrayBuffer()))
    };
  }

  if (typeof pathValue === "string" && pathValue.trim()) {
    return readMarkdownFileAtPath(pathValue);
  }

  throw new MarkdownDocumentError("Choose a local Markdown file or enter its path.");
}

async function readMarkdownFileAtPath(
  sourcePathText: string
): Promise<Pick<MarkdownUpload, "filename" | "content">> {
  const sourcePath = resolveLocalPath(sourcePathText);
  const filename = path.basename(sourcePath);
  validateMarkdownFilename(filename);

  let fileInfo: Awaited<ReturnType<typeof stat>>;
  try {
    fileInfo = await stat(sourcePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new MarkdownDocumentError("The Markdown file path does not exist.");
    }

    throw error;
  }

  if (!fileInfo.isFile()) {
    throw new MarkdownDocumentError("The Markdown file path must refer to a file.");
  }
  if (fileInfo.size === 0) {
    throw new MarkdownDocumentError("The Markdown file is empty.");
  }
  if (fileInfo.size > MAX_MARKDOWN_BYTES) {
    throw new MarkdownDocumentError("Markdown files must be 5 MB or smaller.");
  }

  return {
    filename,
    content: validateMarkdownContent(await readFile(sourcePath))
  };
}

function resolveLocalPath(value: string): string {
  const trimmedValue = value.trim();
  const expandedValue =
    trimmedValue === "~"
      ? homedir()
      : trimmedValue.startsWith("~/")
        ? path.join(homedir(), trimmedValue.slice(2))
        : trimmedValue;
  return path.resolve(expandedValue);
}

function validateMarkdownFilename(filename: string): void {
  if (!filename.toLowerCase().endsWith(".md")) {
    throw new MarkdownDocumentError("Only files with a .md extension can be uploaded.");
  }
}

function validateMarkdownContent(content: Buffer): Buffer {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    if (text.includes("\0")) {
      throw new Error("Markdown contains a null byte.");
    }
  } catch {
    throw new MarkdownDocumentError("Markdown files must be valid UTF-8 text.");
  }

  return content;
}

async function writeMarkdownFile(
  markdownDirectory: string,
  originalName: string,
  content: Buffer
): Promise<string> {
  await mkdir(markdownDirectory, { recursive: true });

  const filename = normalizeMarkdownFilename(originalName);
  const extensionIndex = filename.length - ".md".length;
  const basename = filename.slice(0, extensionIndex);
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const candidate = suffix === 1 ? filename : `${basename}-${suffix}.md`;
    try {
      await writeFile(path.join(markdownDirectory, candidate), content, { flag: "wx" });
      return candidate;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new MarkdownDocumentError("Unable to choose a filename for the Markdown document.", 409);
}

function normalizeMarkdownFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? "";
  const stem = basename
    .replace(/\.md$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");

  return `${stem || "document"}.md`;
}

async function removeUntrackedMarkdownFile(
  previousProject: ProjectRecord,
  updatedProject: ProjectRecord,
  previousLink: string | null
): Promise<void> {
  if (
    !previousLink ||
    !previousProject.documents.some(
      (document) => document.type === "markdown" && document.link === previousLink
    ) ||
    updatedProject.documents.some(
      (document) => document.type === "markdown" && document.link === previousLink
    )
  ) {
    return;
  }

  try {
    await rm(markdownFilePath(updatedProject.project_id, previousLink), { force: true });
  } catch {
    // The metadata update succeeds even when a stale local upload cannot be removed.
  }
}

function markdownFilePath(projectId: string, relativePath: string): string {
  const parsedPath = ProjectMarkdownPathSchema.parse(relativePath);
  return path.join(projectDirectory(projectId), ...parsedPath.split("/"));
}

function localDocumentFilePath(projectId: string, relativePath: string): string {
  const parsedPath = ProjectLocalDocumentPathSchema.parse(relativePath);
  return path.join(projectDirectory(projectId), ...parsedPath.split("/"));
}

function markdownErrorStatus(error: unknown): number {
  return error instanceof MarkdownDocumentError ? error.status : 500;
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
