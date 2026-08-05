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

const AiModelActionDefaultsSchema = z.object({
  "new-session": AiModelSelectionSchema,
  "initialize-context": AiModelSelectionSchema,
  "update-context": AiModelSelectionSchema,
  "create-task": AiModelSelectionSchema,
  "implement-code": AiModelSelectionSchema,
  "create-pull-request": AiModelSelectionSchema,
  "address-pull-request": AiModelSelectionSchema
});

export const AiModelSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  codexDefault: AiModelSelectionSchema.optional(),
  actions: AiModelActionDefaultsSchema
}).transform(({ codexDefault, ...settings }) => ({
  ...settings,
  codexDefault: codexDefault ?? createDefaultSelection()
}));

export type AiModelSelection = z.infer<typeof AiModelSelectionSchema>;
export type AiModelSettings = z.infer<typeof AiModelSettingsSchema>;

export function createDefaultAiModelSettings(): AiModelSettings {
  return {
    schemaVersion: 1,
    codexDefault: createDefaultSelection(),
    actions: {
      "new-session": createDefaultSelection(),
      "initialize-context": createDefaultSelection(),
      "update-context": createDefaultSelection(),
      "create-task": createDefaultSelection(),
      "implement-code": createDefaultSelection(),
      "create-pull-request": createDefaultSelection(),
      "address-pull-request": createDefaultSelection()
    }
  };
}

export function resolveAiModelDefault(
  settings: AiModelSettings,
  action: AiSessionAction
): AiModelSelection {
  const actionDefault = settings.actions[action];
  return {
    model: actionDefault.model ?? settings.codexDefault.model,
    reasoningEffort: actionDefault.reasoningEffort ?? settings.codexDefault.reasoningEffort
  };
}

function createDefaultSelection(): AiModelSelection {
  return {
    model: null,
    reasoningEffort: null
  };
}
