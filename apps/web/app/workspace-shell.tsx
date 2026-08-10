"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AiSessionsPanel } from "./ai-sessions-panel";
import { BranchesSection } from "./branches-section";
import { CodeImplementationSection } from "./code-implementation-section";
import { PullRequestsSection } from "./pull-requests-section";
import { ProjectContextSection } from "./project-context-section";
import { SettingsSection } from "./settings-section";
import {
  defaultSettingsTab,
  settingsTabUrl,
  workspaceTabUrl,
  type SettingsTab
} from "./workspace-url";
import { TaskPlanSection } from "./task-plan-section";
import type {
  DocumentSource,
  DocumentSourceType,
  ProjectRecord,
  ProjectRepository
} from "@supply-flow/core/project";
import {
  CheckCircle2,
  Code2,
  Download,
  Eye,
  ExternalLink,
  FilePenLine,
  FileText,
  FileUp,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  ListTodo,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  type LucideIcon
} from "lucide-react";
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from "react";

type TabId =
  | "project"
  | "task-plan"
  | "code-implementation"
  | "pr"
  | "settings"
  | "ai-sessions";
type RepositoryDialogMode = "add" | "edit" | null;
type RequirementDialogMode = "add" | "edit" | null;
type ProjectImportMode = "separate" | "replace" | "merge";

interface NavigationTab {
  id: TabId;
  label: string;
  href: string;
  icon: LucideIcon;
}

interface RepositoryForm {
  name: string;
  remote: string;
  local: string;
}

interface RequirementForm {
  type: DocumentSourceType;
  link: string;
  title: string;
}

interface ProjectImportConflict {
  importedProjectName: string;
  existingProjects: Array<Pick<ProjectRecord, "project_id" | "project_name">>;
}

const emptyRepositoryForm: RepositoryForm = {
  name: "",
  remote: "",
  local: ""
};

const emptyRequirementForm: RequirementForm = {
  type: "google-doc",
  link: "",
  title: ""
};

const requirementSourceOptions: readonly {
  type: DocumentSourceType;
  label: string;
}[] = [
  { type: "google-doc", label: "Google Doc" },
  { type: "confluence", label: "Confluence" },
  { type: "figma", label: "Figma" },
  { type: "slack", label: "Slack" },
  { type: "markdown", label: "Markdown" }
];

const navigationTabs: readonly NavigationTab[] = [
  { id: "project", label: "Project", href: "/project", icon: FolderKanban },
  { id: "task-plan", label: "Task plan", href: "/task_plan", icon: ListTodo },
  {
    id: "code-implementation",
    label: "Code implementation",
    href: "/code_implementation",
    icon: Code2
  },
  { id: "pr", label: "PR", href: "/pr", icon: GitPullRequest },
  {
    id: "settings",
    label: "Settings",
    href: settingsTabUrl(defaultSettingsTab),
    icon: Settings2
  },
  { id: "ai-sessions", label: "AI sessions", href: "/ai_sessions", icon: MessageSquare }
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
  },
  "ai-sessions": {
    eyebrow: "Workspace",
    title: "AI sessions",
    description: "AI provider sessions for the current project."
  }
};

