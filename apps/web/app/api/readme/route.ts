import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const repositoryReadmePath = path.resolve(process.cwd(), "../..", "README.md");

export async function GET() {
  try {
    const markdown = await readFile(repositoryReadmePath, "utf8");
    return new NextResponse(markdownForWebApp(markdown), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/markdown; charset=utf-8"
      }
    });
  } catch {
    return NextResponse.json({ error: "Unable to read the Supply Flow README." }, { status: 500 });
  }
}

function markdownForWebApp(markdown: string): string {
  return markdown.replace(
    /(!\[[^\]]*]\()docs\/screenshots\/([A-Za-z0-9][A-Za-z0-9._-]*\.png)(\))/g,
    "$1/api/readme/screenshots/$2$3"
  );
}
