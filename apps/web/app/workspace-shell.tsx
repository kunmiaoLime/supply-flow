"use client";

import type { ProjectRecord, ProjectRepository } from "@supply-flow/core/project";
import {
  Braces,
  CheckCircle2,
  Code2,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  ListTodo,
  Pencil,
  Plus,
  Settings2,
  TerminalSquare,
  Trash2,
  type LucideIcon
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type TabId = "project" | "task-plan" | "code-implementation" | "pr" | "settings";
type RepositoryDialogMode = "add" | "edit" | null;

interface NavigationTab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

interface RepositoryForm {
  name: string;
  remote: string;
  local: string;
}

const emptyRepositoryForm: RepositoryForm = {
  name: "",
  remote: "",
  local: ""
};

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
    description: ""
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
  const [repositoryDialogMode, setRepositoryDialogMode] =
    useState<RepositoryDialogMode>(null);
  const [editingRepositoryIndex, setEditingRepositoryIndex] = useState<number | null>(null);
  const [repositoryForm, setRepositoryForm] = useState<RepositoryForm>(emptyRepositoryForm);
  const [repositoryError, setRepositoryError] = useState("");
  const [repositoryListError, setRepositoryListError] = useState("");
  const [isSavingRepository, setIsSavingRepository] = useState(false);
  const projectNameInput = useRef<HTMLInputElement>(null);
  const repositoryLocalPathInput = useRef<HTMLInputElement>(null);
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
    if (repositoryDialogMode) {
      repositoryLocalPathInput.current?.focus();
    }
  }, [repositoryDialogMode]);

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

  useEffect(() => {
    if (!repositoryDialogMode) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSavingRepository) {
        setRepositoryDialogMode(null);
        setRepositoryError("");
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSavingRepository, repositoryDialogMode]);

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

  function openAddRepositoryDialog() {
    setRepositoryForm(emptyRepositoryForm);
    setEditingRepositoryIndex(null);
    setRepositoryError("");
    setRepositoryDialogMode("add");
  }

  function openEditRepositoryDialog(index: number) {
    const repository = selectedProject?.repos[index];
    if (!repository) {
      return;
    }

    setRepositoryForm({
      ...repository,
      remote: repository.remote ?? ""
    });
    setEditingRepositoryIndex(index);
    setRepositoryError("");
    setRepositoryDialogMode("edit");
  }

  function closeRepositoryDialog() {
    if (!isSavingRepository) {
      setRepositoryDialogMode(null);
      setRepositoryError("");
    }
  }

  async function persistRepositories(repos: ProjectRepository[]): Promise<ProjectRecord> {
    if (!selectedProject) {
      throw new Error("Select a project before managing repositories.");
    }

    const response = await fetch(
      `/api/projects/${encodeURIComponent(selectedProject.project_id)}`,
      {
        body: JSON.stringify({ repos }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      }
    );
    const data = (await response.json()) as { error?: string; project?: ProjectRecord };

    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Unable to update repositories.");
    }

    const updatedProject = data.project;
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.project_id === updatedProject.project_id ? updatedProject : project
      )
    );
    return updatedProject;
  }

  async function addRepositoryFromLocalPath(local: string): Promise<ProjectRecord> {
    if (!selectedProject) {
      throw new Error("Select a project before managing repositories.");
    }

    const response = await fetch(
      `/api/projects/${encodeURIComponent(selectedProject.project_id)}`,
      {
        body: JSON.stringify({ local }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const data = (await response.json()) as { error?: string; project?: ProjectRecord };

    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Unable to add the repository.");
    }

    const updatedProject = data.project;
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.project_id === updatedProject.project_id ? updatedProject : project
      )
    );
    return updatedProject;
  }

  async function saveRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || !repositoryDialogMode) {
      return;
    }

    const local = repositoryForm.local.trim();
    if (!local) {
      setRepositoryError("Enter a local path.");
      return;
    }

    if (repositoryDialogMode === "edit" && editingRepositoryIndex === null) {
      return;
    }

    setIsSavingRepository(true);
    setRepositoryError("");
    setRepositoryListError("");

    try {
      if (repositoryDialogMode === "add") {
        await addRepositoryFromLocalPath(local);
      } else {
        const repository: ProjectRepository = {
          name: repositoryForm.name.trim(),
          remote: repositoryForm.remote.trim() || null,
          local
        };

        if (!repository.name) {
          setRepositoryError("Enter a repository name.");
          return;
        }

        await persistRepositories(
          selectedProject.repos.map((currentRepository, index) =>
            index === editingRepositoryIndex ? repository : currentRepository
          )
        );
      }
      setRepositoryDialogMode(null);
      setEditingRepositoryIndex(null);
      setRepositoryForm(emptyRepositoryForm);
    } catch (error) {
      setRepositoryError(error instanceof Error ? error.message : "Unable to update repositories.");
    } finally {
      setIsSavingRepository(false);
    }
  }

  async function removeRepository(index: number) {
    if (!selectedProject || isSavingRepository || !selectedProject.repos[index]) {
      return;
    }

    setIsSavingRepository(true);
    setRepositoryListError("");

    try {
      await persistRepositories(
        selectedProject.repos.filter((_, repositoryIndex) => repositoryIndex !== index)
      );
    } catch (error) {
      setRepositoryListError(
        error instanceof Error ? error.message : "Unable to remove the repository."
      );
    } finally {
      setIsSavingRepository(false);
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
            {panelDescription ? <span>{panelDescription}</span> : null}
          </div>
          <PanelContent
            isSavingRepositories={isSavingRepository}
            onAddRepository={openAddRepositoryDialog}
            onEditRepository={openEditRepositoryDialog}
            onRemoveRepository={removeRepository}
            project={selectedProject}
            repositoryListError={repositoryListError}
            tab={activeTab}
          />
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

      {repositoryDialogMode ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeRepositoryDialog();
            }
          }}
        >
          <section
            aria-labelledby="repository-dialog-title"
            aria-modal="true"
            className="create-project-dialog repository-dialog"
            role="dialog"
          >
            <h2 id="repository-dialog-title">
              {repositoryDialogMode === "add" ? "Add repository" : "Edit repository"}
            </h2>
            <form onSubmit={saveRepository}>
              <div className="repository-form-fields">
                {repositoryDialogMode === "edit" ? (
                  <>
                    <label htmlFor="repository-name">
                      <span>Name</span>
                      <input
                        autoComplete="off"
                        id="repository-name"
                        maxLength={120}
                        onChange={(event) =>
                          setRepositoryForm((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder="Repository name"
                        required
                        type="text"
                        value={repositoryForm.name}
                      />
                    </label>
                    <label htmlFor="repository-remote">
                      <span>Remote origin (optional)</span>
                      <input
                        autoCapitalize="none"
                        autoComplete="off"
                        id="repository-remote"
                        maxLength={2048}
                        onChange={(event) =>
                          setRepositoryForm((current) => ({ ...current, remote: event.target.value }))
                        }
                        placeholder="git@github.com:owner/repository.git"
                        spellCheck={false}
                        type="text"
                        value={repositoryForm.remote}
                      />
                    </label>
                  </>
                ) : null}
                <label htmlFor="repository-local">
                  <span>Local path</span>
                  <input
                    autoComplete="off"
                    id="repository-local"
                    maxLength={4096}
                    onChange={(event) =>
                      setRepositoryForm((current) => ({ ...current, local: event.target.value }))
                    }
                    placeholder="~/code/path/to/repository"
                    ref={repositoryLocalPathInput}
                    required
                    spellCheck={false}
                    type="text"
                    value={repositoryForm.local}
                  />
                </label>
              </div>
              {repositoryError ? (
                <p className="create-project-error" role="alert">
                  {repositoryError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isSavingRepository}
                  onClick={closeRepositoryDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="dialog-primary-button"
                  disabled={isSavingRepository}
                  type="submit"
                >
                  <Plus aria-hidden="true" />
                  <span>
                    {isSavingRepository
                      ? "Saving..."
                      : repositoryDialogMode === "add"
                        ? "Add repository"
                        : "Save repository"}
                  </span>
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
  isSavingRepositories,
  onAddRepository,
  onEditRepository,
  onRemoveRepository,
  project,
  repositoryListError,
  tab
}: {
  isSavingRepositories: boolean;
  onAddRepository: () => void;
  onEditRepository: (index: number) => void;
  onRemoveRepository: (index: number) => void;
  project: ProjectRecord | undefined;
  repositoryListError: string;
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
        <RepositorySection
          isSaving={isSavingRepositories}
          onAdd={onAddRepository}
          onEdit={onEditRepository}
          onRemove={onRemoveRepository}
          repositories={project.repos}
          repositoryListError={repositoryListError}
        />
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

function RepositorySection({
  isSaving,
  onAdd,
  onEdit,
  onRemove,
  repositories,
  repositoryListError
}: {
  isSaving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  repositories: ProjectRepository[];
  repositoryListError: string;
}) {
  return (
    <section aria-labelledby="repositories-heading" className="repository-section">
      <div className="repository-section-header">
        <div>
          <p>Project sources</p>
          <h2 id="repositories-heading">Repositories</h2>
        </div>
        <button
          className="add-repository-button"
          disabled={isSaving}
          onClick={onAdd}
          type="button"
        >
          <Plus aria-hidden="true" />
          <span>Add repository</span>
        </button>
      </div>

      {repositoryListError ? (
        <p className="create-project-error" role="alert">
          {repositoryListError}
        </p>
      ) : null}

      {repositories.length === 0 ? (
        <div className="repository-empty-state">
          <GitBranch aria-hidden="true" />
          <div>
            <strong>No repositories</strong>
            <span>Add the first associated repository.</span>
          </div>
        </div>
      ) : (
        <ul className="repository-list">
          {repositories.map((repository, index) => (
            <li key={`${repository.name}-${repository.remote}-${repository.local}-${index}`}>
              <div className="repository-details">
                <strong>{repository.name}</strong>
                <dl>
                  <div>
                    <dt>Remote</dt>
                    <dd>
                      {repository.remote ? (
                        <code>{repository.remote}</code>
                      ) : (
                        <span className="repository-missing-value">No origin configured</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Local</dt>
                    <dd>
                      <code>{repository.local}</code>
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="repository-actions">
                <button
                  aria-label={`Edit ${repository.name}`}
                  className="repository-icon-button"
                  disabled={isSaving}
                  onClick={() => onEdit(index)}
                  title={`Edit ${repository.name}`}
                  type="button"
                >
                  <Pencil aria-hidden="true" />
                </button>
                <button
                  aria-label={`Remove ${repository.name}`}
                  className="repository-icon-button is-danger"
                  disabled={isSaving}
                  onClick={() => onRemove(index)}
                  title={`Remove ${repository.name}`}
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
