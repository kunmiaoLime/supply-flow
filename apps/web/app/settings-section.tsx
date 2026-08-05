"use client";

import {
  aiSessionActions,
  aiModelOptions,
  reasoningEffortsForProvider,
  supportsReasoningEffort,
  type AiModelSelection,
  type AiModelSettings,
  type AiProviderId,
  type AiSessionAction,
  type ReasoningEffort
} from "@supply-flow/core/ai-model-settings";
import type { PullRequestTemplate } from "@supply-flow/core/file-pull-request-template-store";
import { Bot, FileDown, FileText, Save } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

type SettingsTab = "pr-templates" | "ai-model";

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
  const [aiModelSettings, setAiModelSettings] = useState<AiModelSettings | null>(null);
  const [savedAiModelSettings, setSavedAiModelSettings] = useState<AiModelSettings | null>(
    null
  );
  const [isLoadingAiModelSettings, setIsLoadingAiModelSettings] = useState(true);
  const [isSavingAiModelSettings, setIsSavingAiModelSettings] = useState(false);
  const [aiModelSettingsError, setAiModelSettingsError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const selectedTemplate =
    templates.find((template) => template.repository === selectedRepository) ?? null;
  const isDirty = selectedTemplate !== null && editorContent !== selectedTemplate.content;
  const isAiModelSettingsDirty =
    aiModelSettings !== null &&
    savedAiModelSettings !== null &&
    JSON.stringify(aiModelSettings) !== JSON.stringify(savedAiModelSettings);

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
    let ignoreResult = false;

    async function loadAiModelSettings() {
      setIsLoadingAiModelSettings(true);
      setAiModelSettingsError("");

      try {
        const response = await fetch(aiModelsUrl(), { cache: "no-store" });
        const data = (await response.json()) as {
          settings?: AiModelSettings;
          error?: string;
        };
        if (!response.ok || !data.settings) {
          throw new Error(data.error ?? "Unable to load AI model settings.");
        }

        if (!ignoreResult) {
          setAiModelSettings(data.settings);
          setSavedAiModelSettings(data.settings);
        }
      } catch (error) {
        if (!ignoreResult) {
          setAiModelSettings(null);
          setSavedAiModelSettings(null);
          setAiModelSettingsError(
            error instanceof Error ? error.message : "Unable to load AI model settings."
          );
        }
      } finally {
        if (!ignoreResult) {
          setIsLoadingAiModelSettings(false);
        }
      }
    }

    void loadAiModelSettings();
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

  function updateAiModelSelection(action: AiSessionAction, value: string) {
    if (isSavingAiModelSettings) {
      return;
    }

    const selection = parseModelSelection(value);
    setAiModelSettings((currentSettings) => {
      if (!currentSettings) {
        return currentSettings;
      }

      const currentSelection = currentSettings.actions[action];
      const providerId = selection?.providerId ?? null;
      const effectiveProviderId = providerId ?? currentSettings.globalDefault.providerId;

      return {
        ...currentSettings,
        actions: {
          ...currentSettings.actions,
          [action]: {
            ...currentSelection,
            providerId,
            model: selection?.model ?? null,
            reasoningEffort: supportsReasoningEffort(
              effectiveProviderId,
              currentSelection.reasoningEffort
            )
              ? currentSelection.reasoningEffort
              : null
          }
        }
      };
    });
    setAiModelSettingsError("");
  }

  function updateAiModelReasoningEffort(action: AiSessionAction, value: string) {
    if (isSavingAiModelSettings) {
      return;
    }

    setAiModelSettings((currentSettings) => {
      if (!currentSettings) {
        return currentSettings;
      }

      return {
        ...currentSettings,
        actions: {
          ...currentSettings.actions,
          [action]: {
            ...currentSettings.actions[action],
            reasoningEffort: (value || null) as ReasoningEffort | null
          }
        }
      };
    });
    setAiModelSettingsError("");
  }

  function toggleAiSessionSetting(
    action: AiSessionAction,
    field: "readOnly" | "yoloMode"
  ) {
    if (isSavingAiModelSettings) {
      return;
    }

    setAiModelSettings((currentSettings) => {
      if (!currentSettings) {
        return currentSettings;
      }

      const currentSelection = currentSettings.actions[action];
      const nextValue = !currentSelection[field];
      return {
        ...currentSettings,
        actions: {
          ...currentSettings.actions,
          [action]: {
            ...currentSelection,
            [field]: nextValue,
            ...(field === "readOnly" && nextValue ? { yoloMode: false } : {}),
            ...(field === "yoloMode" && nextValue ? { readOnly: false } : {})
          }
        }
      };
    });
    setAiModelSettingsError("");
  }

  function updateGlobalDefaultSelection(value: string) {
    if (isSavingAiModelSettings) {
      return;
    }

    const selection = parseModelSelection(value);
    if (!selection) {
      return;
    }

    setAiModelSettings((currentSettings) => {
      if (!currentSettings) {
        return currentSettings;
      }

      const globalDefault = {
        ...currentSettings.globalDefault,
        providerId: selection.providerId,
        model: selection.model,
        reasoningEffort: supportsReasoningEffort(
          selection.providerId,
          currentSettings.globalDefault.reasoningEffort
        )
          ? currentSettings.globalDefault.reasoningEffort
          : null
      };
      const actions = { ...currentSettings.actions };
      for (const { id } of aiSessionActions) {
        const actionSettings = actions[id];
        if (
          actionSettings.providerId === null &&
          !supportsReasoningEffort(globalDefault.providerId, actionSettings.reasoningEffort)
        ) {
          actions[id] = { ...actionSettings, reasoningEffort: null };
        }
      }

      return {
        ...currentSettings,
        globalDefault,
        actions
      };
    });
    setAiModelSettingsError("");
  }

  function updateGlobalDefaultReasoningEffort(value: string) {
    if (isSavingAiModelSettings) {
      return;
    }

    setAiModelSettings((currentSettings) => {
      if (!currentSettings) {
        return currentSettings;
      }

      return {
        ...currentSettings,
        globalDefault: {
          ...currentSettings.globalDefault,
          reasoningEffort: (value || null) as ReasoningEffort | null
        }
      };
    });
    setAiModelSettingsError("");
  }

  async function saveAiModelSettings() {
    if (
      !aiModelSettings ||
      !isAiModelSettingsDirty ||
      isLoadingAiModelSettings ||
      isSavingAiModelSettings
    ) {
      return;
    }

    setIsSavingAiModelSettings(true);
    setAiModelSettingsError("");

    try {
      const response = await fetch(aiModelsUrl(), {
        body: JSON.stringify(aiModelSettings),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const data = (await response.json()) as {
        settings?: AiModelSettings;
        error?: string;
      };
      if (!response.ok || !data.settings) {
        throw new Error(data.error ?? "Unable to save AI model settings.");
      }

      setAiModelSettings(data.settings);
      setSavedAiModelSettings(data.settings);
    } catch (error) {
      setAiModelSettingsError(
        error instanceof Error ? error.message : "Unable to save AI model settings."
      );
    } finally {
      setIsSavingAiModelSettings(false);
    }
  }

  return (
    <>
      <section aria-label="Settings" className="settings-section">
        <div aria-label="Settings sections" className="settings-tab-list" role="tablist">
          <button
            aria-controls="pr-template-panel"
            aria-selected={activeTab === "pr-templates"}
            className={`settings-tab${activeTab === "pr-templates" ? " is-active" : ""}`}
            id="pr-template-tab"
            onClick={() => setActiveTab("pr-templates")}
            role="tab"
            type="button"
          >
            PR templates
          </button>
          <button
            aria-controls="ai-model-panel"
            aria-selected={activeTab === "ai-model"}
            className={`settings-tab${activeTab === "ai-model" ? " is-active" : ""}`}
            id="ai-model-tab"
            onClick={() => setActiveTab("ai-model")}
            role="tab"
            type="button"
          >
            AI model
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

        {activeTab === "ai-model" ? (
          <div
            aria-labelledby="ai-model-tab"
            className="settings-tab-panel"
            id="ai-model-panel"
            role="tabpanel"
          >
            {aiModelSettingsError ? (
              <p className="create-project-error" role="alert">
                {aiModelSettingsError}
              </p>
            ) : null}

            {isLoadingAiModelSettings ? (
              <div className="pr-template-empty-state">
                <Bot aria-hidden="true" />
                <span>Loading AI model defaults...</span>
              </div>
            ) : aiModelSettings ? (
              <div className="ai-model-defaults">
                <div className="ai-model-default-list">
                  <div className="ai-model-default-row">
                    <strong>Default</strong>
                    <label className="ai-model-default-field">
                      <span>AI model</span>
                      <select
                        disabled={isSavingAiModelSettings}
                        onChange={(event) =>
                          updateGlobalDefaultSelection(event.target.value)
                        }
                        value={modelSelectionValue(aiModelSettings.globalDefault)}
                      >
                        {renderModelOptions()}
                        {!isKnownModelSelection(aiModelSettings.globalDefault) ? (
                          <option value={modelSelectionValue(aiModelSettings.globalDefault)}>
                            {formatCustomModelSelection(aiModelSettings.globalDefault)}
                          </option>
                        ) : null}
                      </select>
                    </label>
                    <label className="ai-model-default-field">
                      <span>Reasoning effort</span>
                      <select
                        disabled={isSavingAiModelSettings}
                        onChange={(event) =>
                          updateGlobalDefaultReasoningEffort(event.target.value)
                        }
                        value={aiModelSettings.globalDefault.reasoningEffort ?? ""}
                      >
                        <option value="">Use configured default</option>
                        {reasoningEffortsForProvider(
                          aiModelSettings.globalDefault.providerId
                        ).map((effort) => (
                          <option key={effort} value={effort}>
                            {formatReasoningEffort(effort)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {aiSessionActions.map((action) => {
                    const selection = aiModelSettings.actions[action.id];
                    const effectiveProviderId =
                      selection.providerId ?? aiModelSettings.globalDefault.providerId;
                    return (
                      <div className="ai-model-default-row" key={action.id}>
                        <strong>{action.label}</strong>
                        <label className="ai-model-default-field">
                          <span>AI model</span>
                          <select
                            disabled={isSavingAiModelSettings}
                            onChange={(event) =>
                              updateAiModelSelection(action.id, event.target.value)
                            }
                            value={modelSelectionValue(selection)}
                          >
                            <option value="">Use default</option>
                            {renderModelOptions()}
                            {selection.providerId !== null &&
                            !isKnownModelSelection(selection) ? (
                              <option value={modelSelectionValue(selection)}>
                                {formatCustomModelSelection(selection)}
                              </option>
                            ) : null}
                          </select>
                        </label>
                        <label className="ai-model-default-field">
                          <span>Reasoning effort</span>
                          <select
                            disabled={isSavingAiModelSettings}
                            onChange={(event) =>
                              updateAiModelReasoningEffort(action.id, event.target.value)
                            }
                            value={selection.reasoningEffort ?? ""}
                          >
                            <option value="">Use default</option>
                            {reasoningEffortsForProvider(effectiveProviderId).map((effort) => (
                              <option key={effort} value={effort}>
                                {formatReasoningEffort(effort)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="ai-model-default-toggle">
                          <span>Read-only</span>
                          <button
                            aria-checked={selection.readOnly}
                            aria-label={`${action.label} read-only`}
                            className="ai-model-toggle"
                            disabled={isSavingAiModelSettings}
                            onClick={() => toggleAiSessionSetting(action.id, "readOnly")}
                            role="switch"
                            title={
                              selection.readOnly
                                ? "Disable read-only"
                                : "Enable read-only"
                            }
                            type="button"
                          >
                            <span aria-hidden="true" />
                          </button>
                        </div>
                        <div className="ai-model-default-toggle">
                          <span>YOLO mode</span>
                          <button
                            aria-checked={selection.yoloMode}
                            aria-label={`${action.label} YOLO mode`}
                            className="ai-model-toggle"
                            disabled={isSavingAiModelSettings}
                            onClick={() => toggleAiSessionSetting(action.id, "yoloMode")}
                            role="switch"
                            title={
                              selection.yoloMode
                                ? "Disable YOLO mode"
                                : "Enable YOLO mode"
                            }
                            type="button"
                          >
                            <span aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="ai-model-default-actions">
                  <button
                    className="save-pr-template-button"
                    disabled={
                      isSavingAiModelSettings ||
                      isLoadingAiModelSettings ||
                      !isAiModelSettingsDirty
                    }
                    onClick={() => void saveAiModelSettings()}
                    type="button"
                  >
                    <Save aria-hidden="true" />
                    <span>{isSavingAiModelSettings ? "Saving..." : "Save"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="pr-template-empty-state">
                <Bot aria-hidden="true" />
                <span>AI model defaults are unavailable.</span>
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

function aiModelsUrl(): string {
  return "/api/settings/ai-models";
}

function formatReasoningEffort(effort: ReasoningEffort): string {
  return effort === "xhigh" ? "Extra high" : `${effort[0]?.toUpperCase()}${effort.slice(1)}`;
}

function renderModelOptions() {
  return (["codex", "claude-code"] as const).map((providerId) => (
    <optgroup key={providerId} label={providerDisplayName(providerId)}>
      <option
        value={modelSelectionValue({
          providerId,
          model: null,
          reasoningEffort: null
        })}
      >
        {providerDisplayName(providerId)} configured default
      </option>
      {aiModelOptions
        .filter((option) => option.providerId === providerId)
        .map((option) => (
          <option
            key={option.model}
            value={modelSelectionValue({
              providerId: option.providerId,
              model: option.model,
              reasoningEffort: null
            })}
          >
            {option.label}
          </option>
        ))}
    </optgroup>
  ));
}

function modelSelectionValue(selection: AiModelSelection): string {
  if (!selection.providerId) {
    return "";
  }

  return JSON.stringify([selection.providerId, selection.model]);
}

function parseModelSelection(
  value: string
): { providerId: AiProviderId; model: string | null } | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      (parsed[0] !== "codex" && parsed[0] !== "claude-code") ||
      (typeof parsed[1] !== "string" && parsed[1] !== null)
    ) {
      return null;
    }

    return {
      providerId: parsed[0] as AiProviderId,
      model: parsed[1]
    };
  } catch {
    return null;
  }
}

function isKnownModelSelection(selection: AiModelSelection): boolean {
  return (
    selection.providerId !== null &&
    (selection.model === null ||
      aiModelOptions.some(
        (option) =>
          option.providerId === selection.providerId && option.model === selection.model
      ))
  );
}

function formatCustomModelSelection(selection: AiModelSelection): string {
  if (!selection.providerId) {
    return "Use default";
  }

  return selection.model
    ? `${providerDisplayName(selection.providerId)}: ${selection.model}`
    : `${providerDisplayName(selection.providerId)} configured default`;
}

function providerDisplayName(providerId: AiProviderId): string {
  return providerId === "codex" ? "Codex" : "Claude Code";
}

function sortTemplates(templates: PullRequestTemplate[]): PullRequestTemplate[] {
  return [...templates].sort((first, second) =>
    first.repository.localeCompare(second.repository)
  );
}
