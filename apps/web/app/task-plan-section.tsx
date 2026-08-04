"use client";

import type { ProjectRecord, ProjectTask } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { Check, Copy, ExternalLink, ListPlus, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

type TaskDialogMode = "add" | "edit" | "track" | null;

interface TaskForm {
  title: string;
  jira_ticket: string;
  parent_ticket: string;
  goal: string;
}

const emptyTaskForm: TaskForm = {
  title: "",
  jira_ticket: "",
  parent_ticket: "",
  goal: ""
};

export function TaskPlanSection({
  project,
  onProjectUpdated
}: {
  project: ProjectRecord;
  onProjectUpdated: (project: ProjectRecord) => void;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<ProjectTask[]>(project.tasks);
  const [dialogMode, setDialogMode] = useState<TaskDialogMode>(null);
  const [editingTaskIndex, setEditingTaskIndex] = useState<number | null>(null);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [dialogError, setDialogError] = useState("");
  const [listError, setListError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [copiedTicketUrl, setCopiedTicketUrl] = useState<string | null>(null);
  const taskTitleInput = useRef<HTMLInputElement>(null);
  const taskTicketInput = useRef<HTMLInputElement>(null);
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTasks(project.tasks);
    setCopiedTicketUrl(null);
  }, [project.project_id, project.tasks]);

  useEffect(
    () => () => {
      if (copyResetTimeout.current) {
        clearTimeout(copyResetTimeout.current);
      }
    },
    []
  );

  useEffect(() => {
    if (dialogMode) {
      (dialogMode === "track" ? taskTicketInput : taskTitleInput).current?.focus();
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

  function openAddDialog() {
    setTaskForm(emptyTaskForm);
    setEditingTaskIndex(null);
    setDialogError("");
    setDialogMode("add");
  }

  function openTrackDialog() {
    setTaskForm(emptyTaskForm);
    setEditingTaskIndex(null);
    setDialogError("");
    setDialogMode("track");
  }

  function openEditDialog(index: number) {
    const task = tasks[index];
    if (!task) {
      return;
    }

    setTaskForm({ ...emptyTaskForm, ...task });
    setEditingTaskIndex(index);
    setDialogError("");
    setDialogMode("edit");
  }

  function closeDialog() {
    if (!isSaving) {
      setDialogMode(null);
      setDialogError("");
    }
  }

  async function persistTasks(nextTasks: ProjectTask[]): Promise<void> {
    const response = await fetch(`/api/projects/${encodeURIComponent(project.project_id)}`, {
      body: JSON.stringify({ tasks: nextTasks }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH"
    });
    const data = (await response.json()) as { error?: string; project?: ProjectRecord };
    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Unable to update tasks.");
    }

    setTasks(data.project.tasks);
    onProjectUpdated(data.project);
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialogMode || (dialogMode === "edit" && editingTaskIndex === null)) {
      return;
    }

    if (dialogMode === "add") {
      await startTaskCreationSession();
      return;
    }
    if (dialogMode === "track") {
      await trackTask();
      return;
    }

    const task: ProjectTask = {
      title: taskForm.title.trim(),
      jira_ticket: taskForm.jira_ticket.trim()
    };
    if (!task.title || !task.jira_ticket) {
      setDialogError("Enter a task title and Jira ticket link.");
      return;
    }

    const duplicateTicket = tasks.some(
      (currentTask, index) =>
        currentTask.jira_ticket === task.jira_ticket && index !== editingTaskIndex
    );
    if (duplicateTicket) {
      setDialogError("This Jira ticket is already in the task plan.");
      return;
    }

    setIsSaving(true);
    setDialogError("");
    setListError("");

    try {
      await persistTasks(
        tasks.map((currentTask, index) =>
          index === editingTaskIndex ? task : currentTask
        )
      );
      setDialogMode(null);
      setEditingTaskIndex(null);
      setTaskForm(emptyTaskForm);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Unable to update tasks.");
    } finally {
      setIsSaving(false);
    }
  }

  async function startTaskCreationSession() {
    const title = taskForm.title.trim();
    const parentTicket = taskForm.parent_ticket.trim();
    const goal = taskForm.goal.trim();

    if (!title || !parentTicket) {
      setDialogError("Enter a task title and parent ticket link.");
      return;
    }

    setIsSaving(true);
    setDialogError("");
    setListError("");

    try {
      const response = await fetch(taskSessionUrl(project.project_id), {
        body: JSON.stringify({ title, parentTicket, ...(goal ? { goal } : {}) }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { session?: SessionRecord; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? "Unable to start the task session.");
      }

      router.push(
        `/ai_sessions/${encodeURIComponent(project.project_id)}?session=${encodeURIComponent(
          data.session.id
        )}`
      );
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Unable to start the task session."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function trackTask() {
    const jiraTicket = taskForm.jira_ticket.trim();
    if (!jiraTicket) {
      setDialogError("Enter a Jira ticket link.");
      return;
    }

    setIsSaving(true);
    setDialogError("");
    setListError("");

    try {
      const response = await fetch(trackTaskUrl(project.project_id), {
        body: JSON.stringify({ jiraTicket }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as { error?: string; project?: ProjectRecord };
      if (!response.ok || !data.project) {
        throw new Error(data.error ?? "Unable to import the Jira ticket.");
      }

      setTasks(data.project.tasks);
      onProjectUpdated(data.project);
      setDialogMode(null);
      setTaskForm(emptyTaskForm);
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Unable to import the Jira ticket."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function removeTask(index: number) {
    if (isSaving || !tasks[index]) {
      return;
    }

    setIsSaving(true);
    setListError("");

    try {
      await persistTasks(tasks.filter((_, taskIndex) => taskIndex !== index));
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Unable to remove the task.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyTicketUrl(task: ProjectTask) {
    setListError("");

    try {
      await navigator.clipboard.writeText(task.jira_ticket);
      setCopiedTicketUrl(task.jira_ticket);
      if (copyResetTimeout.current) {
        clearTimeout(copyResetTimeout.current);
      }
      copyResetTimeout.current = setTimeout(() => {
        setCopiedTicketUrl(null);
        copyResetTimeout.current = null;
      }, 2_000);
    } catch {
      setListError("Unable to copy the Jira ticket link. Check browser clipboard permissions.");
    }
  }

  return (
    <>
      <section aria-labelledby="project-tasks-heading" className="task-plan-section">
        <div className="task-plan-section-header">
          <div>
            <p>Jira work</p>
            <h2 id="project-tasks-heading">Tasks</h2>
          </div>
          <div className="task-plan-actions">
            <button
              className="track-task-button"
              disabled={isSaving}
              onClick={openTrackDialog}
              type="button"
            >
              <ListPlus aria-hidden="true" />
              <span>Import task</span>
            </button>
            <button
              className="add-task-button"
              disabled={isSaving}
              onClick={openAddDialog}
              type="button"
            >
              <Plus aria-hidden="true" />
              <span>New task</span>
            </button>
          </div>
        </div>

        {listError ? (
          <p className="create-project-error" role="alert">
            {listError}
          </p>
        ) : null}

        {tasks.length === 0 ? (
          <div className="task-empty-state">
            <ListTodo aria-hidden="true" />
            <div>
              <strong>No tasks</strong>
              <span>Start a session to create a Jira task.</span>
            </div>
          </div>
        ) : (
          <ul className="project-task-list">
            {tasks.map((task, index) => (
              <li key={`${task.title}-${task.jira_ticket}-${index}`}>
                <div className="project-task-details">
                  <strong>{task.title}</strong>
                  <a href={task.jira_ticket} rel="noreferrer" target="_blank">
                    <ExternalLink aria-hidden="true" />
                    <code>{task.jira_ticket}</code>
                  </a>
                </div>
                <div className="repository-actions">
                  <button
                    aria-label={`Copy Jira ticket link for ${task.title}`}
                    className={`repository-icon-button${
                      copiedTicketUrl === task.jira_ticket ? " is-copied" : ""
                    }`}
                    onClick={() => void copyTicketUrl(task)}
                    title={
                      copiedTicketUrl === task.jira_ticket
                        ? "Copied Jira ticket link"
                        : "Copy Jira ticket link"
                    }
                    type="button"
                  >
                    {copiedTicketUrl === task.jira_ticket ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                  </button>
                  <button
                    aria-label={`Edit ${task.title}`}
                    className="repository-icon-button"
                    disabled={isSaving}
                    onClick={() => openEditDialog(index)}
                    title={`Edit ${task.title}`}
                    type="button"
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    aria-label={`Remove ${task.title}`}
                    className="repository-icon-button is-danger"
                    disabled={isSaving}
                    onClick={() => void removeTask(index)}
                    title={`Remove ${task.title}`}
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
            aria-labelledby="task-dialog-title"
            aria-modal="true"
            className="create-project-dialog task-dialog"
            role="dialog"
          >
            <h2 id="task-dialog-title">
              {dialogMode === "add"
                ? "New task"
                : dialogMode === "track"
                  ? "Import task"
                  : "Edit task"}
            </h2>
            <form onSubmit={saveTask}>
              <div className="task-form-fields">
                {dialogMode !== "track" ? (
                  <label htmlFor="task-title">
                    <span>Task title</span>
                    <input
                      autoComplete="off"
                      id="task-title"
                      maxLength={dialogMode === "add" ? 120 : 255}
                      onChange={(event) =>
                        setTaskForm((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="Task title"
                      ref={taskTitleInput}
                      required
                      type="text"
                      value={taskForm.title}
                    />
                  </label>
                ) : null}
                {dialogMode === "add" ? (
                  <>
                    <label htmlFor="task-parent-ticket">
                      <span>Parent ticket link</span>
                      <input
                        autoCapitalize="none"
                        autoComplete="off"
                        id="task-parent-ticket"
                        maxLength={2_048}
                        onChange={(event) =>
                          setTaskForm((current) => ({
                            ...current,
                            parent_ticket: event.target.value
                          }))
                        }
                        placeholder="https://.../browse/PROJECT-123"
                        required
                        spellCheck={false}
                        type="url"
                        value={taskForm.parent_ticket}
                      />
                    </label>
                    <label htmlFor="task-goal">
                      <span>Task goal (optional)</span>
                      <textarea
                        id="task-goal"
                        maxLength={12_000}
                        onChange={(event) =>
                          setTaskForm((current) => ({ ...current, goal: event.target.value }))
                        }
                        placeholder="Describe the intended outcome, constraints, or acceptance criteria."
                        rows={5}
                        value={taskForm.goal}
                      />
                    </label>
                  </>
                ) : (
                  <label htmlFor="task-jira-ticket">
                    <span>Jira ticket link</span>
                    <input
                      autoCapitalize="none"
                      autoComplete="off"
                      id="task-jira-ticket"
                      maxLength={2_048}
                      onChange={(event) =>
                        setTaskForm((current) => ({
                          ...current,
                          jira_ticket: event.target.value
                        }))
                      }
                      placeholder="https://.../browse/PROJECT-123"
                      ref={dialogMode === "track" ? taskTicketInput : undefined}
                      required
                      spellCheck={false}
                      type="url"
                      value={taskForm.jira_ticket}
                    />
                  </label>
                )}
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
                  onClick={closeDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="dialog-primary-button" disabled={isSaving} type="submit">
                  <Plus aria-hidden="true" />
                  <span>
                    {isSaving
                      ? dialogMode === "add"
                        ? "Starting..."
                        : dialogMode === "track"
                          ? "Importing..."
                        : "Saving..."
                      : dialogMode === "add"
                        ? "Start session"
                        : dialogMode === "track"
                          ? "Import task"
                        : "Save task"}
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

function taskSessionUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/tasks/session`;
}

function trackTaskUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/tasks/track`;
}
