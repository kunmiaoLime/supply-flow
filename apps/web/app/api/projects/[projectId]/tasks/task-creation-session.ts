import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import type { TmuxAdapter } from "@supply-flow/core/tmux";
import { projectDirectory } from "../sessions/session-service";

export async function findOpenTaskCreationSession(
  projectId: string,
  tmux: Pick<TmuxAdapter, "listSessions">
): Promise<SessionRecord | null> {
  let activeTmuxSessions: Set<string>;
  try {
    activeTmuxSessions = new Set(await tmux.listSessions());
  } catch {
    return null;
  }

  const store = new FileSessionStore(projectDirectory(projectId));
  return (
    (await store.list()).find(
      (session) =>
        (session.status === "starting" || session.status === "running") &&
        activeTmuxSessions.has(session.tmuxSessionName) &&
        isTaskCreationSession(session)
    ) ?? null
  );
}

function isTaskCreationSession(session: SessionRecord): boolean {
  return (
    session.goal.includes("Help the user create a Jira task for") ||
    session.goal.includes("Create Jira tasks from an implementation plan")
  );
}
