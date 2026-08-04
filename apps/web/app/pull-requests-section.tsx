"use client";

import type { ProjectPullRequest } from "@supply-flow/core/pull-request";
import type { ProjectRecord } from "@supply-flow/core/project";
import { ExternalLink, GitPullRequest, ListPlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

export function PullRequestsSection({ project }: { project: ProjectRecord }) {
  const [pullRequests, setPullRequests] = useState<ProjectPullRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [removingPullRequest, setRemovingPullRequest] = useState<ProjectPullRequest | null>(
    null
  );
  const urlInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let ignoreResult = false;

    async function loadPullRequests() {
      setIsLoading(true);
      setListError("");

      try {
        const response = await fetch(pullRequestsUrl(project.project_id), { cache: "no-store" });
        const data = (await response.json()) as { prs?: ProjectPullRequest[]; error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load project pull requests.");
        }

        if (!ignoreResult) {
          setPullRequests(data.prs ?? []);
        }
      } catch (error) {
        if (!ignoreResult) {
          setPullRequests([]);
          setListError(
            error instanceof Error ? error.message : "Unable to load project pull requests."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoading(false);
        }
      }
    }

    void loadPullRequests();
    return () => {
      ignoreResult = true;
    };
  }, [project.project_id]);

  useEffect(() => {
    if (isImportDialogOpen) {
      urlInput.current?.focus();
    }
  }, [isImportDialogOpen]);

  useEffect(() => {
    if (!isImportDialogOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) {
        closeImportDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isImportDialogOpen, isSaving]);

  function openImportDialog() {
    setPullRequestUrl("");
    setDialogError("");
    setIsImportDialogOpen(true);
  }

  function closeImportDialog() {
    if (!isSaving) {
      setIsImportDialogOpen(false);
      setDialogError("");
    }
  }

  async function importPullRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = pullRequestUrl.trim();
    if (!url) {
      setDialogError("Enter a GitHub pull request link.");
      return;
    }

    setIsSaving(true);
    setDialogError("");
    setListError("");

    try {
      const response = await fetch(pullRequestsUrl(project.project_id), {
        body: JSON.stringify({ url }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as {
        pullRequest?: ProjectPullRequest;
        error?: string;
      };
      if (!response.ok || !data.pullRequest) {
        throw new Error(data.error ?? "Unable to import the pull request.");
      }

      setPullRequests((currentPullRequests) =>
        sortPullRequests([...currentPullRequests, data.pullRequest as ProjectPullRequest])
      );
      setIsImportDialogOpen(false);
      setPullRequestUrl("");
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Unable to import the pull request."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function removePullRequest(pullRequest: ProjectPullRequest) {
    if (removingPullRequest) {
      return;
    }

    setRemovingPullRequest(pullRequest);
    setListError("");

    try {
      const response = await fetch(removePullRequestUrl(project.project_id, pullRequest.url), {
        method: "DELETE"
      });
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) {
        throw new Error(data.error ?? "Unable to remove the pull request.");
      }

      setPullRequests((currentPullRequests) =>
        currentPullRequests.filter((currentPullRequest) => currentPullRequest.url !== pullRequest.url)
      );
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Unable to remove the pull request."
      );
    } finally {
      setRemovingPullRequest(null);
    }
  }

  return (
    <>
      <section aria-labelledby="pull-requests-heading" className="pull-requests-section">
        <div className="pull-requests-section-header">
          <div>
            <p>GitHub review</p>
            <h2 id="pull-requests-heading">Pull requests</h2>
          </div>
          <button
            className="import-pull-request-button"
            disabled={isLoading || Boolean(removingPullRequest)}
            onClick={openImportDialog}
            type="button"
          >
            <ListPlus aria-hidden="true" />
            <span>Import PR</span>
          </button>
        </div>

        {listError ? (
          <p className="create-project-error" role="alert">
            {listError}
          </p>
        ) : null}

        {isLoading ? (
          <div className="pull-request-empty-state">
            <GitPullRequest aria-hidden="true" />
            <div>
              <strong>Loading pull requests...</strong>
            </div>
          </div>
        ) : pullRequests.length === 0 ? (
          <div className="pull-request-empty-state">
            <GitPullRequest aria-hidden="true" />
            <div>
              <strong>No pull requests</strong>
              <span>Import a GitHub pull request for an associated repository.</span>
            </div>
          </div>
        ) : (
          <ul className="pull-request-list">
            {pullRequests.map((pullRequest) => {
              const repository = project.repos.find(
                (currentRepository) => currentRepository.local === pullRequest.repository_local
              );
              const isRemoving = removingPullRequest?.url === pullRequest.url;

              return (
                <li key={pullRequest.url}>
                  <div className="pull-request-details">
                    <strong>{pullRequest.title}</strong>
                    <span>
                      #{pullRequest.number} · {pullRequest.branch}
                    </span>
                    <span>{repository?.name ?? "Removed repository"}</span>
                    <a href={pullRequest.url} rel="noreferrer" target="_blank">
                      <ExternalLink aria-hidden="true" />
                      <code>{pullRequest.url}</code>
                    </a>
                  </div>
                  <div className="repository-actions">
                    <button
                      aria-label={`Remove pull request #${pullRequest.number}`}
                      className="repository-icon-button is-danger"
                      disabled={Boolean(removingPullRequest)}
                      onClick={() => void removePullRequest(pullRequest)}
                      title={`Remove pull request #${pullRequest.number}`}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                    {isRemoving ? (
                      <span className="sr-only">Removing pull request #{pullRequest.number}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isImportDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeImportDialog();
            }
          }}
        >
          <section
            aria-labelledby="pull-request-dialog-title"
            aria-modal="true"
            className="create-project-dialog pull-request-dialog"
            role="dialog"
          >
            <h2 id="pull-request-dialog-title">Import pull request</h2>
            <form onSubmit={importPullRequest}>
              <div className="pull-request-form-fields">
                <label htmlFor="pull-request-url">
                  <span>GitHub pull request link</span>
                  <input
                    autoCapitalize="none"
                    autoComplete="off"
                    disabled={isSaving}
                    id="pull-request-url"
                    maxLength={2048}
                    onChange={(event) => setPullRequestUrl(event.target.value)}
                    placeholder="https://github.com/owner/repository/pull/123"
                    ref={urlInput}
                    required
                    spellCheck={false}
                    type="url"
                    value={pullRequestUrl}
                  />
                </label>
              </div>
              {dialogError ? (
                <p className="create-project-error" role="alert">
                  {dialogError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isSaving}
                  onClick={closeImportDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="dialog-primary-button" disabled={isSaving} type="submit">
                  <GitPullRequest aria-hidden="true" />
                  <span>{isSaving ? "Importing..." : "Import PR"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

function pullRequestsUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/pull-requests`;
}

function removePullRequestUrl(projectId: string, pullRequestUrl: string): string {
  const url = new URL(pullRequestsUrl(projectId), window.location.origin);
  url.searchParams.set("url", pullRequestUrl);
  return `${url.pathname}${url.search}`;
}

function sortPullRequests(pullRequests: ProjectPullRequest[]): ProjectPullRequest[] {
  return [...pullRequests].sort(
    (first, second) =>
      first.repository_local.localeCompare(second.repository_local) ||
      second.number - first.number ||
      first.url.localeCompare(second.url)
  );
}
