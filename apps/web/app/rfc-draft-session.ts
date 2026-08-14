import { readFile } from "node:fs/promises";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { DocumentSource } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { terminalLogPath } from "./api/projects/[projectId]/sessions/session-service";

const tmux = new TmuxAdapter();

export async function findActiveRfcDraftWriterSession(
  projectId: string,
  draft: DocumentSource,
  store: FileSessionStore
): Promise<SessionRecord | null> {
  const activeTmuxSessions = await activeTmuxSessionNames();

  if (draft.rfc_session_id) {
    const associatedSession = await store.get(draft.rfc_session_id);
    if (associatedSession && isActiveSession(associatedSession, activeTmuxSessions)) {
      return associatedSession;
    }
  }

  for (const session of await store.list()) {
    if (
      !isActiveSession(session, activeTmuxSessions) ||
      !isRfcDraftSession(session) ||
      !(await terminalOutputContains(projectId, session.id, draft.link))
    ) {
      continue;
    }

    return session;
  }

  return null;
}

async function activeTmuxSessionNames(): Promise<Set<string>> {
  try {
    return new Set(await tmux.listSessions());
  } catch {
    return new Set();
  }
}

function isActiveSession(session: SessionRecord, activeTmuxSessions: Set<string>): boolean {
  return (
    (session.status === "starting" || session.status === "running") &&
    activeTmuxSessions.has(session.tmuxSessionName)
  );
}

function isRfcDraftSession(session: SessionRecord): boolean {
  return (
    session.goal.includes("Write an RFC draft") ||
    session.goal.includes("Update an existing RFC draft")
  );
}

async function terminalOutputContains(
  projectId: string,
  sessionId: string,
  draftLink: string
): Promise<boolean> {
  try {
    return (await readFile(terminalLogPath(projectId, sessionId), "utf8")).includes(draftLink);
  } catch {
    return false;
  }
}
