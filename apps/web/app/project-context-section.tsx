"use client";

import type { ProjectRecord } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { FileText, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ContextStatus {
  path: "context.md";
  updatedAt: string;
}

interface ContextStatusResponse {
  context?: ContextStatus | null;
  error?: string;
}

export function ProjectContextSection({ project }: { project: ProjectRecord }) {
  const router = useRouter();
  const [context, setContext] = useState<ContextStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [actionError, setActionError] = useState("");
  const hasRepository = project.repos.length > 0;

  useEffect(() => {
    let ignoreResult = false;

    async function loadContextStatus() {
      setIsLoading(true);
      setStatusError("");
      setActionError("");

      try {
        const response = await fetch(contextUrl(project.project_id), { cache: "no-store" });
        const data = (await response.json()) as ContextStatusResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load project context.");
        }

        if (!ignoreResult) {
          setContext(data.context ?? null);
        }
      } catch (error) {
        if (!ignoreResult) {
          setContext(null);
          setStatusError(
            error instanceof Error ? error.message : "Unable to load project context."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoading(false);
        }
      }
    }

    void loadContextStatus();
    return () => {
      ignoreResult = true;
    };
  }, [project.project_id]);

  async function startContextSession() {
    if (!hasRepository || isLoading || isStarting || statusError) {
      return;
    }

    const operation = context ? "update" : "initialize";
    setIsStarting(true);
    setActionError("");

    try {
      const response = await fetch(contextUrl(project.project_id), {
        body: JSON.stringify({ operation }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to start the context session.");
      }

      router.push(
        `/ai_sessions/${encodeURIComponent(project.project_id)}?session=${encodeURIComponent(
          data.session.id
        )}`
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to start the context session."
      );
    } finally {
      setIsStarting(false);
    }
  }

  const actionLabel = context ? "Update context" : "Initialize context";
  const ActionIcon = context ? RefreshCw : FileText;

  return (
    <section aria-labelledby="context-heading" className="context-section">
      <div className="context-section-header">
        <div>
          <p>Project understanding</p>
          <h2 id="context-heading">Context</h2>
        </div>
        <button
          className="context-session-button"
          disabled={isLoading || isStarting || !hasRepository || Boolean(statusError)}
          onClick={() => void startContextSession()}
          type="button"
        >
          <ActionIcon aria-hidden="true" />
          <span>{isStarting ? "Starting..." : actionLabel}</span>
        </button>
      </div>

      {statusError || actionError ? (
        <p className="create-project-error" role="alert">
          {statusError || actionError}
        </p>
      ) : null}

      <div className="context-status">
        <FileText aria-hidden="true" />
        <div>
          <strong>
            {isLoading ? "Loading context..." : context ? "Context available" : "No context yet"}
          </strong>
          <span>
            {isLoading
              ? "Checking local project state."
              : context
                ? `Last updated ${formatUpdatedAt(context.updatedAt)}.`
                : hasRepository
                  ? "Create context from the configured documents and repository scopes."
                  : "Add a repository before creating context."}
          </span>
        </div>
      </div>
    </section>
  );
}

function contextUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/context`;
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? "at an unknown time" : date.toLocaleString();
}