export function WorkspaceShell({
  projectId,
  settingsTab,
  tab
}: {
  projectId?: string;
  settingsTab?: SettingsTab;
  tab: TabId;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isCreateProjectDialogOpen, setIsCreateProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creationError, setCreationError] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isImportProjectDialogOpen, setIsImportProjectDialogOpen] = useState(false);
  const [projectArchive, setProjectArchive] = useState<File | null>(null);
  const [importProjectError, setImportProjectError] = useState("");
  const [isImportingProject, setIsImportingProject] = useState(false);
  const [projectImportConflict, setProjectImportConflict] =
    useState<ProjectImportConflict | null>(null);
  const [projectImportMode, setProjectImportMode] =
    useState<ProjectImportMode>("separate");
  const [importTargetProjectId, setImportTargetProjectId] = useState("");
  const [isRemoveProjectDialogOpen, setIsRemoveProjectDialogOpen] = useState(false);
  const [removeProjectConfirmation, setRemoveProjectConfirmation] = useState("");
  const [removeProjectError, setRemoveProjectError] = useState("");
  const [isRemovingProject, setIsRemovingProject] = useState(false);
  const [repositoryDialogMode, setRepositoryDialogMode] =
    useState<RepositoryDialogMode>(null);
  const [editingRepositoryIndex, setEditingRepositoryIndex] = useState<number | null>(null);
  const [repositoryForm, setRepositoryForm] = useState<RepositoryForm>(emptyRepositoryForm);
  const [repositoryError, setRepositoryError] = useState("");
  const [repositoryListError, setRepositoryListError] = useState("");
  const [isSavingRepository, setIsSavingRepository] = useState(false);
  const [requirementDialogMode, setRequirementDialogMode] =
    useState<RequirementDialogMode>(null);
  const [editingRequirementIndex, setEditingRequirementIndex] = useState<number | null>(null);
  const [requirementForm, setRequirementForm] = useState<RequirementForm>(emptyRequirementForm);
  const [markdownFile, setMarkdownFile] = useState<File | null>(null);
  const [requirementError, setRequirementError] = useState("");
  const [requirementListError, setRequirementListError] = useState("");
  const [isSavingRequirement, setIsSavingRequirement] = useState(false);
  const [isStartingRfc, setIsStartingRfc] = useState(false);
  const [rfcError, setRfcError] = useState("");
  const [isRfcRepositoryDialogOpen, setIsRfcRepositoryDialogOpen] = useState(false);
  const [selectedRfcRepositoryLocals, setSelectedRfcRepositoryLocals] = useState<string[]>([]);
  const [rfcRepositoryError, setRfcRepositoryError] = useState("");
  const [openingRfcDraftLink, setOpeningRfcDraftLink] = useState<string | null>(null);
  const [updatingRfcDraftLink, setUpdatingRfcDraftLink] = useState<string | null>(null);
  const [isRfcConversionDialogOpen, setIsRfcConversionDialogOpen] = useState(false);
  const [rfcDraftToConvert, setRfcDraftToConvert] = useState<DocumentSource | null>(null);
  const [rfcConfluenceDestination, setRfcConfluenceDestination] = useState("");
  const [rfcConversionError, setRfcConversionError] = useState("");
  const [isConvertingRfc, setIsConvertingRfc] = useState(false);
  const projectNameInput = useRef<HTMLInputElement>(null);
  const projectArchiveInput = useRef<HTMLInputElement>(null);
  const removeProjectNameInput = useRef<HTMLInputElement>(null);
  const repositoryLocalPathInput = useRef<HTMLInputElement>(null);
  const requirementLinkInput = useRef<HTMLInputElement>(null);
  const requirementMarkdownInput = useRef<HTMLInputElement>(null);
  const rfcRepositorySelectionInput = useRef<HTMLInputElement>(null);
  const rfcConfluenceDestinationInput = useRef<HTMLInputElement>(null);
  const selectedProjectId = projectId ?? "";
  const heading = tabHeadings[tab];
  const selectedProject = projects.find((project) => project.project_id === selectedProjectId);
  const hasPanelHeading =
    tab !== "ai-sessions" &&
    tab !== "project" &&
    tab !== "task-plan" &&
    tab !== "code-implementation" &&
    tab !== "pr" &&
    tab !== "settings";
  const panelEyebrow = selectedProject
    ? `${selectedProject.project_name} / ${heading.eyebrow}`
    : heading.eyebrow;
  const panelDescription = selectedProject || tab === "settings"
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
    if (isImportProjectDialogOpen) {
      projectArchiveInput.current?.focus();
    }
  }, [isImportProjectDialogOpen]);

  useEffect(() => {
    if (isRemoveProjectDialogOpen) {
      removeProjectNameInput.current?.focus();
    }
  }, [isRemoveProjectDialogOpen]);

  useEffect(() => {
    if (repositoryDialogMode) {
      repositoryLocalPathInput.current?.focus();
    }
  }, [repositoryDialogMode]);

  useEffect(() => {
    if (requirementDialogMode) {
      if (requirementForm.type === "markdown") {
        requirementMarkdownInput.current?.focus();
      } else {
        requirementLinkInput.current?.focus();
      }
    }
  }, [requirementDialogMode, requirementForm.type]);

  useEffect(() => {
    if (isRfcRepositoryDialogOpen) {
      rfcRepositorySelectionInput.current?.focus();
    }
  }, [isRfcRepositoryDialogOpen]);

  useEffect(() => {
    if (isRfcConversionDialogOpen) {
      rfcConfluenceDestinationInput.current?.focus();
    }
  }, [isRfcConversionDialogOpen]);

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
    if (!isImportProjectDialogOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isImportingProject) {
        closeImportProjectDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isImportProjectDialogOpen, isImportingProject]);

  useEffect(() => {
    if (!isRemoveProjectDialogOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isRemovingProject) {
        setIsRemoveProjectDialogOpen(false);
        setRemoveProjectError("");
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isRemoveProjectDialogOpen, isRemovingProject]);

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

  useEffect(() => {
    if (!requirementDialogMode) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSavingRequirement) {
        setRequirementDialogMode(null);
        setRequirementError("");
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSavingRequirement, requirementDialogMode]);

  useEffect(() => {
    if (!isRfcRepositoryDialogOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isStartingRfc) {
        closeRfcRepositoryDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isRfcRepositoryDialogOpen, isStartingRfc]);

  useEffect(() => {
    if (!isRfcConversionDialogOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isConvertingRfc) {
        closeRfcConversionDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isConvertingRfc, isRfcConversionDialogOpen]);

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

  function openImportProjectDialog() {
    setProjectArchive(null);
    setImportProjectError("");
    setProjectImportConflict(null);
    setProjectImportMode("separate");
    setImportTargetProjectId("");
    if (projectArchiveInput.current) {
      projectArchiveInput.current.value = "";
    }
    setIsImportProjectDialogOpen(true);
  }

  function closeImportProjectDialog() {
    if (!isImportingProject) {
      setIsImportProjectDialogOpen(false);
      setImportProjectError("");
      setProjectImportConflict(null);
      setProjectImportMode("separate");
      setImportTargetProjectId("");
    }
  }

  function selectProjectArchive(event: ChangeEvent<HTMLInputElement>) {
    setProjectArchive(event.target.files?.[0] ?? null);
    setImportProjectError("");
    setProjectImportConflict(null);
    setProjectImportMode("separate");
    setImportTargetProjectId("");
  }

  function openRemoveProjectDialog() {
    if (!selectedProject) {
      return;
    }

    setRemoveProjectConfirmation("");
    setRemoveProjectError("");
    setIsRemoveProjectDialogOpen(true);
  }

  function closeRemoveProjectDialog() {
    if (!isRemovingProject) {
      setIsRemoveProjectDialogOpen(false);
      setRemoveProjectError("");
    }
  }

  function exportProject() {
    if (!selectedProject) {
      return;
    }

    window.location.assign(
      `/api/projects/${encodeURIComponent(selectedProject.project_id)}/export`
    );
  }

  function selectProject(projectId: string) {
    const currentTab = navigationTabs.find((navigationTab) => navigationTab.id === tab);
    const href =
      tab === "settings"
        ? settingsTabUrl(settingsTab ?? defaultSettingsTab, projectId || undefined)
        : workspaceTabUrl(currentTab?.href ?? "/project", projectId || undefined);
    router.push(href);
  }

  function replaceProject(updatedProject: ProjectRecord) {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.project_id === updatedProject.project_id ? updatedProject : project
      )
    );
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
      selectProject(data.project.project_id);
      setIsCreateProjectDialogOpen(false);
      setNewProjectName("");
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : "Unable to create the project.");
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function importProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectArchive) {
      setImportProjectError("Choose a ZIP archive to import.");
      return;
    }
    if (
      projectImportConflict &&
      projectImportMode !== "separate" &&
      !importTargetProjectId
    ) {
      setImportProjectError("Choose the existing project to update.");
      return;
    }

    setIsImportingProject(true);
    setImportProjectError("");

    try {
      const formData = new FormData();
      formData.set("archive", projectArchive);
      if (projectImportConflict) {
        formData.set("mode", projectImportMode);
        if (projectImportMode !== "separate") {
          formData.set("targetProjectId", importTargetProjectId);
        }
      }
      const response = await fetch("/api/projects/import", {
        body: formData,
        method: "POST"
      });
      const data = (await response.json()) as {
        error?: string;
        existingProjects?: Array<Pick<ProjectRecord, "project_id" | "project_name">>;
        importedProjectName?: string;
        project?: ProjectRecord;
        requiresDecision?: boolean;
        session?: { id: string };
      };
      if (data.requiresDecision) {
        const existingProjects = data.existingProjects ?? [];
        if (!data.importedProjectName || existingProjects.length === 0) {
          throw new Error("Unable to identify the existing project for this import.");
        }

        setProjectImportConflict({
          importedProjectName: data.importedProjectName,
          existingProjects
        });
        setProjectImportMode("separate");
        setImportTargetProjectId(existingProjects[0]?.project_id ?? "");
        return;
      }
      if (!response.ok || !data.project || !data.session) {
        throw new Error(data.error ?? "Unable to start the project import.");
      }

      setProjects((currentProjects) => [
        data.project as ProjectRecord,
        ...currentProjects.filter(
          (currentProject) => currentProject.project_id !== data.project?.project_id
        )
      ]);
      setIsImportProjectDialogOpen(false);
      setProjectArchive(null);
      router.push(workspaceTabUrl("/ai_sessions", data.project.project_id, data.session.id));
    } catch (error) {
      setImportProjectError(
        error instanceof Error ? error.message : "Unable to start the project import."
      );
    } finally {
      setIsImportingProject(false);
    }
  }

  async function removeProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const project = selectedProject;
    if (!project) {
      closeRemoveProjectDialog();
      return;
    }
    if (removeProjectConfirmation !== project.project_name) {
      setRemoveProjectError("Type the project name exactly to confirm removal.");
      return;
    }

    setIsRemovingProject(true);
    setRemoveProjectError("");

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.project_id)}`, {
        body: JSON.stringify({ projectName: removeProjectConfirmation }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE"
      });
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) {
        throw new Error(data.error ?? "Unable to remove the project.");
      }

      setProjects((currentProjects) =>
        currentProjects.filter((currentProject) => currentProject.project_id !== project.project_id)
      );
      setIsRemoveProjectDialogOpen(false);
      setRemoveProjectConfirmation("");
      router.push("/project");
    } catch (error) {
      setRemoveProjectError(
        error instanceof Error ? error.message : "Unable to remove the project."
      );
    } finally {
      setIsRemovingProject(false);
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

  function openAddRequirementDialog() {
    setRequirementForm(emptyRequirementForm);
    setMarkdownFile(null);
    setEditingRequirementIndex(null);
    setRequirementError("");
    setRequirementDialogMode("add");
  }

  function openEditRequirementDialog(index: number) {
    const document = selectedProject?.documents[index];
    if (!document) {
      return;
    }

    setRequirementForm({
      type: document.type,
      link: document.link,
      title: document.title ?? ""
    });
    setMarkdownFile(null);
    setEditingRequirementIndex(index);
    setRequirementError("");
    setRequirementDialogMode("edit");
  }

  function closeRequirementDialog() {
    if (!isSavingRequirement) {
      setRequirementDialogMode(null);
      setMarkdownFile(null);
      setRequirementError("");
    }
  }

  function selectMarkdownFile(event: ChangeEvent<HTMLInputElement>) {
    setMarkdownFile(event.target.files?.[0] ?? null);
    setRequirementError("");
  }

  function updateRequirementSourceType(type: DocumentSourceType) {
    setRequirementForm((current) => ({
      ...current,
      type,
      link: type === current.type ? current.link : ""
    }));
    setMarkdownFile(null);
    if (requirementMarkdownInput.current) {
      requirementMarkdownInput.current.value = "";
    }
  }

  async function persistDocuments(
    documents: DocumentSource[]
  ): Promise<ProjectRecord> {
    if (!selectedProject) {
      throw new Error("Select a project before managing documents.");
    }

    const response = await fetch(
      `/api/projects/${encodeURIComponent(selectedProject.project_id)}`,
      {
        body: JSON.stringify({ documents }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      }
    );
    const data = (await response.json()) as { error?: string; project?: ProjectRecord };

    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Unable to update documents.");
    }

    const updatedProject = data.project;
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.project_id === updatedProject.project_id ? updatedProject : project
      )
    );
    return updatedProject;
  }

  async function uploadMarkdownDocument(
    file: File,
    documentIndex: number | null
  ): Promise<ProjectRecord> {
    if (!selectedProject) {
      throw new Error("Select a project before managing documents.");
    }

    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", requirementForm.title.trim());
    if (documentIndex !== null) {
      formData.set("documentIndex", String(documentIndex));
    }

    const response = await fetch(
      `/api/projects/${encodeURIComponent(selectedProject.project_id)}/documents/markdown`,
      {
        body: formData,
        method: "POST"
      }
    );
    const data = (await response.json()) as { error?: string; project?: ProjectRecord };
    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Unable to upload the Markdown document.");
    }

    const updatedProject = data.project;
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.project_id === updatedProject.project_id ? updatedProject : project
      )
    );
    return updatedProject;
  }

  async function saveRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || !requirementDialogMode) {
      return;
    }

    if (requirementDialogMode === "edit" && editingRequirementIndex === null) {
      return;
    }
    const currentDocument =
      editingRequirementIndex === null ? null : selectedProject.documents[editingRequirementIndex];

    if (requirementForm.type === "markdown") {
      if (markdownFile) {
        setIsSavingRequirement(true);
        setRequirementError("");
        setRequirementListError("");

        try {
          await uploadMarkdownDocument(markdownFile, editingRequirementIndex);
          setRequirementDialogMode(null);
          setEditingRequirementIndex(null);
          setRequirementForm(emptyRequirementForm);
          setMarkdownFile(null);
        } catch (error) {
          setRequirementError(
            error instanceof Error ? error.message : "Unable to upload the Markdown document."
          );
        } finally {
          setIsSavingRequirement(false);
        }
        return;
      }

      if (requirementDialogMode === "add" || currentDocument?.type !== "markdown") {
        setRequirementError("Choose a local Markdown file to upload.");
        return;
      }
    }

    const document: DocumentSource = {
      type: requirementForm.type,
      link:
        requirementForm.type === "markdown"
          ? currentDocument?.link ?? ""
          : requirementForm.link.trim(),
      title: requirementForm.title.trim() || null
    };
    if (!document.link) {
      setRequirementError("Enter a source link.");
      return;
    }

    setIsSavingRequirement(true);
    setRequirementError("");
    setRequirementListError("");

    try {
      await persistDocuments(
        requirementDialogMode === "add"
          ? [...selectedProject.documents, document]
          : selectedProject.documents.map((currentDocument, index) =>
              index === editingRequirementIndex ? document : currentDocument
            )
      );
      setRequirementDialogMode(null);
      setEditingRequirementIndex(null);
      setRequirementForm(emptyRequirementForm);
      setMarkdownFile(null);
    } catch (error) {
      setRequirementError(
        error instanceof Error ? error.message : "Unable to update documents."
      );
    } finally {
      setIsSavingRequirement(false);
    }
  }

  async function removeRequirement(index: number) {
    if (!selectedProject || isSavingRequirement || !selectedProject.documents[index]) {
      return;
    }

    setIsSavingRequirement(true);
    setRequirementListError("");

    try {
      await persistDocuments(
        selectedProject.documents.filter(
          (_, documentIndex) => documentIndex !== index
        )
      );
    } catch (error) {
      setRequirementListError(
        error instanceof Error ? error.message : "Unable to remove the document."
      );
    } finally {
      setIsSavingRequirement(false);
    }
  }

  function openRfcRepositoryDialog() {
    if (
      !selectedProject ||
      selectedProject.documents.length === 0 ||
      selectedProject.repos.length === 0 ||
      isSavingRequirement ||
      isStartingRfc
    ) {
      return;
    }

    setSelectedRfcRepositoryLocals([]);
    setRfcRepositoryError("");
    setIsRfcRepositoryDialogOpen(true);
  }

  function closeRfcRepositoryDialog() {
    if (!isStartingRfc) {
      setIsRfcRepositoryDialogOpen(false);
      setSelectedRfcRepositoryLocals([]);
      setRfcRepositoryError("");
    }
  }

  function toggleRfcRepository(local: string) {
    setSelectedRfcRepositoryLocals((current) =>
      current.includes(local)
        ? current.filter((selectedLocal) => selectedLocal !== local)
        : [...current, local]
    );
    setRfcRepositoryError("");
  }

  async function startRfcSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedProject ||
      selectedProject.documents.length === 0 ||
      selectedProject.repos.length === 0 ||
      isSavingRequirement ||
      isStartingRfc
    ) {
      return;
    }

    if (selectedRfcRepositoryLocals.length === 0) {
      setRfcRepositoryError("Select at least one repository for this RFC.");
      return;
    }

    setIsStartingRfc(true);
    setRfcError("");
    setRfcRepositoryError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.project_id)}/rfc`,
        {
          body: JSON.stringify({ repositoryLocals: selectedRfcRepositoryLocals }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }
      );
      const data = (await response.json()) as {
        error?: string;
        session?: { id: string };
      };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to start the RFC session.");
      }

      setIsRfcRepositoryDialogOpen(false);
      setSelectedRfcRepositoryLocals([]);
      router.push(workspaceTabUrl("/ai_sessions", selectedProject.project_id, data.session.id));
    } catch (error) {
      setRfcRepositoryError(
        error instanceof Error ? error.message : "Unable to start the RFC session."
      );
    } finally {
      setIsStartingRfc(false);
    }
  }

  async function reviewRfcDraft(index: number) {
    const draft = selectedProject?.documents[index];
    if (
      !selectedProject ||
      draft?.type !== "rfc-draft" ||
      isSavingRequirement ||
      isStartingRfc ||
      isConvertingRfc ||
      openingRfcDraftLink
    ) {
      return;
    }

    setOpeningRfcDraftLink(draft.link);
    setRfcError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.project_id)}/rfc-drafts/open`,
        {
          body: JSON.stringify({ draftLink: draft.link }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }
      );
      const data = (await response.json()) as { error?: string; opened?: boolean };
      if (!response.ok || !data.opened) {
        throw new Error(data.error ?? "Unable to open the RFC draft locally.");
      }
    } catch (error) {
      setRfcError(
        error instanceof Error ? error.message : "Unable to open the RFC draft locally."
      );
    } finally {
      setOpeningRfcDraftLink(null);
    }
  }

  async function updateRfcDraft(index: number) {
    const draft = selectedProject?.documents[index];
    if (
      !selectedProject ||
      draft?.type !== "rfc-draft" ||
      isSavingRequirement ||
      isStartingRfc ||
      isConvertingRfc ||
      openingRfcDraftLink ||
      updatingRfcDraftLink
    ) {
      return;
    }

    setUpdatingRfcDraftLink(draft.link);
    setRfcError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.project_id)}/rfc-drafts/update`,
        {
          body: JSON.stringify({ draftLink: draft.link }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }
      );
      const data = (await response.json()) as {
        error?: string;
        session?: { id: string };
      };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to open an RFC update session.");
      }

      router.push(workspaceTabUrl("/ai_sessions", selectedProject.project_id, data.session.id));
    } catch (error) {
      setRfcError(
        error instanceof Error ? error.message : "Unable to open an RFC update session."
      );
    } finally {
      setUpdatingRfcDraftLink(null);
    }
  }

  function openRfcConversionDialog(index: number) {
    const draft = selectedProject?.documents[index];
    if (
      draft?.type !== "rfc-draft" ||
      isSavingRequirement ||
      isStartingRfc ||
      isConvertingRfc ||
      openingRfcDraftLink
    ) {
      return;
    }

    setRfcDraftToConvert(draft);
    setRfcConfluenceDestination("");
    setRfcConversionError("");
    setIsRfcConversionDialogOpen(true);
  }

  function closeRfcConversionDialog() {
    if (!isConvertingRfc) {
      setIsRfcConversionDialogOpen(false);
      setRfcDraftToConvert(null);
      setRfcConfluenceDestination("");
      setRfcConversionError("");
    }
  }

  async function convertRfcDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || !rfcDraftToConvert) {
      return;
    }

    const destination = rfcConfluenceDestination.trim();
    if (!destination) {
      setRfcConversionError("Enter a Confluence parent page or space destination.");
      return;
    }

    setIsConvertingRfc(true);
    setRfcConversionError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.project_id)}/rfc-drafts/convert`,
        {
          body: JSON.stringify({
            destination,
            draftLink: rfcDraftToConvert.link
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }
      );
      const data = (await response.json()) as {
        error?: string;
        session?: { id: string };
      };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to start the RFC conversion session.");
      }

      setIsRfcConversionDialogOpen(false);
      setRfcDraftToConvert(null);
      setRfcConfluenceDestination("");
      router.push(workspaceTabUrl("/ai_sessions", selectedProject.project_id, data.session.id));
    } catch (error) {
      setRfcConversionError(
        error instanceof Error ? error.message : "Unable to start the RFC conversion session."
      );
    } finally {
      setIsConvertingRfc(false);
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
              onChange={(event) => selectProject(event.target.value)}
              value={selectedProjectId}
            >
              <option value="">
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
          <button
            className="import-project-button"
            disabled={isImportingProject}
            onClick={openImportProjectDialog}
            type="button"
          >
            <FileUp aria-hidden="true" />
            <span>Import project</span>
          </button>
          <button
            aria-label="Export current project"
            className="export-project-button"
            disabled={!selectedProject}
            onClick={exportProject}
            title="Export current project"
            type="button"
          >
            <Download aria-hidden="true" />
            <span>Export project</span>
          </button>
          <button
            aria-label="Remove current project"
            className="remove-project-button"
            disabled={!selectedProject || isRemovingProject}
            onClick={openRemoveProjectDialog}
            title="Remove current project"
            type="button"
          >
            <Trash2 aria-hidden="true" />
            <span>Remove project</span>
          </button>
        </div>
        <span className="local-status">
          <span />
          Local
        </span>
      </header>

      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <nav className="workspace-nav">
          {navigationTabs.map((navigationTab) => {
            const Icon = navigationTab.icon;
            const isActive = navigationTab.id === tab;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={`workspace-nav-tab${isActive ? " is-active" : ""}`}
                href={
                  navigationTab.id === "settings"
                    ? settingsTabUrl(settingsTab ?? defaultSettingsTab, selectedProjectId)
                    : workspaceTabUrl(navigationTab.href, selectedProjectId)
                }
                key={navigationTab.id}
              >
                <Icon aria-hidden="true" />
                <span>{navigationTab.label}</span>
              </Link>
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
          aria-label={
            tab === "ai-sessions"
              ? "AI sessions"
              : tab === "project"
                ? "Project"
                : tab === "task-plan"
                  ? "Task plan"
                  : tab === "code-implementation"
                    ? "Code implementation"
                    : tab === "pr"
                      ? "Pull requests"
                      : undefined
          }
          aria-labelledby={hasPanelHeading ? "workspace-heading" : undefined}
          className={`workspace-panel${tab === "ai-sessions" ? " is-session-panel" : ""}${
            tab === "project" ? " is-project-panel" : ""
          }${tab === "task-plan" ? " is-task-plan-panel" : ""}${
            tab === "code-implementation" ? " is-code-implementation-panel" : ""
          }${tab === "pr" ? " is-pull-requests-panel" : ""
          }${tab === "settings" ? " is-settings-panel" : ""
          }`}
        >
          {hasPanelHeading ? (
            <div className="panel-heading">
              <p>{panelEyebrow}</p>
              <h1 id="workspace-heading">{heading.title}</h1>
              {panelDescription ? <span>{panelDescription}</span> : null}
            </div>
          ) : null}
          <PanelContent
            isSavingRepositories={isSavingRepository}
            isSavingRequirements={isSavingRequirement}
            isConvertingRfc={isConvertingRfc}
            isStartingRfc={isStartingRfc}
            onAddRepository={openAddRepositoryDialog}
            onAddRequirement={openAddRequirementDialog}
            onEditRepository={openEditRepositoryDialog}
            onEditRequirement={openEditRequirementDialog}
            onRemoveRepository={removeRepository}
            onRemoveRequirement={removeRequirement}
            onProjectUpdated={replaceProject}
            onConvertRfcDraft={openRfcConversionDialog}
            onReviewRfcDraft={reviewRfcDraft}
            onUpdateRfcDraft={updateRfcDraft}
            onWriteRfc={openRfcRepositoryDialog}
            openingRfcDraftLink={openingRfcDraftLink}
            project={selectedProject}
            repositoryListError={repositoryListError}
            requirementListError={requirementListError}
            rfcError={rfcError}
            selectedProjectId={selectedProjectId}
            settingsTab={settingsTab}
            tab={tab}
            updatingRfcDraftLink={updatingRfcDraftLink}
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

      {isImportProjectDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeImportProjectDialog();
            }
          }}
        >
          <section
            aria-labelledby="import-project-title"
            aria-modal="true"
            className="create-project-dialog import-project-dialog"
            role="dialog"
          >
            <h2 id="import-project-title">Import project</h2>
            <form onSubmit={importProject}>
              <label className="project-archive-field" htmlFor="project-archive">
                <span>Project archive</span>
                <input
                  accept=".zip,application/zip,application/x-zip-compressed"
                  id="project-archive"
                  onChange={selectProjectArchive}
                  ref={projectArchiveInput}
                  required
                  type="file"
                />
              </label>
              {projectArchive ? (
                <p className="selected-project-archive">{projectArchive.name}</p>
              ) : null}
              {projectImportConflict ? (
                <fieldset className="project-import-options">
                  <legend>Existing project found</legend>
                  <p>
                    {projectImportConflict.importedProjectName} is already available locally.
                  </p>
                  <label className="project-import-option">
                    <input
                      checked={projectImportMode === "separate"}
                      name="project-import-mode"
                      onChange={() => setProjectImportMode("separate")}
                      type="radio"
                      value="separate"
                    />
                    <span>Create a separate project</span>
                  </label>
                  <label className="project-import-option">
                    <input
                      checked={projectImportMode === "replace"}
                      name="project-import-mode"
                      onChange={() => setProjectImportMode("replace")}
                      type="radio"
                      value="replace"
                    />
                    <span>Replace existing project</span>
                  </label>
                  <label className="project-import-option">
                    <input
                      checked={projectImportMode === "merge"}
                      name="project-import-mode"
                      onChange={() => setProjectImportMode("merge")}
                      type="radio"
                      value="merge"
                    />
                    <span>Merge with existing project</span>
                  </label>
                  {projectImportMode !== "separate" ? (
                    <label className="project-import-target">
                      <span>Project to update</span>
                      <select
                        onChange={(event) => setImportTargetProjectId(event.target.value)}
                        value={importTargetProjectId}
                      >
                        {projectImportConflict.existingProjects.map((project) => (
                          <option key={project.project_id} value={project.project_id}>
                            {project.project_name} ({project.project_id})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </fieldset>
              ) : null}
              {importProjectError ? (
                <p className="create-project-error" role="alert">
                  {importProjectError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isImportingProject}
                  onClick={closeImportProjectDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="import-project-button"
                  disabled={isImportingProject || !projectArchive}
                  type="submit"
                >
                  <FileUp aria-hidden="true" />
                  <span>
                    {isImportingProject
                      ? "Starting..."
                      : projectImportConflict
                        ? "Start import"
                        : "Continue"}
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isRemoveProjectDialogOpen && selectedProject ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeRemoveProjectDialog();
            }
          }}
        >
          <section
            aria-labelledby="remove-project-title"
            aria-modal="true"
            className="create-project-dialog remove-project-dialog"
            role="dialog"
          >
            <h2 id="remove-project-title">Remove project</h2>
            <p className="remove-project-warning">
              This permanently deletes the project data and terminates its AI sessions.
            </p>
            <form onSubmit={removeProject}>
              <label className="project-name-field" htmlFor="remove-project-name">
                <span>
                  Type <strong>{selectedProject.project_name}</strong> to confirm
                </span>
                <input
                  autoCapitalize="off"
                  autoComplete="off"
                  id="remove-project-name"
                  maxLength={120}
                  onChange={(event) => setRemoveProjectConfirmation(event.target.value)}
                  ref={removeProjectNameInput}
                  required
                  spellCheck={false}
                  type="text"
                  value={removeProjectConfirmation}
                />
              </label>
              {removeProjectError ? (
                <p className="create-project-error" role="alert">
                  {removeProjectError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isRemovingProject}
                  onClick={closeRemoveProjectDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="remove-project-button"
                  disabled={
                    isRemovingProject ||
                    removeProjectConfirmation !== selectedProject.project_name
                  }
                  type="submit"
                >
                  <Trash2 aria-hidden="true" />
                  <span>{isRemovingProject ? "Removing..." : "Remove project"}</span>
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

      {requirementDialogMode ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeRequirementDialog();
            }
          }}
        >
          <section
            aria-labelledby="requirement-dialog-title"
            aria-modal="true"
            className="create-project-dialog requirement-dialog"
            role="dialog"
          >
            <h2 id="requirement-dialog-title">
              {requirementDialogMode === "add" ? "Add document" : "Edit document"}
            </h2>
            <form onSubmit={saveRequirement}>
              <div className="requirement-form-fields">
                <label htmlFor="requirement-title">
                  <span>Title (optional)</span>
                  <input
                    autoComplete="off"
                    id="requirement-title"
                    maxLength={240}
                    onChange={(event) =>
                      setRequirementForm((current) => ({
                        ...current,
                        title: event.target.value
                      }))
                    }
                    placeholder="e.g. Validated test ride RFC"
                    value={requirementForm.title}
                  />
                </label>
                <label htmlFor="requirement-type">
                  <span>Source type</span>
                  <select
                    id="requirement-type"
                    onChange={(event) =>
                      updateRequirementSourceType(event.target.value as DocumentSourceType)
                    }
                    value={requirementForm.type}
                  >
                    {requirementSourceOptions.map((source) => (
                      <option key={source.type} value={source.type}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
                {requirementForm.type === "markdown" ? (
                  <label htmlFor="requirement-markdown">
                    <span>Markdown file</span>
                    <input
                      accept=".md,text/markdown"
                      id="requirement-markdown"
                      onChange={selectMarkdownFile}
                      ref={requirementMarkdownInput}
                      required={requirementDialogMode === "add"}
                      type="file"
                    />
                    {markdownFile ? (
                      <span className="selected-markdown-file">{markdownFile.name}</span>
                    ) : requirementDialogMode === "edit" ? (
                      <span className="selected-markdown-file">
                        Current file: {requirementForm.link}
                      </span>
                    ) : null}
                  </label>
                ) : (
                  <label htmlFor="requirement-link">
                    <span>Link</span>
                    <input
                      autoCapitalize="none"
                      autoComplete="off"
                      id="requirement-link"
                      maxLength={2048}
                      onChange={(event) =>
                        setRequirementForm((current) => ({
                          ...current,
                          link: event.target.value
                        }))
                      }
                      placeholder="https://..."
                      ref={requirementLinkInput}
                      required
                      spellCheck={false}
                      type="url"
                      value={requirementForm.link}
                    />
                  </label>
                )}
              </div>
              {requirementError ? (
                <p className="create-project-error" role="alert">
                  {requirementError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isSavingRequirement}
                  onClick={closeRequirementDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="dialog-primary-button"
                  disabled={isSavingRequirement}
                  type="submit"
                >
                  <Plus aria-hidden="true" />
                  <span>
                    {isSavingRequirement
                      ? "Saving..."
                      : requirementDialogMode === "add"
                        ? "Add document"
                        : "Save document"}
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isRfcConversionDialogOpen && rfcDraftToConvert ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeRfcConversionDialog();
            }
          }}
        >
          <section
            aria-labelledby="rfc-conversion-dialog-title"
            aria-modal="true"
            className="create-project-dialog rfc-conversion-dialog"
            role="dialog"
          >
            <h2 id="rfc-conversion-dialog-title">Convert RFC</h2>
            <form onSubmit={convertRfcDraft}>
              <div className="requirement-form-fields">
                <label htmlFor="rfc-confluence-destination">
                  <span>Confluence parent page or space</span>
                  <input
                    autoCapitalize="none"
                    autoComplete="off"
                    id="rfc-confluence-destination"
                    maxLength={2048}
                    onChange={(event) => setRfcConfluenceDestination(event.target.value)}
                    placeholder="https://limebike.atlassian.net/wiki/spaces/DOC"
                    ref={rfcConfluenceDestinationInput}
                    required
                    spellCheck={false}
                    type="text"
                    value={rfcConfluenceDestination}
                  />
                </label>
              </div>
              {rfcConversionError ? (
                <p className="create-project-error" role="alert">
                  {rfcConversionError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isConvertingRfc}
                  onClick={closeRfcConversionDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="dialog-primary-button" disabled={isConvertingRfc} type="submit">
                  <FileUp aria-hidden="true" />
                  <span>{isConvertingRfc ? "Starting..." : "Convert to RFC"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isRfcRepositoryDialogOpen && selectedProject ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeRfcRepositoryDialog();
            }
          }}
        >
          <section
            aria-labelledby="rfc-repository-dialog-title"
            aria-modal="true"
            className="create-project-dialog rfc-repository-dialog"
            role="dialog"
          >
            <h2 id="rfc-repository-dialog-title">Write RFC</h2>
            <form onSubmit={startRfcSession}>
              <fieldset className="rfc-repository-options">
                <legend>Related repositories</legend>
                <p>Choose the codebases this RFC should cover.</p>
                <div>
                  {selectedProject.repos.map((repository, index) => (
                    <label key={repository.local}>
                      <input
                        checked={selectedRfcRepositoryLocals.includes(repository.local)}
                        onChange={() => toggleRfcRepository(repository.local)}
                        ref={index === 0 ? rfcRepositorySelectionInput : undefined}
                        type="checkbox"
                      />
                      <span>
                        <strong>{repository.name}</strong>
                        <code>{repository.local}</code>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {rfcRepositoryError ? (
                <p className="create-project-error" role="alert">
                  {rfcRepositoryError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="dialog-cancel-button"
                  disabled={isStartingRfc}
                  onClick={closeRfcRepositoryDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="dialog-primary-button" disabled={isStartingRfc} type="submit">
                  <FilePenLine aria-hidden="true" />
                  <span>{isStartingRfc ? "Starting..." : "Write RFC"}</span>
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
  isSavingRequirements,
  isConvertingRfc,
  isStartingRfc,
  onAddRepository,
  onAddRequirement,
  onEditRepository,
  onEditRequirement,
  onRemoveRepository,
  onRemoveRequirement,
  onProjectUpdated,
  onConvertRfcDraft,
  onReviewRfcDraft,
  onUpdateRfcDraft,
  onWriteRfc,
  openingRfcDraftLink,
  project,
  repositoryListError,
  requirementListError,
  rfcError,
  selectedProjectId,
  settingsTab,
  tab,
  updatingRfcDraftLink
}: {
  isSavingRepositories: boolean;
  isSavingRequirements: boolean;
  isConvertingRfc: boolean;
  isStartingRfc: boolean;
  onAddRepository: () => void;
  onAddRequirement: () => void;
  onEditRepository: (index: number) => void;
  onEditRequirement: (index: number) => void;
  onRemoveRepository: (index: number) => void;
  onRemoveRequirement: (index: number) => void;
  onProjectUpdated: (project: ProjectRecord) => void;
  onConvertRfcDraft: (index: number) => void;
  onReviewRfcDraft: (index: number) => void;
  onUpdateRfcDraft: (index: number) => void;
  onWriteRfc: () => void;
  openingRfcDraftLink: string | null;
  project: ProjectRecord | undefined;
  repositoryListError: string;
  requirementListError: string;
  rfcError: string;
  selectedProjectId: string;
  settingsTab?: SettingsTab;
  tab: TabId;
  updatingRfcDraftLink: string | null;
}) {
  if (tab === "settings") {
    return (
      <SettingsSection
        activeTab={settingsTab ?? defaultSettingsTab}
        projectId={selectedProjectId || undefined}
      />
    );
  }

  if (tab === "ai-sessions") {
    return (
      <Suspense fallback={<div className="ai-sessions-loading">Loading AI sessions...</div>}>
        <AiSessionsPanel project={project} />
      </Suspense>
    );
  }

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
        <>
          <RequirementSection
            hasRepositories={project.repos.length > 0}
            isSaving={isSavingRequirements}
            isConvertingRfc={isConvertingRfc}
            isStartingRfc={isStartingRfc}
            onAdd={onAddRequirement}
            onEdit={onEditRequirement}
            onRemove={onRemoveRequirement}
            onConvertRfcDraft={onConvertRfcDraft}
            onReviewRfcDraft={onReviewRfcDraft}
            onUpdateRfcDraft={onUpdateRfcDraft}
            onWriteRfc={onWriteRfc}
            openingRfcDraftLink={openingRfcDraftLink}
            projectId={project.project_id}
            requirementListError={requirementListError}
            requirements={project.documents}
            rfcError={rfcError}
            updatingRfcDraftLink={updatingRfcDraftLink}
          />
          <RepositorySection
            isSaving={isSavingRepositories}
            onAdd={onAddRepository}
            onEdit={onEditRepository}
            onRemove={onRemoveRepository}
            repositories={project.repos}
            repositoryListError={repositoryListError}
          />
          <ProjectContextSection project={project} />
        </>
      );
    case "task-plan":
      return <TaskPlanSection onProjectUpdated={onProjectUpdated} project={project} />;
    case "code-implementation":
      return <CodeImplementationSection project={project} />;
    case "pr":
      return (
        <>
          <PullRequestsSection project={project} />
          <BranchesSection project={project} />
        </>
      );
  }
}

function RequirementSection({
  hasRepositories,
  isSaving,
  isConvertingRfc,
  isStartingRfc,
  onAdd,
  onConvertRfcDraft,
  onEdit,
  onRemove,
  onReviewRfcDraft,
  onUpdateRfcDraft,
  onWriteRfc,
  openingRfcDraftLink,
  projectId,
  requirementListError,
  requirements,
  rfcError,
  updatingRfcDraftLink
}: {
  hasRepositories: boolean;
  isSaving: boolean;
  isConvertingRfc: boolean;
  isStartingRfc: boolean;
  onAdd: () => void;
  onConvertRfcDraft: (index: number) => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onReviewRfcDraft: (index: number) => void;
  onUpdateRfcDraft: (index: number) => void;
  onWriteRfc: () => void;
  openingRfcDraftLink: string | null;
  projectId: string;
  requirementListError: string;
  requirements: DocumentSource[];
  rfcError: string;
  updatingRfcDraftLink: string | null;
}) {
  return (
    <section aria-labelledby="requirements-heading" className="requirements-section">
      <div className="requirements-section-header">
        <div>
          <p>Product inputs</p>
          <h2 id="requirements-heading">Documents</h2>
        </div>
        <div className="document-section-actions">
          <button
            className="write-rfc-button"
            disabled={
              isSaving ||
              isStartingRfc ||
              updatingRfcDraftLink !== null ||
              requirements.length === 0 ||
              !hasRepositories
            }
            onClick={onWriteRfc}
            type="button"
          >
            <FilePenLine aria-hidden="true" />
            <span>{isStartingRfc ? "Starting..." : "Write RFC"}</span>
          </button>
          <button
            className="add-requirement-button"
            disabled={isSaving || isStartingRfc || updatingRfcDraftLink !== null}
            onClick={onAdd}
            type="button"
          >
            <Plus aria-hidden="true" />
            <span>Add document</span>
          </button>
        </div>
      </div>

      {requirementListError ? (
        <p className="create-project-error" role="alert">
          {requirementListError}
        </p>
      ) : null}
      {rfcError ? (
        <p className="create-project-error" role="alert">
          {rfcError}
        </p>
      ) : null}

      {requirements.length === 0 ? (
        <div className="requirement-empty-state">
          <FileText aria-hidden="true" />
          <div>
            <strong>No documents</strong>
            <span>Add a document source.</span>
          </div>
        </div>
      ) : (
        <ul className="requirement-list">
          {requirements.map((requirement, index) => {
            const sourceLabel = requirementSourceLabel(requirement.type);
            const isRfcDraft = requirement.type === "rfc-draft";
            const isLocalDocument =
              requirement.type === "markdown" || requirement.type === "rfc-draft";
            const SourceIcon =
              requirement.type === "slack"
                ? MessageSquare
                : isRfcDraft
                  ? FilePenLine
                  : FileText;

            return (
              <li key={`${requirement.type}-${requirement.link}-${index}`}>
                <div className="requirement-details">
                  {requirement.title ? (
                    <strong className="requirement-title">{requirement.title}</strong>
                  ) : null}
                  <div className="requirement-source-type">
                    <SourceIcon aria-hidden="true" />
                    <strong>{sourceLabel}</strong>
                  </div>
                  <a
                    href={
                      isLocalDocument
                        ? `/api/projects/${encodeURIComponent(projectId)}/documents/markdown?path=${encodeURIComponent(
                            requirement.link
                          )}`
                        : requirement.link
                    }
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink aria-hidden="true" />
                    <code>{requirement.link}</code>
                  </a>
                </div>
                <div className="repository-actions">
                  {isRfcDraft ? (
                    <>
                      <button
                        aria-label={`Update ${sourceLabel}`}
                        className="repository-icon-button"
                        disabled={
                          isSaving ||
                          isStartingRfc ||
                          isConvertingRfc ||
                          openingRfcDraftLink !== null ||
                          updatingRfcDraftLink !== null
                        }
                        onClick={() => void onUpdateRfcDraft(index)}
                        title="Open RFC draft update session"
                        type="button"
                      >
                        <RefreshCw aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Review ${sourceLabel}`}
                        className="repository-icon-button"
                        disabled={
                          isSaving ||
                          isStartingRfc ||
                          isConvertingRfc ||
                          openingRfcDraftLink !== null ||
                          updatingRfcDraftLink !== null
                        }
                        onClick={() => void onReviewRfcDraft(index)}
                        title="Review RFC draft locally"
                        type="button"
                      >
                        <Eye aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Convert ${sourceLabel} to Confluence`}
                        className="repository-icon-button"
                        disabled={
                          isSaving ||
                          isStartingRfc ||
                          isConvertingRfc ||
                          openingRfcDraftLink !== null ||
                          updatingRfcDraftLink !== null
                        }
                        onClick={() => onConvertRfcDraft(index)}
                        title="Convert RFC draft to Confluence"
                        type="button"
                      >
                        <FileUp aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <button
                      aria-label={`Edit ${sourceLabel} document`}
                      className="repository-icon-button"
                      disabled={
                        isSaving ||
                        isStartingRfc ||
                        isConvertingRfc ||
                        updatingRfcDraftLink !== null
                      }
                      onClick={() => onEdit(index)}
                      title={`Edit ${sourceLabel} document`}
                      type="button"
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                  )}
                  <button
                    aria-label={`Remove ${sourceLabel} document`}
                    className="repository-icon-button is-danger"
                    disabled={
                      isSaving ||
                      isStartingRfc ||
                      isConvertingRfc ||
                      updatingRfcDraftLink !== null
                    }
                    onClick={() => onRemove(index)}
                    title={`Remove ${sourceLabel} document`}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
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

function requirementSourceLabel(type: DocumentSourceType): string {
  if (type === "rfc-draft") {
    return "RFC draft";
  }

  return requirementSourceOptions.find((source) => source.type === type)?.label ?? type;
}
