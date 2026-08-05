"use client";

import type { ProjectRecord } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import {
  Bot,
  Check,
  Circle,
  Lock,
  Plus,
  Save,
  Square,
  TerminalSquare,
  Unlock,
  X
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TmuxTerminal } from "./tmux-terminal";

interface SessionListResponse {
  sessions?: SessionRecord[];
  error?: string;
}

export function AiSessionsPanel({ project }: { project: ProjectRecord }) {
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [creationError, setCreationError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [openingTerminalSessionId, setOpeningTerminalSessionId] = useState<string | null>(null);
  const [savingProjectContextSessionId, setSavingProjectContextSessionId] = useState<string | null>(null);
  const [savedProjectContextSessionId, setSavedProjectContextSessionId] = useState<string | null>(null);
  const [togglingReadOnlySessionId, setTogglingReadOnlySessionId] = useState<string | null>(
    null
  );
  const titleInput = useRef<HTMLInputElement>(null);
  const contextSaveResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeSessionIsReadOnly = activeSession?.readOnly !== false;
  const updateSession = useCallback((updatedSession: SessionRecord) => {
    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === updatedSession.id ? updatedSession : session
      )
    );
  }, []);

  useEffect(() => {
    let ignoreResult = false;

    async function loadSessions() {
      setIsLoading(true);
      setSessionError("");

      try {
        const response = await fetch(sessionCollectionUrl(project.project_id), {
          cache: "no-store"
        });
        const data = (await response.json()) as SessionListResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load AI sessions.");
        }

        if (!ignoreResult) {
          const loadedSessions = data.sessions ?? [];
          setSessions(loadedSessions);
          setActiveSessionId((currentSessionId) =>
            loadedSessions.some((session) => session.id === requestedSessionId)
              ? requestedSessionId
              : loadedSessions.some((session) => session.id === currentSessionId)
              ? currentSessionId
              : (loadedSessions[0]?.id ?? null)
          );
        }
      } catch (error) {
        if (!ignoreResult) {
          setSessions([]);
          setActiveSessionId(null);
          setSessionError(
            error instanceof Error ? error.message : "Unable to load AI sessions."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoading(false);
        }
      }
    }

    void loadSessions();
    return () => {
      ignoreResult = true;
    };
  }, [project.project_id, requestedSessionId]);

  useEffect(() => {
    if (isNewSessionDialogOpen) {
      titleInput.current?.focus();
    }
  }, [isNewSessionDialogOpen]);

  useEffect(
    () => () => {
      if (contextSaveResetTimeout.current) {
        clearTimeout(contextSaveResetTimeout.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!isNewSessionDialogOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isCreating) {
        closeNewSessionDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isCreating, isNewSessionDialogOpen]);

  function openNewSessionDialog() {
    setTitle("");
    setGoal("");
    setCreationError("");
    setIsNewSessionDialogOpen(true);
  }

  function closeNewSessionDialog() {
    if (!isCreating) {
      setIsNewSessionDialogOpen(false);
      setCreationError("");
    }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedGoal = goal.trim();

    if (!normalizedTitle || !normalizedGoal) {
      setCreationError("Enter a title and goal.");
      return;
    }

    setIsCreating(true);
    setCreationError("");

    try {
      const response = await fetch(sessionCollectionUrl(project.project_id), {
        body: JSON.stringify({ goal: normalizedGoal, title: normalizedTitle }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to create the AI session.");
      }

      setSessions((currentSessions) => [data.session as SessionRecord, ...currentSessions]);
      setActiveSessionId(data.session.id);
      setIsNewSessionDialogOpen(false);
      setTitle("");
      setGoal("");
    } catch (error) {
      setCreationError(
        error instanceof Error ? error.message : "Unable to create the AI session."
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function stopSession(session: SessionRecord) {
    if (stoppingSessionId) {
      return;
    }

    setStoppingSessionId(session.id);
    setSessionError("");

    try {
      const response = await fetch(sessionUrl(project.project_id, session.id), {
        method: "DELETE"
      });
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) {
        throw new Error(data.error ?? "Unable to terminate the AI session.");
      }

      setSessions((currentSessions) =>
        currentSessions.filter((currentSession) => currentSession.id !== session.id)
      );
      setActiveSessionId((currentSessionId) =>
        currentSessionId === session.id
          ? (sessions.find((currentSession) => currentSession.id !== session.id)?.id ?? null)
          : currentSessionId
      );
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to terminate the AI session."
      );
    } finally {
      setStoppingSessionId(null);
    }
  }

  async function openInNativeTerminal(session: SessionRecord) {
    if (openingTerminalSessionId) {
      return;
    }

    setOpeningTerminalSessionId(session.id);
    setSessionError("");

    try {
      const response = await fetch(`${sessionUrl(project.project_id, session.id)}/open-terminal`, {
        method: "POST"
      });
      const data = (await response.json()) as { opened?: boolean; error?: string };
      if (!response.ok || !data.opened) {
        throw new Error(data.error ?? "Unable to open macOS Terminal.");
      }
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to open macOS Terminal."
      );
    } finally {
      setOpeningTerminalSessionId(null);
    }
  }

  async function saveProjectContext(session: SessionRecord) {
    if (savingProjectContextSessionId) {
      return;
    }

    setSavingProjectContextSessionId(session.id);
    setSessionError("");

    try {
      const response = await fetch(
        `${sessionUrl(project.project_id, session.id)}/save-project-context`,
        { method: "POST" }
      );
      const data = (await response.json()) as { sent?: boolean; error?: string };
      if (!response.ok || !data.sent) {
        throw new Error(data.error ?? "Unable to send the project-context prompt.");
      }

      setSavedProjectContextSessionId(session.id);
      if (contextSaveResetTimeout.current) {
        clearTimeout(contextSaveResetTimeout.current);
      }
      contextSaveResetTimeout.current = setTimeout(() => {
        setSavedProjectContextSessionId(null);
        contextSaveResetTimeout.current = null;
      }, 2_000);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to send the project-context prompt."
      );
    } finally {
      setSavingProjectContextSessionId(null);
    }
  }

  async function toggleReadOnly(session: SessionRecord) {
    if (togglingReadOnlySessionId) {
      return;
    }

    const readOnly = session.readOnly === false;
    setTogglingReadOnlySessionId(session.id);
    setSessionError("");

    try {
      const response = await fetch(`${sessionUrl(project.project_id, session.id)}/read-only`, {
        body: JSON.stringify({ readOnly }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to update the read-only mode.");
      }

      updateSession(data.session);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to update the read-only mode."
      );
    } finally {
      setTogglingReadOnlySessionId(null);
    }
  }

  return (
    <>
      <section aria-label="AI sessions" className="ai-sessions-section">
        <div className="ai-sessions-toolbar">
          {sessions.length > 0 ? (
            <div aria-label="AI session tabs" className="ai-session-tab-list" role="tablist">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const isStopping = stoppingSessionId === session.id;

                return (
                  <div
                    className={`ai-session-tab${isActive ? " is-active" : ""}`}
                    key={session.id}
                  >
                    <button
                      aria-controls="active-ai-session"
                      aria-selected={isActive}
                      className="ai-session-tab-select"
                      onClick={() => setActiveSessionId(session.id)}
                      role="tab"
                      title={session.title}
                      type="button"
                    >
                      <Circle
                        aria-hidden="true"
                        className={session.status === "running" ? "is-running" : ""}
                      />
                      <span>{session.title}</span>
                    </button>
                    <button
                      aria-label={`Terminate ${session.title}`}
                      className="ai-session-tab-close"
                      disabled={isStopping}
                      onClick={() => void stopSession(session)}
                      title="Terminate session"
                      type="button"
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          <button className="add-session-button" onClick={openNewSessionDialog} type="button">
            <Plus aria-hidden="true" />
            <span>New session</span>
          </button>
        </div>

        {sessionError ? (
          <p className="create-project-error" role="alert">
            {sessionError}
          </p>
        ) : null}

        {isLoading ? (
          <div className="ai-sessions-loading">Loading AI sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="ai-sessions-empty">
            <Bot aria-hidden="true" />
            <div>
              <strong>No AI sessions</strong>
              <span>Create a Codex session to begin work on this project.</span>
            </div>
          </div>
        ) : (
          activeSession ? (
            <section
              aria-label={activeSession.title}
              className="ai-session-workspace"
              id="active-ai-session"
              role="tabpanel"
            >
              <div className="ai-session-terminal">
                <div className="ai-session-terminal-header">
                  <div>
                    <span className={activeSession.status === "running" ? "is-running" : ""} />
                    <strong>Terminal</strong>
                  </div>
                  <div className="ai-session-terminal-actions">
                    {activeSession.status === "starting" || activeSession.status === "running" ? (
                      <>
                        <button
                          aria-label={`Save ${activeSession.title} context to the project`}
                          className="session-icon-button"
                          disabled={savingProjectContextSessionId === activeSession.id}
                          onClick={() => void saveProjectContext(activeSession)}
                          title={
                            savedProjectContextSessionId === activeSession.id
                              ? "Project-context prompt sent"
                              : "Save session context to project"
                          }
                          type="button"
                        >
                          {savedProjectContextSessionId === activeSession.id ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Save aria-hidden="true" />
                          )}
                        </button>
                        <button
                          aria-label={
                            activeSessionIsReadOnly
                              ? `Disable read-only for ${activeSession.title}`
                              : `Enable read-only for ${activeSession.title}`
                          }
                          aria-pressed={activeSessionIsReadOnly}
                          className={`session-icon-button${
                            activeSessionIsReadOnly ? " is-active" : ""
                          }`}
                          disabled={togglingReadOnlySessionId === activeSession.id}
                          onClick={() => void toggleReadOnly(activeSession)}
                          title={
                            activeSessionIsReadOnly
                              ? "Read-only is on. Disable read-only"
                              : "Read-only is off. Enable read-only"
                          }
                          type="button"
                        >
                          {activeSessionIsReadOnly ? (
                            <Lock aria-hidden="true" />
                          ) : (
                            <Unlock aria-hidden="true" />
                          )}
                        </button>
                        <button
                          aria-label={`Open ${activeSession.title} in macOS Terminal`}
                          className="session-icon-button"
                          disabled={openingTerminalSessionId === activeSession.id}
                          onClick={() => void openInNativeTerminal(activeSession)}
                          title="Open in macOS Terminal"
                          type="button"
                        >
                          <TerminalSquare aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`Stop ${activeSession.title}`}
                          className="session-icon-button is-danger"
                          disabled={stoppingSessionId === activeSession.id}
                          onClick={() => void stopSession(activeSession)}
                          title="Stop session"
                          type="button"
                        >
                          <Square aria-hidden="true" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <TmuxTerminal
                  key={`${project.project_id}:${activeSession.id}`}
                  onSessionUpdated={updateSession}
                  onTerminalError={setSessionError}
                  projectId={project.project_id}
                  session={activeSession}
                />
              </div>

              {activeSession.lastError ? (
                <p className="create-project-error" role="alert">
                  {activeSession.lastError}
                </p>
              ) : null}
            </section>
          ) : null
        )}
      </section>

      {isNewSessionDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeNewSessionDialog();
            }
          }}
        >
          <section
            aria-labelledby="new-session-title"
            aria-modal="true"
            className="create-project-dialog new-session-dialog"
            role="dialog"
          >
            <h2 id="new-session-title">New session</h2>
            <form onSubmit={createSession}>
              <div className="session-form-fields">
                <label htmlFor="session-title">
                  <span>Title</span>
                  <input
                    autoComplete="off"
                    id="session-title"
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Session title"
                    ref={titleInput}
                    required
                    type="text"
                    value={title}
                  />
                </label>
                <label htmlFor="session-goal">
                  <span>Goal</span>
                  <textarea
                    id="session-goal"
                    maxLength={16_000}
                    onChange={(event) => setGoal(event.target.value)}
                    placeholder="What should Codex do?"
                    required
                    rows={6}
                    value={goal}
                  />
                </label>
              </div>
              {creationError ? (
                <p className="create-project-error" role="alert">
                  {creationError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isCreating}
                  onClick={closeNewSessionDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="dialog-primary-button" disabled={isCreating} type="submit">
                  <Plus aria-hidden="true" />
                  <span>{isCreating ? "Starting..." : "Create session"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

function sessionCollectionUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/sessions`;
}

function sessionUrl(projectId: string, sessionId: string): string {
  return `${sessionCollectionUrl(projectId)}/${encodeURIComponent(sessionId)}`;
}
