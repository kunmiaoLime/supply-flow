import type { TmuxAdapter } from "@supply-flow/core/tmux";

export interface AiSessionPromptTransport {
  sendInput(sessionName: string, input: string): Promise<void>;
}

export function prepareInitialAiSessionPrompt(prompt: string): string {
  return requirePromptContent(prompt);
}

export function prepareFollowUpAiSessionPrompt(prompt: string): string {
  return requirePromptContent(prompt)
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\s{2,}/g, " ");
}

export function prepareSessionWriteModePrompt(template: string, readOnly: boolean): string {
  if (!template.includes("<READ_ONLY_MODE>")) {
    throw new Error("The session write-mode prompt must include <READ_ONLY_MODE>.");
  }

  return requirePromptContent(template.replaceAll("<READ_ONLY_MODE>", readOnly ? "on" : "off"));
}

export async function sendAiSessionPrompt(
  transport: Pick<TmuxAdapter, "sendInput"> | AiSessionPromptTransport,
  sessionName: string,
  prompt: string
): Promise<void> {
  await transport.sendInput(sessionName, prepareFollowUpAiSessionPrompt(prompt));
}

function requirePromptContent(prompt: string): string {
  const preparedPrompt = prompt.trim();
  if (!preparedPrompt) {
    throw new Error("An AI session prompt cannot be empty.");
  }

  return preparedPrompt;
}
