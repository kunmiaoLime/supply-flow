import path from "node:path";
import {
  FileRfcTemplateStore,
  MAX_RFC_TEMPLATE_LENGTH,
  RfcTemplateError
} from "@supply-flow/core/file-rfc-template-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const templatePath = path.join(projectRoot, "templates", "rfc_template.md");

export async function GET() {
  try {
    const template = await rfcTemplateStore().get();
    return NextResponse.json({ template });
  } catch (error) {
    return rfcTemplateErrorResponse(error, "Unable to load the RFC template.");
  }
}

export async function PATCH(request: Request) {
  const content = await parseTemplateContent(request);
  if (content === null) {
    return NextResponse.json(
      {
        error: `Enter a non-empty RFC template of ${MAX_RFC_TEMPLATE_LENGTH.toLocaleString()} characters or fewer.`
      },
      { status: 400 }
    );
  }

  try {
    const template = await rfcTemplateStore().update(content);
    return NextResponse.json({ template });
  } catch (error) {
    return rfcTemplateErrorResponse(error, "Unable to save the RFC template.");
  }
}

function rfcTemplateStore(): FileRfcTemplateStore {
  return new FileRfcTemplateStore(templatePath);
}

async function parseTemplateContent(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("content" in body) ||
      typeof body.content !== "string" ||
      !body.content.trim() ||
      body.content.length > MAX_RFC_TEMPLATE_LENGTH
    ) {
      return null;
    }

    return body.content;
  } catch {
    return null;
  }
}

function rfcTemplateErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof RfcTemplateError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 }
  );
}
