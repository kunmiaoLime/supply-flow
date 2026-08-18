import { stat } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { dataDirectory, projectDirectory } from "./api/projects/[projectId]/sessions/session-service";

const AI_INTERFACE_SESSIONS_DIRECTORY = "ai-interface-sessions";

export interface PersistedSessionReconciliation {
  projectCount: number;
  sessionCount: number;
  removedCount: number;
}

interface SessionStoreReconciliation {
  sessions: SessionRecord[];
  removedCount: number;
}

export async function reconcilePersistedAiSessions(): Promise<PersistedSessionReconciliation | null> {
  let activeTmuxSessions: Set<string>;
  try {
    activeTmuxSessions = new Set(await new TmuxAdapter().listSessions());
  } catch {
    return null;
  }

  const projects = await new FileProjectStore(dataDirectory).list();
  const stores = projects.map(
    (project) => new FileSessionStore(projectDirectory(project.project_id))
  );
  const globalSessionsDirectory = path.join(
    dataDirectory,
    "settings",
    AI_INTERFACE_SESSIONS_DIRECTORY
  );
  if (await directoryExists(globalSessionsDirectory)) {
    stores.push(new FileSessionStore(globalSessionsDirectory));
  }

  const sessions = await Promise.all(
    stores.map((store) => reconcileSessionStore(store, activeTmuxSessions))
  );
  const flattenedSessions = sessions.flatMap((result) => result.sessions);

  return {
    projectCount: projects.length,
    sessionCount: flattenedSessions.length,
    removedCount: sessions.reduce((count, result) => count + result.removedCount, 0)
  };
}

export async function reconcileSessionStore(
  store: FileSessionStore,
  activeTmuxSessions: ReadonlySet<string>
): Promise<SessionStoreReconciliation> {
  const sessions: SessionRecord[] = [];
  let removedCount = 0;

  for (const session of await store.list()) {
    if (!activeTmuxSessions.has(session.tmuxSessionName)) {
      await store.remove(session.id);
      removedCount += 1;
      continue;
    }

    sessions.push(
      session.status === "running"
        ? session
        : await store.update(session.id, { lastError: undefined, status: "running" })
    );
  }

  return { sessions, removedCount };
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
