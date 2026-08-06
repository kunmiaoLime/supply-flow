"use client";

import {
  aiModelOptions,
  reasoningEffortsForProvider,
  supportsReasoningEffort,
  type AiProviderId,
  type ReasoningEffort,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";

interface AiSessionConfigurationFieldsProps {
  configuration: ResolvedAiSessionActionSettings | null;
  disabled: boolean;
  idPrefix: string;
  isLoading?: boolean;
  onChange: (configuration: ResolvedAiSessionActionSettings) => void;
}

export function AiSessionConfigurationFields({
  configuration,
  disabled,
  idPrefix,
  isLoading = false,
  onChange
}: AiSessionConfigurationFieldsProps) {
  const controlsDisabled = disabled || !configuration;
  const modelId = `${idPrefix}-model`;
  const reasoningEffortId = `${idPrefix}-reasoning-effort`;

  function updateModel(value: string) {
    if (!configuration) {
      return;
    }

    const selection = parseModelSelection(value);
    if (!selection) {
      return;
    }

    onChange({
      ...configuration,
      providerId: selection.providerId,
      model: selection.model,
      reasoningEffort: supportsReasoningEffort(
        selection.providerId,
        configuration.reasoningEffort
      )
        ? configuration.reasoningEffort
        : null
    });
  }

  function updateReasoningEffort(value: string) {
    if (!configuration) {
      return;
    }

    onChange({
      ...configuration,
      reasoningEffort: (value || null) as ReasoningEffort | null
    });
  }

  function toggleMode(field: "readOnly" | "yoloMode") {
    if (!configuration) {
      return;
    }

    onChange({ ...configuration, [field]: !configuration[field] });
  }

  return (
    <div aria-label="AI session configuration" className="session-configuration-fields">
      <label htmlFor={modelId}>
        <span>AI model</span>
        <select
          disabled={controlsDisabled}
          id={modelId}
          onChange={(event) => updateModel(event.target.value)}
          value={configuration ? modelSelectionValue(configuration) : ""}
        >
          {!configuration ? (
            <option value="">{isLoading ? "Loading models..." : "Models unavailable"}</option>
          ) : null}
          {renderModelOptions()}
          {configuration && !isKnownModelSelection(configuration) ? (
            <option value={modelSelectionValue(configuration)}>
              {formatCustomModelSelection(configuration)}
            </option>
          ) : null}
        </select>
      </label>
      <label htmlFor={reasoningEffortId}>
        <span>Reasoning effort</span>
        <select
          disabled={controlsDisabled}
          id={reasoningEffortId}
          onChange={(event) => updateReasoningEffort(event.target.value)}
          value={configuration?.reasoningEffort ?? ""}
        >
          <option value="">Use configured default</option>
          {configuration
            ? reasoningEffortsForProvider(configuration.providerId).map((effort) => (
                <option key={effort} value={effort}>
                  {formatReasoningEffort(effort)}
                </option>
              ))
            : null}
        </select>
      </label>
      <div className="session-mode-toggles">
        <div className="session-mode-toggle">
          <span>Read-only</span>
          <button
            aria-checked={configuration?.readOnly ?? false}
            aria-label={`${idPrefix} read-only`}
            className="ai-model-toggle"
            disabled={controlsDisabled}
            onClick={() => toggleMode("readOnly")}
            role="switch"
            title={configuration?.readOnly ? "Disable read-only" : "Enable read-only"}
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        </div>
        <div className="session-mode-toggle">
          <span>YOLO mode</span>
          <button
            aria-checked={configuration?.yoloMode ?? false}
            aria-label={`${idPrefix} YOLO mode`}
            className="ai-model-toggle"
            disabled={controlsDisabled}
            onClick={() => toggleMode("yoloMode")}
            role="switch"
            title={configuration?.yoloMode ? "Disable YOLO mode" : "Enable YOLO mode"}
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function modelSelectionValue(
  selection: Pick<ResolvedAiSessionActionSettings, "providerId" | "model">
): string {
  return JSON.stringify([selection.providerId, selection.model]);
}

function parseModelSelection(
  value: string
): { providerId: AiProviderId; model: string | null } | null {
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

function renderModelOptions() {
  return (["codex", "claude-code"] as const).map((providerId) => (
    <optgroup key={providerId} label={providerDisplayName(providerId)}>
      <option value={modelSelectionValue({ providerId, model: null })}>
        {providerDisplayName(providerId)} configured default
      </option>
      {aiModelOptions
        .filter((option) => option.providerId === providerId)
        .map((option) => (
          <option
            key={option.model}
            value={modelSelectionValue({
              providerId: option.providerId,
              model: option.model
            })}
          >
            {option.label}
          </option>
        ))}
    </optgroup>
  ));
}

function isKnownModelSelection(
  selection: Pick<ResolvedAiSessionActionSettings, "providerId" | "model">
): boolean {
  return (
    selection.model === null ||
    aiModelOptions.some(
      (option) =>
        option.providerId === selection.providerId && option.model === selection.model
    )
  );
}

function formatCustomModelSelection(
  selection: Pick<ResolvedAiSessionActionSettings, "providerId" | "model">
): string {
  return selection.model
    ? `${providerDisplayName(selection.providerId)}: ${selection.model}`
    : `${providerDisplayName(selection.providerId)} configured default`;
}

function formatReasoningEffort(effort: ReasoningEffort): string {
  return effort === "xhigh" ? "Extra high" : `${effort[0]?.toUpperCase()}${effort.slice(1)}`;
}

function providerDisplayName(providerId: AiProviderId): string {
  return providerId === "codex" ? "Codex" : "Claude Code";
}
