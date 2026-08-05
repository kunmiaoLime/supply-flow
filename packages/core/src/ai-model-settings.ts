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

export const reasoningEffortValues = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const;

export const ReasoningEffortSchema = z.enum(reasoningEffortValues);

export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const codexModelOptions: readonly {
  label: string;
  model: string;
}[] = [
  { label: "GPT-5.6 Terra", model: "openai.gpt-5.6-terra" },
  { label: "GPT-5.3 Codex", model: "gpt-5.3-codex" },
  { label: "GPT-5.2 Codex", model: "gpt-5.2-codex" },
  { label: "GPT-5.1 Codex", model: "gpt-5.1-codex" },
  { label: "GPT-5.1 Codex Mini", model: "gpt-5.1-codex-mini" }
];

const AiModelSelectionSchema = z.object({
  model: z.string().trim().min(1).max(120).nullable(),
  reasoningEffort: ReasoningEffortSchema.nullable()
});

const AiModelActionSettingsSchema = AiModelSelectionSchema.extend({
  readOnly: z.boolean().optional(),
  yoloMode: z.boolean().optional()
});

export type AiModelSelection = z.infer<typeof AiModelSelectionSchema>;

export interface AiSessionActionSettings extends AiModelSelection {
  readOnly: boolean;
  yoloMode: boolean;
}

export interface AiModelSettings {
  schemaVersion: 1;
  codexDefault: AiModelSelection;
  actions: Record<AiSessionAction, AiSessionActionSettings>;
}

const AiModelActionDefaultsSchema = z.object({
  "new-session": AiModelActionSettingsSchema,
  "initialize-context": AiModelActionSettingsSchema,
  "update-context": AiModelActionSettingsSchema,
  "create-task": AiModelActionSettingsSchema,
  "implement-code": AiModelActionSettingsSchema,
  "create-pull-request": AiModelActionSettingsSchema,
  "address-pull-request": AiModelActionSettingsSchema
});

export const AiModelSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  codexDefault: AiModelSelectionSchema.optional(),
  actions: AiModelActionDefaultsSchema
}).transform(({ actions, codexDefault, ...settings }): AiModelSettings => ({
  ...settings,
  codexDefault: codexDefault ?? createDefaultSelection(),
  actions: {
    "new-session": normalizeActionSettings(actions["new-session"], "new-session"),
    "initialize-context": normalizeActionSettings(
      actions["initialize-context"],
      "initialize-context"
    ),
    "update-context": normalizeActionSettings(actions["update-context"], "update-context"),
    "create-task": normalizeActionSettings(actions["create-task"], "create-task"),
    "implement-code": normalizeActionSettings(actions["implement-code"], "implement-code"),
    "create-pull-request": normalizeActionSettings(
      actions["create-pull-request"],
      "create-pull-request"
    ),
    "address-pull-request": normalizeActionSettings(
      actions["address-pull-request"],
      "address-pull-request"
    )
  }
}));

export function createDefaultAiModelSettings(): AiModelSettings {
  return {
    schemaVersion: 1,
    codexDefault: createDefaultSelection(),
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
): AiSessionActionSettings {
  const actionDefault = settings.actions[action];
  return {
    model: actionDefault.model ?? settings.codexDefault.model,
    reasoningEffort: actionDefault.reasoningEffort ?? settings.codexDefault.reasoningEffort,
    readOnly: actionDefault.readOnly,
    yoloMode: actionDefault.yoloMode
  };
}

function createDefaultSelection(): AiModelSelection {
  return {
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

function normalizeActionSettings(
  settings: z.infer<typeof AiModelActionSettingsSchema>,
  action: AiSessionAction
): AiSessionActionSettings {
  const defaults = createDefaultActionSettings(action);
  return {
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    readOnly: settings.readOnly ?? defaults.readOnly,
    yoloMode: settings.yoloMode ?? defaults.yoloMode
  };
}
