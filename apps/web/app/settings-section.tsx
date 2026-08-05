"use client";

import type { PullRequestTemplate } from "@supply-flow/core/file-pull-request-template-store";
import { FileDown, FileText, Save } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

type SettingsTab = "pr-templates";

const MAX_TEMPLATE_LENGTH = 100_000;

export function SettingsSection() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("pr-templates");
  const [templates, setTemplates] = useState<PullRequestTemplate[]>([]);
  const [selectedRepository, setSelectedRepository] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [listError, setListError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const selectedTemplate =
    templates.find((template) => template.repository === selectedRepository) ?? null;
  const isDirty = selectedTemplate !== null && editorContent !== selectedTemplate.content;

  useEffect(() => {
    let ignoreResult = false;

    async function loadTemplates() {
      setIsLoading(true);
      setListError("");

      try {
        const response = await fetch(prTemplatesUrl(), { cache: "no-store" });
        const data = (await response.json()) as {
          templates?: PullRequestTemplate[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load PR templates.");
        }

        if (!ignoreResult) {
          setTemplates(data.templates ?? []);
        }
      } catch (error) {
        if (!ignoreResult) {
          setTemplates([]);
          setListError(error instanceof Error ? error.message : "Unable to load PR templates.");
        }
      } finally {
        if (!ignoreResult) {
          setIsLoading(false);
        }
      }
    }

    void loadTemplates();
    return () => {
      ignoreResult = true;
    };
  }, []);

  useEffect(() => {
    if (selectedRepository && !selectedTemplate) {
      setSelectedRepository("");
      setEditorContent("");
    }
  }, [selectedRepository, selectedTemplate]);

  useEffect(() => {
    if (isImportDialogOpen) {
      importInput.current?.focus();
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

  function chooseTemplate(repository: string) {
    if (isSaving) {
      return;
    }
    if (
      isDirty &&
      !window.confirm("Discard the unsaved changes to this PR template?")
    ) {
      return;
    }

    const template = templates.find((currentTemplate) => currentTemplate.repository === repository);
    setSelectedRepository(repository);
    setEditorContent(template?.content ?? "");
    setListError("");
  }

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

  async function importTemplate(event: FormEvent<HTMLFormElement>) {
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
      const response = await fetch(prTemplatesUrl(), {
        body: JSON.stringify({ url }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = (await response.json()) as {
        template?: PullRequestTemplate;
        error?: string;
      };
      if (!response.ok || !data.template) {
        throw new Error(data.error ?? "Unable to import the PR template.");
      }

      const template = data.template;
      setTemplates((currentTemplates) =>
        sortTemplates([
          ...currentTemplates.filter(
            (currentTemplate) => currentTemplate.repository !== template.repository
          ),
          template
        ])
      );
      setSelectedRepository(template.repository);
      setEditorContent(template.content);
      setPullRequestUrl("");
      setIsImportDialogOpen(false);
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Unable to import the PR template."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveTemplate() {
    if (!selectedTemplate || !isDirty || isSaving) {
      return;
    }
    if (!editorContent.trim()) {
      setListError("A PR template cannot be empty.");
      return;
    }

    setIsSaving(true);
    setListError("");

    try {
      const response = await fetch(prTemplatesUrl(), {
        body: JSON.stringify({
          repository: selectedTemplate.repository,
          content: editorContent
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const data = (await response.json()) as {
        template?: PullRequestTemplate;
        error?: string;
      };
      if (!response.ok || !data.template) {
        throw new Error(data.error ?? "Unable to save the PR template.");
      }

      setTemplates((currentTemplates) =>
        sortTemplates(
          currentTemplates.map((currentTemplate) =>
            currentTemplate.repository === data.template?.repository
              ? (data.template as PullRequestTemplate)
              : currentTemplate
          )
        )
      );
      setEditorContent(data.template.content);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Unable to save the PR template.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <section aria-label="Settings" className="settings-section">
        <div aria-label="Settings sections" className="settings-tab-list" role="tablist">
          <button
            aria-controls="pr-template-panel"
            aria-selected={activeTab === "pr-templates"}
            className="settings-tab is-active"
            id="pr-template-tab"
            onClick={() => setActiveTab("pr-templates")}
            role="tab"
            type="button"
          >
            PR templates
          </button>
        </div>

        {activeTab === "pr-templates" ? (
          <div
            aria-labelledby="pr-template-tab"
            className="settings-tab-panel"
            id="pr-template-panel"
            role="tabpanel"
          >
            <div className="pr-template-toolbar">
              <label className="pr-template-selector" htmlFor="pr-template-repository">
                <span>Repository</span>
                <select
                  disabled={isLoading || isSaving || templates.length === 0}
                  id="pr-template-repository"
                  onChange={(event) => chooseTemplate(event.target.value)}
                  value={selectedRepository}
                >
                  <option value="">
                    {isLoading
                      ? "Loading templates..."
                      : templates.length === 0
                        ? "No PR templates"
                        : "Select a repository"}
                  </option>
                  {templates.map((template) => (
                    <option key={template.repository} value={template.repository}>
                      {template.repository}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="import-pr-template-button"
                disabled={isLoading || isSaving}
                onClick={openImportDialog}
                type="button"
              >
                <FileDown aria-hidden="true" />
                <span>Import PR template</span>
              </button>
            </div>

            {listError ? (
              <p className="create-project-error" role="alert">
                {listError}
              </p>
            ) : null}

            {isLoading ? (
              <div className="pr-template-empty-state">
                <FileText aria-hidden="true" />
                <span>Loading PR templates...</span>
              </div>
            ) : selectedTemplate ? (
              <div className="pr-template-editor">
                <div className="pr-template-editor-heading">
                  <strong>{selectedTemplate.repository}</strong>
                  <span>{editorContent.length.toLocaleString()} characters</span>
                </div>
                <textarea
                  aria-label={`PR template for ${selectedTemplate.repository}`}
                  disabled={isSaving}
                  maxLength={MAX_TEMPLATE_LENGTH}
                  onChange={(event) => setEditorContent(event.target.value)}
                  spellCheck={false}
                  value={editorContent}
                />
                <div className="pr-template-editor-actions">
                  <button
                    className="save-pr-template-button"
                    disabled={isSaving || !isDirty || !editorContent.trim()}
                    onClick={() => void saveTemplate()}
                    type="button"
                  >
                    <Save aria-hidden="true" />
                    <span>{isSaving ? "Saving..." : "Save template"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="pr-template-empty-state">
                <FileText aria-hidden="true" />
                <span>Select a repository template to edit it.</span>
              </div>
            )}
          </div>
        ) : null}
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
            aria-labelledby="pr-template-import-title"
            aria-modal="true"
            className="create-project-dialog pr-template-import-dialog"
            role="dialog"
          >
            <h2 id="pr-template-import-title">Import PR template</h2>
            <form onSubmit={importTemplate}>
              <div className="pull-request-form-fields">
                <label htmlFor="pr-template-import-url">
                  <span>GitHub pull request link</span>
                  <input
                    autoCapitalize="none"
                    autoComplete="off"
                    disabled={isSaving}
                    id="pr-template-import-url"
                    maxLength={2_048}
                    onChange={(event) => setPullRequestUrl(event.target.value)}
                    placeholder="https://github.com/owner/repository/pull/123"
                    ref={importInput}
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
                  <FileDown aria-hidden="true" />
                  <span>{isSaving ? "Importing..." : "Import template"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

function prTemplatesUrl(): string {
  return "/api/settings/pr-templates";
}

function sortTemplates(templates: PullRequestTemplate[]): PullRequestTemplate[] {
  return [...templates].sort((first, second) =>
    first.repository.localeCompare(second.repository)
  );
}
