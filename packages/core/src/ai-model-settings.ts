import { z } from "zod";

export const aiSessionActionIds = [
  "new-session",
  "initialize-context",
  "update-context",
  "create-task",
  "implement-code",
  "create-pull-request",
  "address-pull-request"
] as const;

export const AiSessionActionSchema = z.enum(aiSessionActionIds);

export type AiSessionAction = z.infer<typeof AiSessionActionSchema>;

export const aiSessionActions: readonly {
  id: AiSessionAction;
  label: string;
}[] = [
  { id: "new-session", label: "New AI session" },
  { id: "initialize-context", label: "Initialize context" },
  { id: "update-context", label: "Update context" },
  { id: "create-task", label: "Create Jira task" },
  { id: "implement-code", label: "Implement code" },
  { id: "create-pull-request", label: "Create pull request" },
  { id: "address-pull-request", label: "Address PR issues" }
];

export const aiProviderIds = ["codex", "claude-code"] as const;

export const AiProviderIdSchema = z.enum(aiProviderIds);

export type AiProviderId = z.infer<typeof AiProviderIdSchema>;

export const reasoningEffortValues = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;

export const ReasoningEffortSchema = z.enum(reasoningEffortValues);

export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const reasoningEffortsByProvider: Readonly<
  Record<AiProviderId, readonly ReasoningEffort[]>
> = {
  codex: ["minimal", "low", "medium", "high", "xhigh"],
  "claude-code": ["low", "medium", "high", "xhigh", "max"]
};

export const aiModelOptions: readonly {
  label: string;
  model: string;
  providerId: AiProviderId;
}[] = [
  { label: "GPT-5.6 Terra", model: "openai.gpt-5.6-terra", providerId: "codex" },
  { label: "GPT-5.3 Codex", model: "gpt-5.3-codex", providerId: "codex" },
  { label: "GPT-5.2 Codex", model: "gpt-5.2-codex", providerId: "codex" },
  { label: "GPT-5.1 Codex", model: "gpt-5.1-codex", providerId: "codex" },
  { label: "GPT-5.1 Codex Mini", model: "gpt-5.1-codex-mini", providerId: "codex" },
  { label: "Claude Opus (latest)", model: "opus", providerId: "claude-code" },
  { label: "Claude Opus 5.0", model: "claude-opus-5", providerId: "claude-code" },
  { label: "Claude Opus 4.8", model: "claude-opus-4-8", providerId: "claude-code" },
  { label: "Claude Sonnet (latest)", model: "sonnet", providerId: "claude-code" },
  { label: "Claude Sonnet 5.0", model: "claude-sonnet-5", providerId: "claude-code" },
  { label: "Claude Sonnet 4.8", model: "claude-sonnet-4-8", providerId: "claude-code" },
  { label: "Claude Fable (latest)", model: "fable", providerId: "claude-code" },
  { label: "Claude Fable 5.0", model: "claude-fable-5", providerId: "claude-code" },
  { label: "Claude Fable 4.8", model: "claude-fable-4-8", providerId: "claude-code" }
];

const AiModelSelectionInputSchema = z.object({
  providerId: AiProviderIdSchema.nullable().optional(),
  model: z.string().trim().min(1).max(120).nullable(),
  reasoningEffort: ReasoningEffortSchema.nullable()
});

const AiModelActionSettingsInputSchema = AiModelSelectionInputSchema.extend({
  readOnly: z.boolean().optional(),
  yoloMode: z.boolean().optional()
});

type AiModelSelectionInput = z.infer<typeof AiModelSelectionInputSchema>;
type AiModelActionSettingsInput = z.infer<typeof AiModelActionSettingsInputSchema>;

export interface AiModelSelection {
  providerId: AiProviderId | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
}

export interface AiModelGlobalDefault extends Omit<AiModelSelection, "providerId"> {
  providerId: AiProviderId;
}

export interface AiSessionActionSettings extends AiModelSelection {
  readOnly: boolean;
  yoloMode: boolean;
}

export interface ResolvedAiSessionActionSettings
  extends Omit<AiSessionActionSettings, "providerId"> {
  providerId: AiProviderId;
}

export interface AiModelSettings {
  schemaVersion: 1;
  globalDefault: AiModelGlobalDefault;
  actions: Record<AiSessionAction, AiSessionActionSettings>;
}

const AiModelActionDefaultsSchema = z.object({
  "new-session": AiModelActionSettingsInputSchema,
  "initialize-context": AiModelActionSettingsInputSchema,
  "update-context": AiModelActionSettingsInputSchema,
  "create-task": AiModelActionSettingsInputSchema,
  "implement-code": AiModelActionSettingsInputSchema,
  "create-pull-request": AiModelActionSettingsInputSchema,
  "address-pull-request": AiModelActionSettingsInputSchema
});

const AiModelSettingsInputSchema = z.object({
  schemaVersion: z.literal(1),
  globalDefault: AiModelSelectionInputSchema.optional(),
  // Keep parsing this field so settings written before provider support migrate on save.
  codexDefault: AiModelSelectionInputSchema.optional(),
  actions: AiModelActionDefaultsSchema
});

