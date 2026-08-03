import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { createProjectId } from "@supply-flow/core/project";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");

export async function GET() {
  const projects = await new FileProjectStore(dataDirectory).list();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const name = await parseProjectName(request);

  if (!name) {
    return NextResponse.json(
      { error: "Enter a project name of 120 characters or fewer." },
      { status: 400 }
    );
  }

  const store = new FileProjectStore(dataDirectory);
  const project = await store.create({
    project_name: name,
    project_id: createProjectId(
      name,
      (await store.list()).map((project) => project.project_id)
    )
  });

  return NextResponse.json({ project }, { status: 201 });
}

async function parseProjectName(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("name" in body) ||
      typeof body.name !== "string"
    ) {
      return null;
    }

    const name = body.name.trim();
    return name.length > 0 && name.length <= 120 ? name : null;
  } catch {
    return null;
  }
}
