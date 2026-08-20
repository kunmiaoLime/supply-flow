import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DIRECTORY_ENTRIES = 1_000;

interface ArchiveBrowserEntry {
  name: string;
  path: string;
  type: "directory" | "archive";
}

export async function GET(request: Request) {
  try {
    const requestedPath = new URL(request.url).searchParams.get("path");
    const directory = await resolveDirectory(requestedPath);
    const entries = await listArchiveBrowserEntries(directory);

    return NextResponse.json({
      path: directory,
      parentPath: parentDirectory(directory),
      entries
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to list local project archives."
      },
      { status: 400 }
    );
  }
}

async function resolveDirectory(requestedPath: string | null): Promise<string> {
  const candidate = requestedPath?.trim()
    ? path.resolve(expandHomeDirectory(requestedPath))
    : path.join(homedir(), "Downloads");

  let directoryInfo: Awaited<ReturnType<typeof stat>>;
  try {
    directoryInfo = await stat(candidate);
  } catch {
    if (!requestedPath?.trim()) {
      return homedir();
    }
    throw new Error("The selected folder is unavailable.");
  }

  if (!directoryInfo.isDirectory()) {
    throw new Error("Choose a local folder.");
  }

  return candidate;
}

async function listArchiveBrowserEntries(directory: string): Promise<ArchiveBrowserEntry[]> {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const entries = directoryEntries
    .filter((entry) => entry.isDirectory() || (entry.isFile() && isZipArchive(entry.name)))
    .map((entry) => ({
      name: entry.name,
      path: path.join(directory, entry.name),
      type: entry.isDirectory() ? ("directory" as const) : ("archive" as const)
    }))
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });

  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new Error("This folder has too many items. Choose a more specific folder.");
  }

  return entries;
}

function expandHomeDirectory(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function parentDirectory(directory: string): string | null {
  const parent = path.dirname(directory);
  return parent === directory ? null : parent;
}

function isZipArchive(filename: string): boolean {
  return filename.toLowerCase().endsWith(".zip");
}
