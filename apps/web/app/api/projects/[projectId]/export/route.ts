import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;
  const project = await new FileProjectStore(dataDirectory).get(projectId);
  if (!project) {
    return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
  }

  const projectsDirectory = path.join(dataDirectory, "projects");
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-export-"));
  const archiveName = `supply-flow-${project.project_id}.zip`;
  const archivePath = path.join(temporaryDirectory, archiveName);

  try {
    // Preserve the selected project as the archive's top-level directory.
    await execFile("zip", ["-r", "-q", "-y", archivePath, project.project_id], {
      cwd: projectsDirectory,
      maxBuffer: 1_024 * 1_024
    });
    const archive = await readFile(archivePath);

    return new Response(archive, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${archiveName}"`,
        "Content-Length": String(archive.byteLength),
        "Content-Type": "application/zip"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to export the selected project."
      },
      { status: 500 }
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