export const AiModelSettingsSchema = AiModelSettingsInputSchema.transform(
  ({ actions, codexDefault, globalDefault, schemaVersion }): AiModelSettings => {
    const normalizedGlobalDefault = normalizeGlobalDefault(
      globalDefault ?? codexDefault ?? createDefaultSelection()
    );

    return {
      schemaVersion,
      globalDefault: normalizedGlobalDefault,
      actions: {
        "new-session": normalizeActionSettings(
          actions["new-session"],
          "new-session",
          normalizedGlobalDefault
        ),
        "initialize-context": normalizeActionSettings(
          actions["initialize-context"],
          "initialize-context",
          normalizedGlobalDefault
        ),
        "update-context": normalizeActionSettings(
          actions["update-context"],
          "update-context",
          normalizedGlobalDefault
        ),
        "create-task": normalizeActionSettings(
          actions["create-task"],
          "create-task",
          normalizedGlobalDefault
        ),
        "implement-code": normalizeActionSettings(
          actions["implement-code"],
          "implement-code",
          normalizedGlobalDefault
        ),
        "create-pull-request": normalizeActionSettings(
          actions["create-pull-request"],
          "create-pull-request",
          normalizedGlobalDefault
        ),
        "address-pull-request": normalizeActionSettings(
          actions["address-pull-request"],
          "address-pull-request",
          normalizedGlobalDefault
        )
      }
    };
  }
);

export function createDefaultAiModelSettings(): AiModelSettings {
  return {
    schemaVersion: 1,
    globalDefault: createDefaultGlobalDefault(),
    actions: {
      "new-session": createDefaultActionSettings("new-session"),
      "initialize-context": createDefaultActionSettings("initialize-context"),
      "update-context": createDefaultActionSettings("update-context"),
      "create-task": createDefaultActionSettings("create-task"),
      "implement-code": createDefaultActionSettings("implement-code"),
      "create-pull-request": createDefaultActionSettings("create-pull-request"),
      "address-pull-request": createDefaultActionSettings("address-pull-request")
    }
  };
}

export function resolveAiModelDefault(
  settings: AiModelSettings,
  action: AiSessionAction
): ResolvedAiSessionActionSettings {
  const actionDefault = settings.actions[action];
  const inheritsGlobalProvider = actionDefault.providerId === null;
  const providerId = actionDefault.providerId ?? settings.globalDefault.providerId;

  return {
    providerId,
    model: inheritsGlobalProvider
      ? (actionDefault.model ?? settings.globalDefault.model)
      : actionDefault.model,
    reasoningEffort: inheritsGlobalProvider
      ? (actionDefault.reasoningEffort ?? settings.globalDefault.reasoningEffort)
      : actionDefault.reasoningEffort,
    readOnly: actionDefault.readOnly,
    yoloMode: actionDefault.yoloMode
  };
}

export function reasoningEffortsForProvider(
  providerId: AiProviderId
): readonly ReasoningEffort[] {
  return reasoningEffortsByProvider[providerId];
}

export function supportsReasoningEffort(
  providerId: AiProviderId,
  effort: ReasoningEffort | null
): boolean {
  return effort === null || reasoningEffortsForProvider(providerId).includes(effort);
}

function createDefaultSelection(
  providerId: AiProviderId | null = null
): AiModelSelection {
  return {
    providerId,
    model: null,
    reasoningEffort: null
  };
}

function createDefaultGlobalDefault(): AiModelGlobalDefault {
  return {
    providerId: "codex",
    model: null,
    reasoningEffort: null
  };
}

function createDefaultActionSettings(action: AiSessionAction): AiSessionActionSettings {
  return {
    ...createDefaultSelection(),
    readOnly: action === "new-session",
    yoloMode: action !== "new-session"
  };
}

function normalizeGlobalDefault(
  settings: AiModelSelectionInput
): AiModelGlobalDefault {
  const selection = normalizeSelection(settings, "codex");
  return {
    ...selection,
    providerId: selection.providerId ?? "codex",
    reasoningEffort: supportsReasoningEffort(
      selection.providerId ?? "codex",
      selection.reasoningEffort
    )
      ? selection.reasoningEffort
      : null
  };
}

function normalizeActionSettings(
  settings: AiModelActionSettingsInput,
  action: AiSessionAction,
  globalDefault: AiModelGlobalDefault
): AiSessionActionSettings {
  const defaults = createDefaultActionSettings(action);
  const isLegacyProviderSelection =
    settings.providerId === undefined &&
    (settings.model !== null || settings.reasoningEffort !== null);
  const initialSelection = normalizeSelection(settings, "codex");
  const selection =
    isLegacyProviderSelection &&
    initialSelection.providerId === "codex" &&
    initialSelection.model === null &&
    globalDefault.providerId === "codex"
      ? { ...initialSelection, model: globalDefault.model }
      : initialSelection;
  const providerId = selection.providerId ?? globalDefault.providerId;
  const readOnly = settings.readOnly ?? defaults.readOnly;

  return {
    ...selection,
    reasoningEffort: supportsReasoningEffort(providerId, selection.reasoningEffort)
      ? selection.reasoningEffort
      : null,
    readOnly,
    yoloMode: readOnly ? false : (settings.yoloMode ?? defaults.yoloMode)
  };
}

function normalizeSelection(
  settings: AiModelSelectionInput,
  legacyProviderId: AiProviderId | null = null
): AiModelSelection {
  const hasLegacyExplicitSelection =
    settings.providerId === undefined &&
    (settings.model !== null || settings.reasoningEffort !== null);

  return {
    providerId:
      settings.providerId ?? (hasLegacyExplicitSelection ? legacyProviderId : null),
    model: settings.model,
    reasoningEffort: settings.reasoningEffort
  };
}
