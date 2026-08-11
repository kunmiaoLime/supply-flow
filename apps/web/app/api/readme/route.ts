import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const repositoryReadmePath = path.resolve(process.cwd(), "../..", "README.md");

export async function GET() {
  try {
    const markdown = await readFile(repositoryReadmePath, "utf8");
    return new NextResponse(markdown, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/markdown; charset=utf-8"
      }
    });
  } catch {
    return NextResponse.json({ error: "Unable to read the Supply Flow README." }, { status: 500 });
  }
}
