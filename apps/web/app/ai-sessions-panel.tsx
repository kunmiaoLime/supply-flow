"use client";

import {
  resolveAiModelDefault,
  type AiModelSettings,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import type { ProjectRecord } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import {
  Bell,
  BellRing,
  Bot,
  Check,
  Circle,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Square,
  TerminalSquare,
  Unlock,
  X
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AiSessionConfigurationFields } from "./ai-session-configuration-fields";
import { TmuxTerminal } from "./tmux-terminal";

interface SessionListResponse {
  sessions?: SessionRecord[];
  error?: string;
}

interface AiModelSettingsResponse {
  settings?: AiModelSettings;
  error?: string;
}

type SessionScope = "global" | "project";

interface ScopedSession {
  scope: SessionScope;
  session: SessionRecord;
}

export function AiSessionsPanel({ project }: { project?: ProjectRecord }) {
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const [globalSessions, setGlobalSessions] = useState<SessionRecord[]>([]);
  const [projectSessions, setProjectSessions] = useState<SessionRecord[]>([]);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [newSessionDefaults, setNewSessionDefaults] =
    useState<ResolvedAiSessionActionSettings | null>(null);
  const [newSessionConfiguration, setNewSessionConfiguration] =
    useState<ResolvedAiSessionActionSettings | null>(null);
  const [isLoadingNewSessionDefaults, setIsLoadingNewSessionDefaults] = useState(true);
  const [newSessionDefaultsError, setNewSessionDefaultsError] = useState("");
  const [creationError, setCreationError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [stoppingSessionKey, setStoppingSessionKey] = useState<string | null>(null);
  const [openingTerminalSessionKey, setOpeningTerminalSessionKey] = useState<string | null>(
    null
  );
  const [authenticatingSessionKey, setAuthenticatingSessionKey] = useState<string | null>(
    null
  );
  const [authenticatedSessionKey, setAuthenticatedSessionKey] = useState<string | null>(null);
  const [savingProjectContextSessionKey, setSavingProjectContextSessionKey] = useState<
    string | null
  >(null);
  const [savedProjectContextSessionKey, setSavedProjectContextSessionKey] = useState<
    string | null
  >(null);
  const [togglingReadOnlySessionKey, setTogglingReadOnlySessionKey] = useState<string | null>(
    null
  );
  const [terminalRefreshRequest, setTerminalRefreshRequest] = useState<{
    requestId: number;
    sessionKey: string;
  } | null>(null);
  const [refreshingTerminalSessionKey, setRefreshingTerminalSessionKey] = useState<
    string | null
  >(null);
  const [requestingCompletionNotificationSessionKey, setRequestingCompletionNotificationSessionKey] =
    useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const contextSaveResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authenticationResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalRefreshRequestId = useRef(0);

  const sessions = combineSessions(globalSessions, projectSessions);
  const activeSession = sessions.find((session) => sessionKey(session) === activeSessionKey) ?? null;
  const activeSessionIsReadOnly = activeSession?.session.readOnly !== false;
  const activeSessionNeedsWriteModeRestart =
    activeSession?.session.readOnly === false && activeSession.session.launchedReadOnly !== false;

  useEffect(() => {
    let ignoreResult = false;

    async function loadNewSessionDefaults() {
      setIsLoadingNewSessionDefaults(true);
      setNewSessionDefaultsError("");

      try {
        const response = await fetch("/api/settings/ai-models", { cache: "no-store" });
        const data = (await response.json()) as AiModelSettingsResponse;
        if (!response.ok || !data.settings) {
          throw new Error(data.error ?? "Unable to load AI session defaults.");
        }

        const defaults = resolveAiModelDefault(data.settings, "new-session");
        if (!ignoreResult) {
          setNewSessionDefaults(defaults);
          setNewSessionConfiguration((currentConfiguration) => currentConfiguration ?? defaults);
        }
      } catch (error) {
        if (!ignoreResult) {
          setNewSessionDefaults(null);
          setNewSessionConfiguration(null);
          setNewSessionDefaultsError(
            error instanceof Error ? error.message : "Unable to load AI session defaults."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoadingNewSessionDefaults(false);
        }
      }
    }

    void loadNewSessionDefaults();
    return () => {
      ignoreResult = true;
    };
  }, []);

  useEffect(() => {
    let ignoreResult = false;

    async function loadSessions() {
      setIsLoading(true);
      setSessionError("");

      const results = await Promise.allSettled([
        loadSessionCollection(globalSessionCollectionUrl()),
        project ? loadSessionCollection(projectSessionCollectionUrl(project.project_id)) : []
      ]);
      if (ignoreResult) {
        return;
      }

      const loadedGlobalSessions =
        results[0].status === "fulfilled" ? results[0].value : [];
      const loadedProjectSessions =
        results[1].status === "fulfilled" ? results[1].value : [];
      const loadedSessions = combineSessions(loadedGlobalSessions, loadedProjectSessions);
      const requestedSession = loadedSessions.find(
        (session) => session.session.id === requestedSessionId
      );

      setGlobalSessions(loadedGlobalSessions);
      setProjectSessions(loadedProjectSessions);
      setActiveSessionKey((currentSessionKey) =>
        requestedSession
          ? sessionKey(requestedSession)
          : loadedSessions.some((session) => sessionKey(session) === currentSessionKey)
            ? currentSessionKey
            : (loadedSessions[0] ? sessionKey(loadedSessions[0]) : null)
      );

      if (results.some((result) => result.status === "rejected")) {
        setSessionError("Some AI sessions could not be loaded.");
      }
      setIsLoading(false);
    }

    void loadSessions().catch((error: unknown) => {
      if (!ignoreResult) {
        setGlobalSessions([]);
        setProjectSessions([]);
        setActiveSessionKey(null);
        setSessionError(error instanceof Error ? error.message : "Unable to load AI sessions.");
        setIsLoading(false);
      }
    });

    return () => {
      ignoreResult = true;
    };
  }, [project?.project_id, requestedSessionId]);

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
      if (authenticationResetTimeout.current) {
        clearTimeout(authenticationResetTimeout.current);
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
    setNewSessionConfiguration(newSessionDefaults);
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
    if (!project) {
      setCreationError("Select a project before creating an AI session.");
      return;
    }

    const normalizedTitle = title.trim();
    const normalizedGoal = goal.trim();
    if (!normalizedTitle || !normalizedGoal) {
      setCreationError("Enter a title and goal.");
      return;
    }
    if (!newSessionConfiguration) {
      setCreationError(
        newSessionDefaultsError || "AI session defaults are still loading. Try again shortly."
      );
      return;
    }

    setIsCreating(true);
    setCreationError("");

    try {
      const response = await fetch(projectSessionCollectionUrl(project.project_id), {
        body: JSON.stringify({
          goal: normalizedGoal,
          model: newSessionConfiguration.model,
          providerId: newSessionConfiguration.providerId,
          reasoningEffort: newSessionConfiguration.reasoningEffort,
          readOnly: newSessionConfiguration.readOnly,
          title: normalizedTitle,
          yoloMode: newSessionConfiguration.yoloMode
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to create the AI session.");
      }

      const createdSession: ScopedSession = { scope: "project", session: data.session };
      setProjectSessions((currentSessions) => [createdSession.session, ...currentSessions]);
      setActiveSessionKey(sessionKey(createdSession));
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

  async function stopSession(scopedSession: ScopedSession) {
    const key = sessionKey(scopedSession);
    if (stoppingSessionKey) {
      return;
    }

    setStoppingSessionKey(key);
    setSessionError("");

    try {
      const response = await fetch(sessionUrl(scopedSession, project), { method: "DELETE" });
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) {
        throw new Error(data.error ?? "Unable to terminate the AI session.");
      }

      if (scopedSession.scope === "global") {
        setGlobalSessions((currentSessions) =>
          currentSessions.filter((session) => session.id !== scopedSession.session.id)
        );
      } else {
        setProjectSessions((currentSessions) =>
          currentSessions.filter((session) => session.id !== scopedSession.session.id)
        );
      }
      const nextSession = sessions.find((session) => sessionKey(session) !== key) ?? null;
      setActiveSessionKey((currentSessionKey) =>
        currentSessionKey === key ? (nextSession ? sessionKey(nextSession) : null) : currentSessionKey
      );
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to terminate the AI session."
      );
    } finally {
      setStoppingSessionKey(null);
    }
  }

  async function openInNativeTerminal(scopedSession: ScopedSession) {
    const key = sessionKey(scopedSession);
    if (openingTerminalSessionKey) {
      return;
    }

    setOpeningTerminalSessionKey(key);
    setSessionError("");

    try {
      const response = await fetch(`${sessionUrl(scopedSession, project)}/open-terminal`, {
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
      setOpeningTerminalSessionKey(null);
    }
  }

  async function authenticateSession(scopedSession: ScopedSession) {
    const key = sessionKey(scopedSession);
    if (authenticatingSessionKey) {
      return;
    }

    setAuthenticatingSessionKey(key);
    setSessionError("");

    try {
      const response = await fetch(`${sessionUrl(scopedSession, project)}/authenticate`, {
        method: "POST"
      });
      const data = (await response.json()) as { authenticated?: boolean; error?: string };
      if (!response.ok || !data.authenticated) {
        throw new Error(data.error ?? "Unable to complete authentication.");
      }

      setAuthenticatedSessionKey(key);
      if (authenticationResetTimeout.current) {
        clearTimeout(authenticationResetTimeout.current);
      }
      authenticationResetTimeout.current = setTimeout(() => {
        setAuthenticatedSessionKey(null);
        authenticationResetTimeout.current = null;
      }, 2_000);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to complete authentication."
      );
    } finally {
      setAuthenticatingSessionKey(null);
    }
  }

  async function saveProjectContext(scopedSession: ScopedSession) {
    if (scopedSession.scope !== "project" || savingProjectContextSessionKey) {
      return;
    }

    const key = sessionKey(scopedSession);
    setSavingProjectContextSessionKey(key);
    setSessionError("");

    try {
      const response = await fetch(`${sessionUrl(scopedSession, project)}/save-project-context`, {
        method: "POST"
      });
      const data = (await response.json()) as { sent?: boolean; error?: string };
      if (!response.ok || !data.sent) {
        throw new Error(data.error ?? "Unable to send the project-context prompt.");
      }

      setSavedProjectContextSessionKey(key);
      if (contextSaveResetTimeout.current) {
        clearTimeout(contextSaveResetTimeout.current);
      }
      contextSaveResetTimeout.current = setTimeout(() => {
        setSavedProjectContextSessionKey(null);
        contextSaveResetTimeout.current = null;
      }, 2_000);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to send the project-context prompt."
      );
    } finally {
      setSavingProjectContextSessionKey(null);
    }
  }

  async function toggleCompletionNotification(scopedSession: ScopedSession) {
    const key = sessionKey(scopedSession);
    if (requestingCompletionNotificationSessionKey) {
      return;
    }

    const enabled = !scopedSession.session.notifyWhenComplete;
    setRequestingCompletionNotificationSessionKey(key);
    setSessionError("");

    try {
      const response = await fetch(`${sessionUrl(scopedSession, project)}/notify`, {
        body: JSON.stringify({ enabled }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as {
        enabled?: boolean;
        session?: SessionRecord;
        error?: string;
      };
      if (!response.ok || data.enabled !== enabled || !data.session) {
        throw new Error(data.error ?? "Unable to update the completion notification.");
      }

      updateSession(scopedSession.scope, data.session);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to update the completion notification."
      );
    } finally {
      setRequestingCompletionNotificationSessionKey(null);
    }
  }

  async function toggleReadOnly(scopedSession: ScopedSession) {
    const key = sessionKey(scopedSession);
    if (togglingReadOnlySessionKey) {
      return;
    }

    const needsWriteModeRestart =
      scopedSession.session.readOnly === false && scopedSession.session.launchedReadOnly !== false;
    const readOnly = needsWriteModeRestart ? false : scopedSession.session.readOnly === false;
    setTogglingReadOnlySessionKey(key);
    setSessionError("");

    try {
      const response = await fetch(`${sessionUrl(scopedSession, project)}/read-only`, {
        body: JSON.stringify({ readOnly }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to update the read-only mode.");
      }

      updateSession(scopedSession.scope, data.session);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to update the read-only mode."
      );
    } finally {
      setTogglingReadOnlySessionKey(null);
    }
  }

  function refreshTerminal(scopedSession: ScopedSession) {
    const key = sessionKey(scopedSession);
    terminalRefreshRequestId.current += 1;
    setSessionError("");
    setTerminalRefreshRequest({
      requestId: terminalRefreshRequestId.current,
      sessionKey: key
    });
    setRefreshingTerminalSessionKey(key);
  }

  function completeTerminalRefresh(requestId: number) {
    setRefreshingTerminalSessionKey((currentSessionKey) =>
      terminalRefreshRequest?.requestId === requestId ? null : currentSessionKey
    );
  }

  function updateSession(scope: SessionScope, updatedSession: SessionRecord) {
    const update = (sessions_: SessionRecord[]) =>
      sessions_.map((session) => (session.id === updatedSession.id ? updatedSession : session));

    if (scope === "global") {
      setGlobalSessions(update);
    } else {
      setProjectSessions(update);
    }
  }

  function removeSessionFromUi(scopedSession: ScopedSession) {
    const key = sessionKey(scopedSession);
    setSessionError("");
    if (scopedSession.scope === "global") {
      setGlobalSessions((currentSessions) =>
        currentSessions.filter((session) => session.id !== scopedSession.session.id)
      );
    } else {
      setProjectSessions((currentSessions) =>
        currentSessions.filter((session) => session.id !== scopedSession.session.id)
      );
    }
    setActiveSessionKey((currentSessionKey) =>
      currentSessionKey === key ? null : currentSessionKey
    );
  }

  return (
    <>
      <section aria-label="AI sessions" className="ai-sessions-section">
        <div className="ai-sessions-toolbar">
          {sessions.length > 0 ? (
            <div aria-label="AI session tabs" className="ai-session-tab-list" role="tablist">
              {sessions.map((scopedSession) => {
                const key = sessionKey(scopedSession);
                const isActive = key === activeSessionKey;
                const isStopping = stoppingSessionKey === key;

                return (
                  <div
                    className={`ai-session-tab${isActive ? " is-active" : ""}`}
                    key={key}
                  >
                    <button
                      aria-controls="active-ai-session"
                      aria-selected={isActive}
                      className="ai-session-tab-select"
                      onClick={() => setActiveSessionKey(key)}
                      role="tab"
                      title={
                        scopedSession.scope === "global"
                          ? `Global: ${scopedSession.session.title}`
                          : scopedSession.session.title
                      }
                      type="button"
                    >
                      <Circle
                        aria-hidden="true"
                        className={scopedSession.session.status === "running" ? "is-running" : ""}
                      />
                      <span>{scopedSession.session.title}</span>
                    </button>
                    <button
                      aria-label={`Terminate ${scopedSession.session.title}`}
                      className="ai-session-tab-close"
                      disabled={isStopping}
                      onClick={() => void stopSession(scopedSession)}
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
          {project ? (
            <button className="add-session-button" onClick={openNewSessionDialog} type="button">
              <Plus aria-hidden="true" />
              <span>New session</span>
            </button>
          ) : null}
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
              <span>
                {project
                  ? "Create a session or start interface setup from Settings."
                  : "Start interface setup from Settings."}
              </span>
            </div>
          </div>
        ) : activeSession ? (
          <section
            aria-label={activeSession.session.title}
            className="ai-session-workspace"
            id="active-ai-session"
            role="tabpanel"
          >
            <div className="ai-session-terminal">
              <div className="ai-session-terminal-header">
                <div>
                  <span
                    className={activeSession.session.status === "running" ? "is-running" : ""}
                  />
                  <strong>Terminal</strong>
                </div>
                <div className="ai-session-terminal-actions">
                  {activeSession.session.status === "starting" ||
                  activeSession.session.status === "running" ? (
                    <>
                      <button
                        aria-busy={
                          refreshingTerminalSessionKey === sessionKey(activeSession)
                        }
                        aria-label={`Refresh ${activeSession.session.title} from tmux`}
                        className={`session-icon-button${
                          refreshingTerminalSessionKey === sessionKey(activeSession)
                            ? " is-refreshing"
                            : ""
                        }`}
                        disabled={
                          refreshingTerminalSessionKey === sessionKey(activeSession)
                        }
                        onClick={() => refreshTerminal(activeSession)}
                        title="Refresh terminal from tmux"
                        type="button"
                      >
                        <RefreshCw aria-hidden="true" />
                      </button>
                      <button
                        aria-label={
                          activeSession.session.notifyWhenComplete
                            ? `Turn off completion notification for ${activeSession.session.title}`
                            : `Notify when ${activeSession.session.title} is complete`
                        }
                        aria-pressed={activeSession.session.notifyWhenComplete === true}
                        className={`session-icon-button${
                          activeSession.session.notifyWhenComplete ? " is-active" : ""
                        }`}
                        disabled={
                          requestingCompletionNotificationSessionKey ===
                            sessionKey(activeSession)
                        }
                        onClick={() => void toggleCompletionNotification(activeSession)}
                        title={
                          activeSession.session.notifyWhenComplete
                            ? "Completion notification is on. Turn off"
                            : "Notify when current work is complete"
                        }
                        type="button"
                      >
                        {activeSession.session.notifyWhenComplete ? (
                          <BellRing aria-hidden="true" />
                        ) : (
                          <Bell aria-hidden="true" />
                        )}
                      </button>
                      {activeSession.scope === "project" ? (
                        <button
                          aria-label={`Save ${activeSession.session.title} context to the project`}
                          className="session-icon-button"
                          disabled={savingProjectContextSessionKey === sessionKey(activeSession)}
                          onClick={() => void saveProjectContext(activeSession)}
                          title={
                            savedProjectContextSessionKey === sessionKey(activeSession)
                              ? "Project-context prompt sent"
                              : "Save session context to project"
                          }
                          type="button"
                        >
                          {savedProjectContextSessionKey === sessionKey(activeSession) ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Save aria-hidden="true" />
                          )}
                        </button>
                      ) : null}
                      <button
                        aria-label={
                          activeSessionNeedsWriteModeRestart
                            ? `Restart ${activeSession.session.title} with write access`
                            : activeSessionIsReadOnly
                            ? `Disable read-only for ${activeSession.session.title}`
                            : `Enable read-only for ${activeSession.session.title}`
                        }
                        aria-pressed={activeSessionIsReadOnly}
                        className={`session-icon-button${
                          activeSessionIsReadOnly ? " is-active" : ""
                        }`}
                        disabled={togglingReadOnlySessionKey === sessionKey(activeSession)}
                        onClick={() => void toggleReadOnly(activeSession)}
                        title={
                          activeSessionNeedsWriteModeRestart
                            ? "Restart with write access"
                            : activeSessionIsReadOnly
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
                      {supportsAuthentication(activeSession.session) ? (
                        <button
                          aria-label={`Authenticate ${providerDisplayName(activeSession.session.providerId)}`}
                          className="session-icon-button"
                          disabled={authenticatingSessionKey === sessionKey(activeSession)}
                          onClick={() => void authenticateSession(activeSession)}
                          title={
                            authenticatedSessionKey === sessionKey(activeSession)
                              ? "Authentication complete"
                              : authenticationTitle(activeSession.session.providerId)
                          }
                          type="button"
                        >
                          {authenticatedSessionKey === sessionKey(activeSession) ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <KeyRound aria-hidden="true" />
                          )}
                        </button>
                      ) : null}
                      <button
                        aria-label={`Open ${activeSession.session.title} in macOS Terminal`}
                        className="session-icon-button"
                        disabled={openingTerminalSessionKey === sessionKey(activeSession)}
                        onClick={() => void openInNativeTerminal(activeSession)}
                        title="Open in macOS Terminal"
                        type="button"
                      >
                        <TerminalSquare aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Stop ${activeSession.session.title}`}
                        className="session-icon-button is-danger"
                        disabled={stoppingSessionKey === sessionKey(activeSession)}
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
                key={sessionKey(activeSession)}
                onSessionRemoved={() => removeSessionFromUi(activeSession)}
                onSessionUpdated={(updatedSession) =>
                  updateSession(activeSession.scope, updatedSession)
                }
                onTerminalError={setSessionError}
                onTerminalRefreshComplete={completeTerminalRefresh}
                refreshRequestId={
                  terminalRefreshRequest?.sessionKey === sessionKey(activeSession)
                    ? terminalRefreshRequest.requestId
                    : null
                }
                session={activeSession.session}
                sessionEndpoint={sessionUrl(activeSession, project)}
              />
            </div>

            {activeSession.session.lastError ? (
              <p className="create-project-error" role="alert">
                {activeSession.session.lastError}
              </p>
            ) : null}
          </section>
        ) : null}
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
                <AiSessionConfigurationFields
                  configuration={newSessionConfiguration}
                  disabled={isCreating || isLoadingNewSessionDefaults}
                  idPrefix="session"
                  isLoading={isLoadingNewSessionDefaults}
                  onChange={setNewSessionConfiguration}
                />
              </div>
              {newSessionDefaultsError ? (
                <p className="create-project-error" role="alert">
                  {newSessionDefaultsError}
                </p>
              ) : null}
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

function combineSessions(
  globalSessions: SessionRecord[],
  projectSessions: SessionRecord[]
): ScopedSession[] {
  return [
    ...globalSessions.map((session) => ({ scope: "global" as const, session })),
    ...projectSessions.map((session) => ({ scope: "project" as const, session }))
  ];
}

function sessionKey(scopedSession: ScopedSession): string {
  return `${scopedSession.scope}:${scopedSession.session.id}`;
}

async function loadSessionCollection(url: string): Promise<SessionRecord[]> {
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as SessionListResponse;
  if (!response.ok) {
    throw new Error(data.error ?? "Unable to load AI sessions.");
  }

  return data.sessions ?? [];
}

function projectSessionCollectionUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/sessions`;
}

function globalSessionCollectionUrl(): string {
  return "/api/settings/ai-interfaces/sessions";
}

function sessionUrl(scopedSession: ScopedSession, project?: ProjectRecord): string {
  if (scopedSession.scope === "global") {
    return `${globalSessionCollectionUrl()}/${encodeURIComponent(scopedSession.session.id)}`;
  }
  if (!project) {
    throw new Error("A project is required for this AI session.");
  }

  return `${projectSessionCollectionUrl(project.project_id)}/${encodeURIComponent(
    scopedSession.session.id
  )}`;
}

function providerDisplayName(providerId: string): string {
  if (providerId === "codex") {
    return "Codex";
  }

  return providerId === "claude-code" ? "Claude Code" : providerId;
}

function supportsAuthentication(session: SessionRecord): boolean {
  return session.providerId === "codex" || session.providerId === "claude-code";
}

function authenticationTitle(providerId: string): string {
  return providerId === "codex" ? "Authenticate Codex" : "Authenticate Claude";
}
