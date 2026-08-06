"use client";

import {
  isTrackableProjectBranchName,
  type ProjectBranch
} from "@supply-flow/core/branch";
import {
  resolveAiModelDefault,
  type AiModelSettings,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import type { ProjectRecord } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import {
  GitBranch,
  GitPullRequest,
  FileSearch,
  ListPlus,
  MessageSquare,
  Pencil,
  Trash2
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AiSessionConfigurationFields } from "./ai-session-configuration-fields";
import { workspaceTabUrl } from "./workspace-url";

type BranchDialogMode = "import" | "edit" | null;

interface BranchForm {
  name: string;
  repository_local: string;
  jira_ticket: string;
}

interface AiModelSettingsResponse {
  settings?: AiModelSettings;
  error?: string;
}

interface ReviewResult {
  content: string;
  filename: string;
}

interface ReviewResponse {
  branch?: ProjectBranch;
  review?: ReviewResult | null;
  reviewError?: string;
  reviewRequested?: boolean;
  session?: SessionRecord | null;
  reusedSession?: boolean;
  error?: string;
}

const emptyBranchForm: BranchForm = {
  name: "",
  repository_local: "",
  jira_ticket: ""
};

export function BranchesSection({ project }: { project: ProjectRecord }) {
  const router = useRouter();
  const [branches, setBranches] = useState<ProjectBranch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [dialogMode, setDialogMode] = useState<BranchDialogMode>(null);
  const [branchForm, setBranchForm] = useState<BranchForm>(emptyBranchForm);
  const [originalBranch, setOriginalBranch] = useState<ProjectBranch | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [availableError, setAvailableError] = useState("");
  const [isLoadingAvailable, setIsLoadingAvailable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [removingBranch, setRemovingBranch] = useState<ProjectBranch | null>(null);
  const [trackingPullRequest, setTrackingPullRequest] = useState<ProjectBranch | null>(null);
  const [reviewingBranch, setReviewingBranch] = useState<ProjectBranch | null>(null);
  const [reviewDialogBranch, setReviewDialogBranch] = useState<ProjectBranch | null>(null);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [reviewSession, setReviewSession] = useState<SessionRecord | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [reviewDialogError, setReviewDialogError] = useState("");
  const [reviewConfiguration, setReviewConfiguration] =
    useState<ResolvedAiSessionActionSettings | null>(null);
  const [isLoadingReviewConfiguration, setIsLoadingReviewConfiguration] = useState(false);
  const [reviewConfigurationError, setReviewConfigurationError] = useState("");
  const [isUpdatingAutoResolve, setIsUpdatingAutoResolve] = useState(false);
  const repositoryInput = useRef<HTMLSelectElement>(null);
  const hasRepositories = project.repos.length > 0;

  useEffect(() => {
    let ignoreResult = false;

    async function loadBranches(initialLoad: boolean) {
      if (initialLoad) {
        setIsLoading(true);
      }

      try {
        const response = await fetch(branchesUrl(project.project_id), { cache: "no-store" });
        const data = (await response.json()) as { branches?: ProjectBranch[]; error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load project branches.");
        }

        if (!ignoreResult) {
          setBranches(data.branches ?? []);
          setListError("");
        }
      } catch (error) {
        if (!ignoreResult) {
          setListError(
            error instanceof Error ? error.message : "Unable to load project branches."
          );
        }
      } finally {
        if (!ignoreResult && initialLoad) {
          setIsLoading(false);
        }
      }
    }

    void loadBranches(true);
    const interval = window.setInterval(() => {
      void loadBranches(false);
    }, 3_000);
    return () => {
      ignoreResult = true;
      window.clearInterval(interval);
    };
  }, [project.project_id]);

  useEffect(() => {
    if (dialogMode) {
      repositoryInput.current?.focus();
    }
  }, [dialogMode]);

  useEffect(() => {
    if (!dialogMode) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) {
        closeDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialogMode, isSaving]);

  useEffect(() => {
    if (!reviewDialogBranch) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !reviewingBranch) {
        closeReviewDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [reviewDialogBranch, reviewingBranch]);

  useEffect(() => {
    if (!reviewDialogBranch) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadReviewDialog(reviewDialogBranch);
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [
    project.project_id,
    reviewDialogBranch?.name,
    reviewDialogBranch?.repository_local
  ]);

  useEffect(() => {
    let ignoreResult = false;

    async function loadAvailableBranches() {
      if (!dialogMode || !branchForm.repository_local) {
        setAvailableBranches([]);
        setAvailableError("");
        setIsLoadingAvailable(false);
        return;
      }

      setIsLoadingAvailable(true);
      setAvailableError("");

      try {
        const response = await fetch(
          availableBranchesUrl(project.project_id, branchForm.repository_local),
          { cache: "no-store" }
        );
        const data = (await response.json()) as { branches?: string[]; error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load local branches.");
        }

        if (!ignoreResult) {
          setAvailableBranches(
            (data.branches ?? []).filter((branch) => isTrackableProjectBranchName(branch))
          );
        }
      } catch (error) {
        if (!ignoreResult) {
          setAvailableBranches([]);
          setAvailableError(
            error instanceof Error ? error.message : "Unable to load local branches."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoadingAvailable(false);
        }
      }
    }

    void loadAvailableBranches();
    return () => {
      ignoreResult = true;
    };
  }, [branchForm.repository_local, dialogMode, project.project_id]);

  function openImportDialog() {
    setBranchForm({
      name: "",
      repository_local: project.repos[0]?.local ?? "",
      jira_ticket: ""
    });
    setOriginalBranch(null);
    setDialogError("");
    setAvailableError("");
    setDialogMode("import");
  }

  function openEditDialog(branch: ProjectBranch) {
    setBranchForm({
      name: branch.name,
      repository_local: branch.repository_local,
      jira_ticket: branch.jira_ticket ?? ""
    });
    setOriginalBranch(branch);
    setDialogError("");
    setAvailableError("");
    setDialogMode("edit");
  }

  function closeDialog() {
    if (!isSaving) {
      setDialogMode(null);
      setDialogError("");
      setAvailableError("");
    }
  }

  function updateRepository(repositoryLocal: string) {
    setBranchForm((current) => ({
      ...current,
      repository_local: repositoryLocal,
      name: ""
    }));
  }

  async function saveBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialogMode || !branchForm.repository_local || !branchForm.name) {
      setDialogError("Select a repository and branch.");
      return;
    }
    if (dialogMode === "edit" && !originalBranch) {
      return;
    }

    setIsSaving(true);
    setDialogError("");
    setListError("");

    try {
      const response = await fetch(branchesUrl(project.project_id), {
        body: JSON.stringify(
          dialogMode === "import"
            ? {
                name: branchForm.name,
                repositoryLocal: branchForm.repository_local,
                jiraTicket: branchForm.jira_ticket || null
              }
            : {
                current: toRequestBranch(originalBranch as ProjectBranch),
                branch: {
                  name: branchForm.name,
                  repositoryLocal: branchForm.repository_local,
                  jiraTicket: branchForm.jira_ticket || null
                }
              }
        ),
        headers: { "Content-Type": "application/json" },
        method: dialogMode === "import" ? "POST" : "PATCH"
      });
      const data = (await response.json()) as { branch?: ProjectBranch; error?: string };
      if (!response.ok || !data.branch) {
        throw new Error(data.error ?? "Unable to save the branch.");
      }

      setBranches((currentBranches) =>
        sortBranches(
          dialogMode === "import"
            ? [...currentBranches, data.branch as ProjectBranch]
            : currentBranches.map((branch) =>
                isSameBranch(branch, originalBranch as ProjectBranch)
                  ? (data.branch as ProjectBranch)
                  : branch
              )
        )
      );
      setDialogMode(null);
      setBranchForm(emptyBranchForm);
      setOriginalBranch(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Unable to save the branch.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeBranch(branch: ProjectBranch) {
    if (removingBranch || trackingPullRequest || reviewingBranch) {
      return;
    }

    setRemovingBranch(branch);
    setListError("");

    try {
      const response = await fetch(removeBranchUrl(project.project_id, branch), {
        method: "DELETE"
      });
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) {
        throw new Error(data.error ?? "Unable to remove the branch.");
      }

      setBranches((currentBranches) =>
        currentBranches.filter((currentBranch) => !isSameBranch(currentBranch, branch))
      );
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Unable to remove the branch.");
    } finally {
      setRemovingBranch(null);
    }
  }

  async function trackPullRequest(branch: ProjectBranch) {
    if (removingBranch || trackingPullRequest || reviewingBranch) {
      return;
    }

    setTrackingPullRequest(branch);
    setListError("");

    try {
      const response = await fetch(trackPullRequestUrl(project.project_id), {
        body: JSON.stringify(toRequestBranch(branch)),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to track the pull request.");
      }

      if (data.session) {
        router.push(workspaceTabUrl("/ai_sessions", project.project_id, data.session.id));
      }
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Unable to track the pull request."
      );
    } finally {
      setTrackingPullRequest(null);
    }
  }

  function openReviewDialog(branch: ProjectBranch) {
    if (removingBranch || trackingPullRequest || reviewingBranch) {
      return;
    }

    setReviewDialogBranch(branch);
    setReviewResult(null);
    setReviewSession(null);
    setReviewDialogError("");
    setReviewConfiguration(null);
    setReviewConfigurationError("");
    setIsUpdatingAutoResolve(false);
    setIsLoadingReview(true);
    setIsLoadingReviewConfiguration(true);

    void loadReviewDialog(branch);
    void loadReviewConfiguration();
  }

  function closeReviewDialog(force = false) {
    if (!reviewingBranch || force) {
      setReviewDialogBranch(null);
      setReviewResult(null);
      setReviewSession(null);
      setReviewDialogError("");
      setReviewConfiguration(null);
      setReviewConfigurationError("");
      setIsUpdatingAutoResolve(false);
    }
  }

  async function loadReviewDialog(branch: ProjectBranch) {
    try {
      const response = await fetch(reviewDetailsUrl(project.project_id, branch), {
        cache: "no-store"
      });
      const data = (await response.json()) as ReviewResponse;
      if (!response.ok || !data.branch) {
        throw new Error(data.error ?? "Unable to load the branch review.");
      }

      setBranches((currentBranches) =>
        currentBranches.map((currentBranch) =>
          isSameBranch(currentBranch, branch) ? data.branch as ProjectBranch : currentBranch
        )
      );
      setReviewDialogBranch(data.branch);
      setReviewResult(data.review ?? null);
      setReviewSession(data.session ?? null);
      setReviewDialogError(data.reviewError ?? "");
    } catch (error) {
      setReviewDialogError(
        error instanceof Error ? error.message : "Unable to load the branch review."
      );
    } finally {
      setIsLoadingReview(false);
    }
  }

  async function loadReviewConfiguration() {
    try {
      const response = await fetch("/api/settings/ai-models", { cache: "no-store" });
      const data = (await response.json()) as AiModelSettingsResponse;
      if (!response.ok || !data.settings) {
        throw new Error(data.error ?? "Unable to load AI review defaults.");
      }

      setReviewConfiguration(resolveAiModelDefault(data.settings, "review-code"));
    } catch (error) {
      setReviewConfigurationError(
        error instanceof Error ? error.message : "Unable to load AI review defaults."
      );
    } finally {
      setIsLoadingReviewConfiguration(false);
    }
  }

  function openReviewSession() {
    if (!reviewSession || reviewingBranch) {
      return;
    }

    closeReviewDialog();
    router.push(workspaceTabUrl("/ai_sessions", project.project_id, reviewSession.id));
  }

  async function toggleAutoResolve() {
    if (!reviewDialogBranch || reviewingBranch || isUpdatingAutoResolve) {
      return;
    }

    setIsUpdatingAutoResolve(true);
    setReviewDialogError("");
    try {
      const response = await fetch(autoResolveUrl(project.project_id), {
        body: JSON.stringify({
          name: reviewDialogBranch.name,
          repositoryLocal: reviewDialogBranch.repository_local,
          autoResolve: !reviewDialogBranch.auto_resolve
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { branch?: ProjectBranch; error?: string };
      if (!response.ok || !data.branch) {
        throw new Error(data.error ?? "Unable to update Auto resolve.");
      }

      const updatedBranch = data.branch;
      setBranches((currentBranches) =>
        currentBranches.map((branch) =>
          isSameBranch(branch, reviewDialogBranch) ? updatedBranch : branch
        )
      );
      setReviewDialogBranch(updatedBranch);
    } catch (error) {
      setReviewDialogError(
        error instanceof Error ? error.message : "Unable to update Auto resolve."
      );
    } finally {
      setIsUpdatingAutoResolve(false);
    }
  }

  async function reviewAgain() {
    if (!reviewDialogBranch || reviewingBranch) {
      return;
    }
    if (!reviewSession && !reviewConfiguration) {
      setReviewDialogError(
        reviewConfigurationError || "AI review defaults are still loading. Try again shortly."
      );
      return;
    }

    setReviewingBranch(reviewDialogBranch);
    setReviewDialogError("");

    try {
      const response = await fetch(reviewBranchUrl(project.project_id), {
        body: JSON.stringify({
          name: reviewDialogBranch.name,
          repositoryLocal: reviewDialogBranch.repository_local,
          ...(reviewSession || !reviewConfiguration
            ? {}
            : { sessionConfiguration: reviewConfiguration })
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as ReviewResponse;
      if (!response.ok || !data.branch || !data.session) {
        throw new Error(data.error ?? "Unable to start the branch review.");
      }

      setBranches((currentBranches) =>
        currentBranches.map((currentBranch) =>
          isSameBranch(currentBranch, reviewDialogBranch)
            ? (data.branch as ProjectBranch)
            : currentBranch
        )
      );
      closeReviewDialog(true);
      router.push(workspaceTabUrl("/ai_sessions", project.project_id, data.session.id));
    } catch (error) {
      setReviewDialogError(
        error instanceof Error ? error.message : "Unable to start the branch review."
      );
    } finally {
      setReviewingBranch(null);
    }
  }

  const branchChoices = Array.from(new Set([branchForm.name, ...availableBranches])).filter(Boolean);

  return (
    <>
      <section aria-labelledby="branches-heading" className="branch-section">
        <div className="branch-section-header">
          <div>
            <p>Repository scopes</p>
            <h2 id="branches-heading">Branches</h2>
          </div>
          <button
            className="import-branch-button"
            disabled={!hasRepositories || isLoading}
            onClick={openImportDialog}
            type="button"
          >
            <ListPlus aria-hidden="true" />
            <span>Import branch</span>
          </button>
        </div>

        {listError ? (
          <p className="create-project-error" role="alert">
            {listError}
          </p>
        ) : null}

        {isLoading ? (
          <div className="branch-empty-state">
            <GitBranch aria-hidden="true" />
            <div>
              <strong>Loading branches...</strong>
            </div>
          </div>
        ) : branches.length === 0 ? (
          <div className="branch-empty-state">
            <GitBranch aria-hidden="true" />
            <div>
              <strong>No branches</strong>
              <span>Import a local branch from an associated repository.</span>
            </div>
          </div>
        ) : (
          <ul className="branch-list">
            {branches.map((branch) => {
              const repository = project.repos.find(
                (currentRepository) => currentRepository.local === branch.repository_local
              );
              const isRemoving = isSameBranch(removingBranch, branch);
              const isTrackingPullRequest = isSameBranch(trackingPullRequest, branch);
              const isReviewing = isSameBranch(reviewingBranch, branch);
              const task = project.tasks.find(
                (currentTask) => currentTask.jira_ticket === branch.jira_ticket
              );
              const isBranchActionPending = Boolean(
                removingBranch || trackingPullRequest || reviewingBranch
              );

              return (
                <li key={`${branch.repository_local}:${branch.name}`}>
                  <div className="branch-details">
                    <strong>{branch.name}</strong>
                    <span>{repository?.name ?? "Removed repository"}</span>
                    <span>{task?.title ?? (branch.jira_ticket ? "Removed task" : "No Jira task")}</span>
                    <span className={`branch-review-state is-${branch.review_state}`}>
                      {reviewStateLabel(branch.review_state)}
                    </span>
                    <code>{branch.repository_local}</code>
                  </div>
                  <div className="repository-actions">
                    {branch.last_session_id ? (
                      <button
                        aria-label={`Open the last AI session for ${branch.name}`}
                        className="repository-icon-button"
                        disabled={isBranchActionPending}
                        onClick={() =>
                          router.push(
                            workspaceTabUrl(
                              "/ai_sessions",
                              project.project_id,
                              branch.last_session_id as string
                            )
                          )
                        }
                        title={`Open the last AI session for ${branch.name}`}
                        type="button"
                      >
                        <MessageSquare aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      aria-label={`Review ${branch.name}`}
                      className="review-branch-button"
                      disabled={isBranchActionPending || !task}
                      onClick={() => openReviewDialog(branch)}
                      title={
                        task
                          ? `Review code for ${branch.name}`
                          : "Associate a tracked Jira task before reviewing this branch"
                      }
                      type="button"
                    >
                      <FileSearch aria-hidden="true" />
                      <span>{isReviewing ? "Reviewing..." : "Review"}</span>
                    </button>
                    <button
                      aria-label={`Track pull request for ${branch.name}`}
                      className="repository-icon-button"
                      disabled={isBranchActionPending}
                      onClick={() => void trackPullRequest(branch)}
                      title={`Track pull request for ${branch.name}`}
                      type="button"
                    >
                      <GitPullRequest aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`Edit ${branch.name}`}
                      className="repository-icon-button"
                      disabled={isBranchActionPending}
                      onClick={() => openEditDialog(branch)}
                      title={`Edit ${branch.name}`}
                      type="button"
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`Remove ${branch.name}`}
                      className="repository-icon-button is-danger"
                      disabled={isBranchActionPending}
                      onClick={() => void removeBranch(branch)}
                      title={`Remove ${branch.name}`}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                    {isRemoving ? <span className="sr-only">Removing {branch.name}</span> : null}
                    {isTrackingPullRequest ? (
                      <span className="sr-only">Finding pull request for {branch.name}</span>
                    ) : null}
                    {isReviewing ? <span className="sr-only">Starting review for {branch.name}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {reviewDialogBranch ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeReviewDialog();
            }
          }}
        >
          <section
            aria-labelledby="review-dialog-title"
            aria-modal="true"
            className="create-project-dialog review-dialog"
            role="dialog"
          >
            <div className="review-dialog-heading">
              <div>
                <h2 id="review-dialog-title">Review branch</h2>
                <code>{reviewDialogBranch.name}</code>
              </div>
              <div className="review-dialog-status">
                <span className={`branch-review-state is-${reviewDialogBranch.review_state}`}>
                  {reviewStateLabel(reviewDialogBranch.review_state)}
                </span>
                {reviewSession ? <span className="review-session-status">Session active</span> : null}
              </div>
            </div>

            <section aria-labelledby="review-results-heading" className="review-results">
              <div className="review-results-heading">
                <h3 id="review-results-heading">Review results</h3>
                {reviewResult ? <code>{reviewResult.filename}</code> : null}
              </div>
              {isLoadingReview ? (
                <p className="review-results-empty">Loading review results...</p>
              ) : reviewResult ? (
                <pre className="review-results-content">{reviewResult.content}</pre>
              ) : (
                <p className="review-results-empty">No review results.</p>
              )}
            </section>

            <section aria-labelledby="auto-resolve-heading" className="review-auto-resolve">
              <div>
                <h3 id="auto-resolve-heading">Auto resolve</h3>
                <p>Resolve blocking review findings, then request another review.</p>
              </div>
              <button
                aria-checked={reviewDialogBranch.auto_resolve}
                aria-label="Auto resolve"
                className="ai-model-toggle"
                disabled={Boolean(reviewingBranch) || isUpdatingAutoResolve}
                onClick={() => void toggleAutoResolve()}
                role="switch"
                title={
                  reviewDialogBranch.auto_resolve
                    ? "Disable Auto resolve"
                    : "Enable Auto resolve"
                }
                type="button"
              >
                <span aria-hidden="true" />
              </button>
            </section>

            <section aria-labelledby="review-configuration-heading" className="review-configuration">
              <h3 id="review-configuration-heading">Review configuration</h3>
              <AiSessionConfigurationFields
                configuration={reviewConfiguration}
                disabled={
                  Boolean(reviewSession) ||
                  Boolean(reviewingBranch) ||
                  isLoadingReviewConfiguration
                }
                idPrefix="review"
                isLoading={isLoadingReviewConfiguration}
                onChange={setReviewConfiguration}
              />
            </section>

            {reviewConfigurationError || reviewDialogError ? (
              <p className="create-project-error" role="alert">
                {reviewConfigurationError || reviewDialogError}
              </p>
            ) : null}

            <div className="dialog-actions">
              <button
                className="dialog-cancel-button"
                disabled={Boolean(reviewingBranch)}
                onClick={() => closeReviewDialog()}
                type="button"
              >
                Cancel
              </button>
              {reviewSession ? (
                <button
                  className="dialog-primary-button"
                  disabled={Boolean(reviewingBranch)}
                  onClick={openReviewSession}
                  type="button"
                >
                  <MessageSquare aria-hidden="true" />
                  <span>Open review session</span>
                </button>
              ) : null}
              <button
                className="dialog-secondary-button"
                disabled={
                  Boolean(reviewingBranch) ||
                  isLoadingReview ||
                  (!reviewSession &&
                    (isLoadingReviewConfiguration || !reviewConfiguration))
                }
                onClick={() => void reviewAgain()}
                type="button"
              >
                <FileSearch aria-hidden="true" />
                <span>
                  {reviewingBranch
                    ? "Starting..."
                    : "Review again"}
                </span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {dialogMode ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeDialog();
            }
          }}
        >
          <section
            aria-labelledby="branch-dialog-title"
            aria-modal="true"
            className="create-project-dialog branch-dialog"
            role="dialog"
          >
            <h2 id="branch-dialog-title">
              {dialogMode === "import" ? "Import branch" : "Edit branch"}
            </h2>
            <form onSubmit={saveBranch}>
              <div className="branch-form-fields">
                <label htmlFor="branch-repository">
                  <span>Repository</span>
                  <select
                    disabled={isSaving}
                    id="branch-repository"
                    onChange={(event) => updateRepository(event.target.value)}
                    ref={repositoryInput}
                    required
                    value={branchForm.repository_local}
                  >
                    <option value="">Select a repository</option>
                    {project.repos.map((repository) => (
                      <option key={repository.local} value={repository.local}>
                        {repository.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="branch-name">
                  <span>Local branch</span>
                  <select
                    disabled={
                      isSaving ||
                      !branchForm.repository_local ||
                      isLoadingAvailable ||
                      Boolean(availableError)
                    }
                    id="branch-name"
                    onChange={(event) =>
                      setBranchForm((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                    value={branchForm.name}
                  >
                    <option value="">
                      {isLoadingAvailable
                        ? "Loading local branches..."
                        : branchChoices.length === 0
                          ? "No local branches"
                          : "Select a branch"}
                    </option>
                    {branchChoices.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="branch-task">
                  <span>Jira task</span>
                  <select
                    disabled={isSaving}
                    id="branch-task"
                    onChange={(event) =>
                      setBranchForm((current) => ({
                        ...current,
                        jira_ticket: event.target.value
                      }))
                    }
                    value={branchForm.jira_ticket}
                  >
                    <option value="">No associated task</option>
                    {project.tasks.map((task) => (
                      <option key={task.jira_ticket} value={task.jira_ticket}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {availableError || dialogError ? (
                <p className="create-project-error" role="alert">
                  {availableError || dialogError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isSaving}
                  onClick={closeDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="dialog-primary-button" disabled={isSaving} type="submit">
                  <GitBranch aria-hidden="true" />
                  <span>
                    {isSaving
                      ? "Saving..."
                      : dialogMode === "import"
                        ? "Import branch"
                        : "Save branch"}
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

function branchesUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/branches`;
}

function availableBranchesUrl(projectId: string, repositoryLocal: string): string {
  const url = new URL(branchesUrl(projectId), window.location.origin);
  url.pathname += "/available";
  url.searchParams.set("repositoryLocal", repositoryLocal);
  return `${url.pathname}${url.search}`;
}

function removeBranchUrl(projectId: string, branch: ProjectBranch): string {
  const url = new URL(branchesUrl(projectId), window.location.origin);
  url.searchParams.set("name", branch.name);
  url.searchParams.set("repositoryLocal", branch.repository_local);
  return `${url.pathname}${url.search}`;
}

function trackPullRequestUrl(projectId: string): string {
  return `${branchesUrl(projectId)}/track-pr`;
}

function reviewBranchUrl(projectId: string): string {
  return `${branchesUrl(projectId)}/review`;
}

function reviewDetailsUrl(projectId: string, branch: ProjectBranch): string {
  const url = new URL(reviewBranchUrl(projectId), window.location.origin);
  url.searchParams.set("name", branch.name);
  url.searchParams.set("repositoryLocal", branch.repository_local);
  return `${url.pathname}${url.search}`;
}

function autoResolveUrl(projectId: string): string {
  return `${branchesUrl(projectId)}/auto-resolve`;
}

function toRequestBranch(branch: ProjectBranch): {
  name: string;
  repositoryLocal: string;
  jiraTicket: string | null;
} {
  return {
    name: branch.name,
    repositoryLocal: branch.repository_local,
    jiraTicket: branch.jira_ticket
  };
}

function isSameBranch(first: ProjectBranch | null, second: ProjectBranch): boolean {
  return (
    first !== null &&
    first.name === second.name &&
    first.repository_local === second.repository_local
  );
}

function sortBranches(branches: ProjectBranch[]): ProjectBranch[] {
  return [...branches].sort(
    (first, second) =>
      first.repository_local.localeCompare(second.repository_local) || first.name.localeCompare(second.name)
  );
}

function reviewStateLabel(state: ProjectBranch["review_state"]): string {
  switch (state) {
    case "coding":
      return "Coding";
    case "code_complete":
      return "Code complete";
    case "reviewing":
      return "Reviewing";
    case "review_issue_found":
      return "Review issues found";
    case "review_passed":
      return "Review passed";
  }
}
