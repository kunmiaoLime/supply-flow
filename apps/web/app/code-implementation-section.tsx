"use client";

import type { ProjectBranch } from "@supply-flow/core/branch";
import type { ProjectRecord } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { Code2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

const MAX_INSTRUCTIONS_LENGTH = 6_000;

export function CodeImplementationSection({ project }: { project: ProjectRecord }) {
  const router = useRouter();
  const [jiraTicket, setJiraTicket] = useState("");
  const [repositoryLocal, setRepositoryLocal] = useState("");
  const [parentBranch, setParentBranch] = useState("master");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [branches, setBranches] = useState<ProjectBranch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [branchError, setBranchError] = useState("");
  const hasTasks = project.tasks.length > 0;
  const hasRepositories = project.repos.length > 0;

  useEffect(() => {
    setJiraTicket("");
    setRepositoryLocal("");
    setParentBranch("master");
    setInstructions("");
    setError("");
  }, [project.project_id]);

  useEffect(() => {
    let ignoreResult = false;

    async function loadBranches() {
      setIsLoadingBranches(true);
      setBranchError("");

      try {
        const response = await fetch(branchesUrl(project.project_id), { cache: "no-store" });
        const data = (await response.json()) as { branches?: ProjectBranch[]; error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load project branches.");
        }

        if (!ignoreResult) {
          setBranches(data.branches ?? []);
        }
      } catch (loadError) {
        if (!ignoreResult) {
          setBranches([]);
          setBranchError(
            loadError instanceof Error ? loadError.message : "Unable to load project branches."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoadingBranches(false);
        }
      }
    }

    void loadBranches();
    return () => {
      ignoreResult = true;
    };
  }, [project.project_id]);

  const parentBranchChoices = [
    "master",
    ...branches
      .filter((branch) => branch.repository_local === repositoryLocal)
      .map((branch) => branch.name)
      .filter((branch) => branch !== "master")
  ];

  async function startImplementation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jiraTicket || !repositoryLocal || !parentBranch || isStarting) {
      setError("Select a task, repository, and parent branch.");
      return;
    }

    setIsStarting(true);
    setError("");

    try {
      const response = await fetch(implementationSessionUrl(project.project_id), {
        body: JSON.stringify({
          jiraTicket,
          repositoryLocal,
          parentBranch,
          ...(instructions.trim() ? { instructions: instructions.trim() } : {})
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to start the implementation session.");
      }

      router.push(
        `/ai_sessions/${encodeURIComponent(project.project_id)}?session=${encodeURIComponent(
          data.session.id
        )}`
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to start the implementation session."
      );
    } finally {
      setIsStarting(false);
    }
  }

  function selectRepository(local: string) {
    setRepositoryLocal(local);
    setParentBranch("master");
  }

  return (
    <section aria-labelledby="code-implementation-heading" className="code-implementation-section">
      <div className="code-implementation-section-header">
        <div>
          <p>Jira delivery</p>
          <h2 id="code-implementation-heading">Code implementation</h2>
        </div>
      </div>

      <form className="code-implementation-form" onSubmit={startImplementation}>
        <div className="implementation-selection-grid">
          <label htmlFor="implementation-task">
            <span>Task</span>
            <select
              disabled={!hasTasks || isStarting}
              id="implementation-task"
              onChange={(event) => setJiraTicket(event.target.value)}
              required
              value={jiraTicket}
            >
              <option value="">{hasTasks ? "Select a task" : "No tracked tasks"}</option>
              {project.tasks.map((task) => (
                <option key={task.jira_ticket} value={task.jira_ticket}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="implementation-repository">
            <span>Repository</span>
            <select
              disabled={!hasRepositories || isStarting}
              id="implementation-repository"
              onChange={(event) => selectRepository(event.target.value)}
              required
              value={repositoryLocal}
            >
              <option value="">
                {hasRepositories ? "Select a repository" : "No associated repositories"}
              </option>
              {project.repos.map((repository) => (
                <option key={repository.local} value={repository.local}>
                  {repository.name}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="implementation-parent-branch">
            <span>Parent branch</span>
            <select
              disabled={
                !repositoryLocal || isStarting || isLoadingBranches || Boolean(branchError)
              }
              id="implementation-parent-branch"
              onChange={(event) => setParentBranch(event.target.value)}
              required
              value={parentBranch}
            >
              {!repositoryLocal ? (
                <option value="">Select a repository first</option>
              ) : (
                <>
                  <option value="master">master</option>
                  {parentBranchChoices
                    .filter((branch) => branch !== "master")
                    .map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                </>
              )}
            </select>
          </label>
        </div>

        <label className="implementation-instructions-field" htmlFor="implementation-instructions">
          <span>Additional instructions (optional)</span>
          <textarea
            disabled={isStarting}
            id="implementation-instructions"
            maxLength={MAX_INSTRUCTIONS_LENGTH}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Add task-specific constraints or implementation notes."
            rows={6}
            value={instructions}
          />
        </label>

        {branchError || error ? (
          <p className="create-project-error" role="alert">
            {branchError || error}
          </p>
        ) : null}

        <div className="implementation-actions">
          <button
            className="start-implementation-button"
            disabled={
              !hasTasks ||
              !hasRepositories ||
              !jiraTicket ||
              !repositoryLocal ||
              !parentBranch ||
              isLoadingBranches ||
              Boolean(branchError) ||
              isStarting
            }
            type="submit"
          >
            {isStarting ? <Code2 aria-hidden="true" /> : <Play aria-hidden="true" />}
            <span>{isStarting ? "Starting..." : "Start implementation"}</span>
          </button>
        </div>
      </form>
    </section>
  );
}

function branchesUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/branches`;
}

function implementationSessionUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/implementation-sessions`;
}
