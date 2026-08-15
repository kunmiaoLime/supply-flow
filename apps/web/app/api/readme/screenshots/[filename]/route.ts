import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const screenshotsDirectory = path.resolve(process.cwd(), "../..", "docs", "screenshots");
const screenshotFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ filename: string }> }
) {
  const { filename } = await context.params;
  if (!screenshotFilenamePattern.test(filename)) {
    return NextResponse.json({ error: "Screenshot not found." }, { status: 404 });
  }

  try {
    const image = await readFile(path.join(screenshotsDirectory, filename));
    return new NextResponse(image, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Screenshot not found." }, { status: 404 });
  }
}
