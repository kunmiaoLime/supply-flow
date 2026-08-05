"use client";

import type {
  ContextAnalysis,
  ContextConflict,
  ContextGap,
  ContextIssueSource
} from "@supply-flow/core/context-analysis";
import type { ProjectRecord } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { CircleHelp, FileText, GitCompareArrows, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { workspaceTabUrl } from "./workspace-url";

interface ContextStatus {
  path: "context.md";
  updatedAt: string;
}

interface ContextStatusResponse {
  context?: ContextStatus | null;
  analysis?: ContextAnalysis | null;
  analysisError?: string;
  error?: string;
}

export function ProjectContextSection({ project }: { project: ProjectRecord }) {
  const router = useRouter();
  const [context, setContext] = useState<ContextStatus | null>(null);
  const [analysis, setAnalysis] = useState<ContextAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [actionError, setActionError] = useState("");
  const hasRepository = project.repos.length > 0;

  useEffect(() => {
    let ignoreResult = false;

    async function loadContextStatus() {
      setIsLoading(true);
      setStatusError("");
      setAnalysisError("");
      setActionError("");

      try {
        const response = await fetch(contextUrl(project.project_id), { cache: "no-store" });
        const data = (await response.json()) as ContextStatusResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load project context.");
        }

        if (!ignoreResult) {
          setContext(data.context ?? null);
          setAnalysis(data.analysis ?? null);
          setAnalysisError(data.analysisError ?? "");
        }
      } catch (error) {
        if (!ignoreResult) {
          setContext(null);
          setAnalysis(null);
          setAnalysisError("");
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

      router.push(workspaceTabUrl("/ai_sessions", project.project_id, data.session.id));
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

      {context && !isLoading ? (
        <ContextAnalysisPanel analysis={analysis} analysisError={analysisError} />
      ) : null}
    </section>
  );
}

function ContextAnalysisPanel({
  analysis,
  analysisError
}: {
  analysis: ContextAnalysis | null;
  analysisError: string;
}) {
  if (analysisError) {
    return (
      <p className="context-analysis-warning" role="alert">
        {analysisError} Run Update context to regenerate the analysis files.
      </p>
    );
  }

  if (!analysis) {
    return (
      <p className="context-analysis-pending">
        Run Update context to identify gaps and conflicts.
      </p>
    );
  }

  return (
    <div className="context-analysis-grid">
      <ContextGapList gaps={analysis.gaps} />
      <ContextConflictList conflicts={analysis.conflicts} />
    </div>
  );
}

function ContextGapList({ gaps }: { gaps: ContextGap[] }) {
  return (
    <section aria-labelledby="context-gaps-heading" className="context-analysis-group">
      <div className="context-analysis-group-header">
        <div>
          <CircleHelp aria-hidden="true" />
          <h3 id="context-gaps-heading">Gaps</h3>
        </div>
        <span>{gaps.length}</span>
      </div>
      {gaps.length === 0 ? (
        <p className="context-analysis-empty">No gaps identified.</p>
      ) : (
        <ul className="context-analysis-list">
          {gaps.map((gap) => (
            <li key={gap.id}>
              <ContextIssueHeading issue={gap} />
              <p className="context-analysis-description">{gap.description}</p>
              <ContextIssueDetail label="Impact" value={gap.impact} />
              <ContextIssueDetail label="Clarify" value={gap.questions.join(" ")} />
              <ContextIssueSources sources={gap.sources} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContextConflictList({ conflicts }: { conflicts: ContextConflict[] }) {
  return (
    <section aria-labelledby="context-conflicts-heading" className="context-analysis-group">
      <div className="context-analysis-group-header">
        <div>
          <GitCompareArrows aria-hidden="true" />
          <h3 id="context-conflicts-heading">Conflicts</h3>
        </div>
        <span>{conflicts.length}</span>
      </div>
      {conflicts.length === 0 ? (
        <p className="context-analysis-empty">No conflicts identified.</p>
      ) : (
        <ul className="context-analysis-list">
          {conflicts.map((conflict) => (
            <li key={conflict.id}>
              <ContextIssueHeading issue={conflict} />
              <p className="context-analysis-description">{conflict.description}</p>
              <ContextIssueDetail label="Impact" value={conflict.impact} />
              <ContextIssueDetail
                label="Resolve"
                value={conflict.resolution_options.join(" ")}
              />
              <ContextIssueSources sources={conflict.sources} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContextIssueHeading({
  issue
}: {
  issue: Pick<ContextGap | ContextConflict, "severity" | "title">;
}) {
  return (
    <div className="context-analysis-item-heading">
      <strong>{issue.title}</strong>
      <span className={`context-analysis-severity is-${issue.severity}`}>
        {formatSeverity(issue.severity)}
      </span>
    </div>
  );
}

function ContextIssueDetail({ label, value }: { label: string; value: string }) {
  return (
    <p className="context-analysis-detail">
      <span>{label}</span>
      {value}
    </p>
  );
}

function ContextIssueSources({ sources }: { sources: ContextIssueSource[] }) {
  return (
    <ul aria-label="Source evidence" className="context-analysis-sources">
      {sources.map((source, index) => (
        <li key={`${source.reference}-${index}`}>
          <ContextSourceReference reference={source.reference} />
          <span>{source.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function ContextSourceReference({ reference }: { reference: string }) {
  if (isHttpUrl(reference)) {
    return (
      <a href={reference} rel="noreferrer" target="_blank">
        {reference}
      </a>
    );
  }

  return <code>{reference}</code>;
}

function contextUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/context`;
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? "at an unknown time" : date.toLocaleString();
}

function formatSeverity(severity: ContextGap["severity"]): string {
  return `${severity.slice(0, 1).toUpperCase()}${severity.slice(1)}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
