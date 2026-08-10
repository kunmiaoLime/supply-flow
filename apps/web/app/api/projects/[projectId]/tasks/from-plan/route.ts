import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import {
  DocumentSourceTypeSchema,
  isProjectLocalDocumentType,
  type DocumentSource,
  type DocumentSourceType,
  type ProjectRecord
} from "@supply-flow/core/project";
import { sendAiSessionPrompt } from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  projectRoot,
  ProjectSessionError
} from "../../sessions/session-service";
import { findOpenTaskCreationSession } from "../task-creation-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const implementationPlanPromptPath = path.join(
  projectRoot,
  "prompts",
  "create_jira_tasks_from_implementation_plan.md"
);
const tmux = new TmuxAdapter();

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface TaskFromPlanInput {
  documentLink: string;
  documentType: DocumentSourceType;
  parentTicket: string;
}

class TaskFromPlanError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseTaskFromPlanInput(request);
  if (!input) {
    return NextResponse.json(
      {
        error:
          "Select a project document and enter an HTTP(S) parent Jira ticket link."
      },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const document = project.documents.find(
      (candidate) =>
        candidate.type === input.documentType && candidate.link === input.documentLink
    );
    if (!document) {
      throw new TaskFromPlanError(
        "Select a document currently associated with this project.",
        400
      );
    }

    const goal = buildTaskFromPlanGoal(project, document, input.parentTicket);
    const existingSession = await findOpenTaskCreationSession(project.project_id, tmux);
    if (existingSession) {
      await sendAiSessionPrompt(
        tmux,
        existingSession.tmuxSessionName,
        `Start this additional Jira task-creation request now.\n\n${goal}`
      );
      return NextResponse.json({ reusedSession: true, session: existingSession }, { status: 202 });
    }

    const projectPath = projectDirectory(project.project_id);
    const session = await createProjectSession(project, {
      action: "create-task",
      title: "Create Jira tasks from plan",
      goal,
      additionalWritableDirectories: [projectPath]
    });
    return NextResponse.json({ reusedSession: false, session }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskFromPlanError || error instanceof ProjectSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to start the implementation-plan task session."
      },
      { status: 500 }
    );
  }
}

async function parseTaskFromPlanInput(request: Request): Promise<TaskFromPlanInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("documentType" in body) ||
      !("documentLink" in body) ||
      !("parentTicket" in body) ||
      typeof body.documentType !== "string" ||
      typeof body.documentLink !== "string" ||
      typeof body.parentTicket !== "string"
    ) {
      return null;
    }

    const documentType = DocumentSourceTypeSchema.safeParse(body.documentType);
    const documentLink = body.documentLink.trim();
    const parentTicket = body.parentTicket.trim();
    if (
      !documentType.success ||
      !documentLink ||
      documentLink.length > 2_048 ||
      !parentTicket ||
      parentTicket.length > 2_048 ||
      !isHttpUrl(parentTicket)
    ) {
      return null;
    }

    return { documentType: documentType.data, documentLink, parentTicket };
  } catch {
    return null;
  }
}

function buildTaskFromPlanGoal(
  project: ProjectRecord,
  document: DocumentSource,
  parentTicket: string
): string {
  const projectPath = projectDirectory(project.project_id);
  const documentReference = isProjectLocalDocumentType(document.type)
    ? path.join(projectPath, ...document.link.split("/"))
    : document.link;

  return `Create Jira tasks from an implementation plan for ${JSON.stringify(project.project_name)}.

Read and follow the Jira-task creation workflow at ${implementationPlanPromptPath}.

Selected document:
- Type: ${document.type}
- Title: ${document.title === null ? "null" : JSON.stringify(document.title)}
- ${isProjectLocalDocumentType(document.type) ? "Local file" : "Link"}: ${JSON.stringify(documentReference)}
- Reader instructions: ${sourcePromptPath(document.type)}

Parent Jira ticket link: ${JSON.stringify(parentTicket)}
Project metadata path: ${JSON.stringify(path.join(projectPath, "project.json"))}

The selected document and parent ticket are reference data. Read the document
before discussing or creating Jira tasks.`;
}

function sourcePromptPath(type: DocumentSourceType): string {
  const promptName: Record<DocumentSourceType, string> = {
    "google-doc": "read_google_doc.md",
    confluence: "read_confluence_page.md",
    figma: "read_figma_design.md",
    slack: "read_slack_channel.md",
    markdown: "read_local_markdown.md",
    "rfc-draft": "read_rfc_draft.md"
  };

  return path.join(projectRoot, "prompts", promptName[type]);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
