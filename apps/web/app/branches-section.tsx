"use client";

import {
  isTrackableProjectBranchName,
  type ProjectBranch
} from "@supply-flow/core/branch";
import type { ProjectRecord } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import {
  GitBranch,
  GitPullRequest,
  ListPlus,
  MessageSquare,
  Pencil,
  Trash2
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

type BranchDialogMode = "import" | "edit" | null;

interface BranchForm {
  name: string;
  repository_local: string;
  jira_ticket: string;
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
  const repositoryInput = useRef<HTMLSelectElement>(null);
  const hasRepositories = project.repos.length > 0;

  useEffect(() => {
    let ignoreResult = false;

    async function loadBranches() {
      setIsLoading(true);
      setListError("");

      try {
        const response = await fetch(branchesUrl(project.project_id), { cache: "no-store" });
        const data = (await response.json()) as { branches?: ProjectBranch[]; error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load project branches.");
        }

        if (!ignoreResult) {
          setBranches(data.branches ?? []);
        }
      } catch (error) {
        if (!ignoreResult) {
          setBranches([]);
          setListError(
            error instanceof Error ? error.message : "Unable to load project branches."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoading(false);
        }
      }
    }

    void loadBranches();
    return () => {
      ignoreResult = true;
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
    if (removingBranch || trackingPullRequest) {
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
    if (removingBranch || trackingPullRequest) {
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
        router.push(
          `/ai_sessions/${encodeURIComponent(project.project_id)}?session=${encodeURIComponent(
            data.session.id
          )}`
        );
      }
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Unable to track the pull request."
      );
    } finally {
      setTrackingPullRequest(null);
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
              const task = project.tasks.find(
                (currentTask) => currentTask.jira_ticket === branch.jira_ticket
              );

              return (
                <li key={`${branch.repository_local}:${branch.name}`}>
                  <div className="branch-details">
                    <strong>{branch.name}</strong>
                    <span>{repository?.name ?? "Removed repository"}</span>
                    <span>{task?.title ?? (branch.jira_ticket ? "Removed task" : "No Jira task")}</span>
                    <code>{branch.repository_local}</code>
                  </div>
                  <div className="repository-actions">
                    {branch.last_session_id ? (
                      <button
                        aria-label={`Open the last AI session for ${branch.name}`}
                        className="repository-icon-button"
                        disabled={Boolean(removingBranch) || Boolean(trackingPullRequest)}
                        onClick={() =>
                          router.push(
                            `/ai_sessions/${encodeURIComponent(
                              project.project_id
                            )}?session=${encodeURIComponent(branch.last_session_id as string)}`
                          )
                        }
                        title={`Open the last AI session for ${branch.name}`}
                        type="button"
                      >
                        <MessageSquare aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      aria-label={`Track pull request for ${branch.name}`}
                      className="repository-icon-button"
                      disabled={Boolean(removingBranch) || Boolean(trackingPullRequest)}
                      onClick={() => void trackPullRequest(branch)}
                      title={`Track pull request for ${branch.name}`}
                      type="button"
                    >
                      <GitPullRequest aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`Edit ${branch.name}`}
                      className="repository-icon-button"
                      disabled={Boolean(removingBranch) || Boolean(trackingPullRequest)}
                      onClick={() => openEditDialog(branch)}
                      title={`Edit ${branch.name}`}
                      type="button"
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`Remove ${branch.name}`}
                      className="repository-icon-button is-danger"
                      disabled={Boolean(removingBranch) || Boolean(trackingPullRequest)}
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
