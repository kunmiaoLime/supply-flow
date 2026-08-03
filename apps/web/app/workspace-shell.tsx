"use client";

import type { ProjectRecord } from "@supply-flow/core/project";
import {
  Braces,
  CheckCircle2,
  Code2,
  FolderKanban,
  GitPullRequest,
  ListTodo,
  Plus,
  Settings2,
  TerminalSquare,
  type LucideIcon
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type TabId = "project" | "task-plan" | "code-implementation" | "pr" | "settings";

interface NavigationTab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const navigationTabs: readonly NavigationTab[] = [
  { id: "project", label: "Project", icon: FolderKanban },
  { id: "task-plan", label: "Task plan", icon: ListTodo },
  { id: "code-implementation", label: "Code implementation", icon: Code2 },
  { id: "pr", label: "PR", icon: GitPullRequest },
  { id: "settings", label: "Settings", icon: Settings2 }
];

const tabHeadings: Record<TabId, { eyebrow: string; title: string; description: string }> = {
  project: {
    eyebrow: "Workspace",
    title: "Project",
    description: "Project environment and runtime assumptions."
  },
  "task-plan": {
    eyebrow: "Delivery",
    title: "Task plan",
    description: "The current execution plan for this workspace."
  },
  "code-implementation": {
    eyebrow: "Workspace",
    title: "Code implementation",
    description: "Implementation boundaries and current source layout."
  },
  pr: {
    eyebrow: "Delivery",
    title: "Pull request",
    description: "Review state for the current workspace."
  },
  settings: {
    eyebrow: "Workspace",
    title: "Settings",
    description: "Local runner and session defaults."
  }
};

export function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<TabId>("project");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isCreateProjectDialogOpen, setIsCreateProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creationError, setCreationError] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const projectNameInput = useRef<HTMLInputElement>(null);
  const tabPanelId = useId();
  const heading = tabHeadings[activeTab];
  const selectedProject = projects.find((project) => project.project_id === selectedProjectId);
  const panelEyebrow = selectedProject
    ? `${selectedProject.project_name} / ${heading.eyebrow}`
    : heading.eyebrow;
  const panelDescription = selectedProject
    ? heading.description
    : "Select a project from the top panel to view this content.";

  useEffect(() => {
    let ignoreResult = false;

    async function loadProjects() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to load projects.");
        }

        const data = (await response.json()) as { projects?: ProjectRecord[] };
        if (!ignoreResult) {
          setProjects(data.projects ?? []);
        }
      } catch {
        if (!ignoreResult) {
          setProjects([]);
        }
      } finally {
        if (!ignoreResult) {
          setIsLoadingProjects(false);
        }
      }
    }

    void loadProjects();
    return () => {
      ignoreResult = true;
    };
  }, []);

  useEffect(() => {
    if (isCreateProjectDialogOpen) {
      projectNameInput.current?.focus();
    }
  }, [isCreateProjectDialogOpen]);

  useEffect(() => {
    if (!isCreateProjectDialogOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isCreatingProject) {
        setIsCreateProjectDialogOpen(false);
        setCreationError("");
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isCreateProjectDialogOpen, isCreatingProject]);

  function openCreateProjectDialog() {
    setNewProjectName("");
    setCreationError("");
    setIsCreateProjectDialogOpen(true);
  }

  function closeCreateProjectDialog() {
    if (!isCreatingProject) {
      setIsCreateProjectDialogOpen(false);
      setCreationError("");
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newProjectName.trim();

    if (!name) {
      setCreationError("Enter a project name.");
      return;
    }

    setIsCreatingProject(true);
    setCreationError("");

    try {
      const response = await fetch("/api/projects", {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { error?: string; project?: ProjectRecord };

      if (!response.ok || !data.project) {
        throw new Error(data.error ?? "Unable to create the project.");
      }

      setProjects((currentProjects) => [data.project as ProjectRecord, ...currentProjects]);
      setSelectedProjectId(data.project.project_id);
      setIsCreateProjectDialogOpen(false);
      setNewProjectName("");
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : "Unable to create the project.");
    } finally {
      setIsCreatingProject(false);
    }
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Supply Flow</strong>
            <span>Session workspace</span>
          </div>
        </div>

        <div className="project-controls">
          <label
            className={`project-selector${selectedProject ? "" : " is-placeholder"}`}
          >
            <FolderKanban aria-hidden="true" />
            <span className="sr-only">Current project</span>
            <select
              aria-label="Current project"
              onChange={(event) => setSelectedProjectId(event.target.value)}
              value={selectedProjectId}
            >
              <option disabled value="">
                {isLoadingProjects ? "Loading projects..." : "Select a project"}
              </option>
              {projects.map((project) => (
                <option key={project.project_id} value={project.project_id}>
                  {project.project_name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="create-project-button"
            onClick={openCreateProjectDialog}
            type="button"
          >
            <Plus aria-hidden="true" />
            <span>Create project</span>
          </button>
        </div>
        <span className="local-status">
          <span />
          Local
        </span>
      </header>

      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <nav className="workspace-nav" role="tablist" aria-orientation="vertical">
          {navigationTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;

            return (
              <button
                aria-controls={tabPanelId}
                aria-selected={isActive}
                className={`workspace-nav-tab${isActive ? " is-active" : ""}`}
                id={`tab-${tab.id}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="workspace-sidebar-footer">
          <span className="footer-status" aria-hidden="true">
            <CheckCircle2 />
          </span>
          <div>
            <strong>Local runner</strong>
            <span>tmux available</span>
          </div>
        </div>
      </aside>

      <main className="workspace-main">
        <section
          aria-labelledby={`tab-${activeTab}`}
          className="workspace-panel"
          id={tabPanelId}
          role="tabpanel"
        >
          <div className="panel-heading">
            <p>{panelEyebrow}</p>
            <h1>{heading.title}</h1>
            <span>{panelDescription}</span>
          </div>
          <PanelContent project={selectedProject} tab={activeTab} />
        </section>
      </main>

      {isCreateProjectDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeCreateProjectDialog();
            }
          }}
        >
          <section
            aria-labelledby="create-project-title"
            aria-modal="true"
            className="create-project-dialog"
            role="dialog"
          >
            <h2 id="create-project-title">Create project</h2>
            <form onSubmit={createProject}>
              <label className="project-name-field" htmlFor="project-name">
                <span>Project name</span>
                <input
                  autoComplete="off"
                  id="project-name"
                  maxLength={120}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="Project name"
                  ref={projectNameInput}
                  required
                  type="text"
                  value={newProjectName}
                />
              </label>
              {creationError ? (
                <p className="create-project-error" role="alert">
                  {creationError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isCreatingProject}
                  onClick={closeCreateProjectDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="create-project-button" disabled={isCreatingProject} type="submit">
                  <Plus aria-hidden="true" />
                  <span>{isCreatingProject ? "Creating..." : "Create project"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PanelContent({
  project,
  tab
}: {
  project: ProjectRecord | undefined;
  tab: TabId;
}) {
  if (!project) {
    return (
      <div className="empty-state project-selection-state">
        <FolderKanban aria-hidden="true" />
        <div>
          <strong>Select a project</strong>
          <span>Select a project from the top panel to view {tabHeadings[tab].title}.</span>
        </div>
      </div>
    );
  }

  switch (tab) {
    case "project":
      return (
        <dl className="detail-list">
          <div>
            <dt>Session runtime</dt>
            <dd>tmux-backed terminal sessions</dd>
          </div>
          <div>
            <dt>Provider boundary</dt>
            <dd>Codex, Claude Code, and Gemini CLI adapters</dd>
          </div>
          <div>
            <dt>Workspace isolation</dt>
            <dd>One Git worktree per AI session</dd>
          </div>
          <div>
            <dt>Local persistence</dt>
            <dd>JSON metadata and NDJSON event history</dd>
          </div>
        </dl>
      );
    case "task-plan":
      return (
        <ol className="task-list">
          <li className="is-complete">
            <CheckCircle2 aria-hidden="true" />
            <div>
              <strong>Workspace foundation</strong>
              <span>Next.js web app, session runner, and shared contracts</span>
            </div>
          </li>
          <li>
            <span className="task-marker">2</span>
            <div>
              <strong>Session workspace</strong>
              <span>Terminal streaming, provider status, and session lifecycle</span>
            </div>
          </li>
          <li>
            <span className="task-marker">3</span>
            <div>
              <strong>Flow authoring</strong>
              <span>Integration context, tasks, and provider-assisted planning</span>
            </div>
          </li>
          <li>
            <span className="task-marker">4</span>
            <div>
              <strong>Review workflow</strong>
              <span>Change review and pull request coordination</span>
            </div>
          </li>
        </ol>
      );
    case "code-implementation":
      return (
        <div className="implementation-list">
          <div>
            <TerminalSquare aria-hidden="true" />
            <div>
              <strong>apps/runner</strong>
              <span>tmux session lifecycle and local command entrypoint</span>
            </div>
          </div>
          <div>
            <Braces aria-hidden="true" />
            <div>
              <strong>packages/core</strong>
              <span>File store, provider adapters, session contracts, and tmux adapter</span>
            </div>
          </div>
          <div>
            <Code2 aria-hidden="true" />
            <div>
              <strong>apps/web</strong>
              <span>Operator workspace and browser-facing session controls</span>
            </div>
          </div>
        </div>
      );
    case "pr":
      return (
        <div className="empty-state">
          <GitPullRequest aria-hidden="true" />
          <div>
            <strong>No pull request</strong>
            <span>The workspace is on the initial commit.</span>
          </div>
        </div>
      );
    case "settings":
      return (
        <dl className="detail-list">
          <div>
            <dt>Runner host</dt>
            <dd>Local development environment</dd>
          </div>
          <div>
            <dt>State directory</dt>
            <dd>
              <code>.supply-flow</code>
            </dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>Not configured</dd>
          </div>
          <div>
            <dt>Session transport</dt>
            <dd>tmux terminal adapter</dd>
          </div>
        </dl>
      );
  }
}
