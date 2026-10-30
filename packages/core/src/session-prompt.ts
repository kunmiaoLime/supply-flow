import type { TmuxAdapter } from "@supply-flow/core/tmux";

export interface AiSessionPromptTransport {
  sendInput(sessionName: string, input: string): Promise<void>;
}

export interface InitialAiSessionPromptOptions {
  bootstrapCodexWriteMode?: boolean;
}

function codexWriteModeCommand(readOnly: boolean): string {
  return `Before doing anything else, process this direct user command exactly: read_only ${
    readOnly ? "on" : "off"
  }.`;
}

export function prependCodexWriteModeCommand(prompt: string, readOnly: boolean): string {
  return `${codexWriteModeCommand(readOnly)}\n\n${requirePromptContent(prompt)}`;
}

export function prependCodexWriteModeBootstrap(prompt: string): string {
  return prependCodexWriteModeCommand(prompt, false);
}

export function withoutCodexWriteModeBootstrap(prompt: string): string {
  const preparedPrompt = requirePromptContent(prompt);
  const prefix = `${codexWriteModeCommand(false)}\n\n`;
  return preparedPrompt.startsWith(prefix) ? preparedPrompt.slice(prefix.length) : preparedPrompt;
}

export function prepareInitialAiSessionPrompt(
  prompt: string,
  options?: InitialAiSessionPromptOptions
): string {
  const preparedPrompt = requirePromptContent(prompt);

  return options?.bootstrapCodexWriteMode
    ? prependCodexWriteModeBootstrap(preparedPrompt)
    : preparedPrompt;
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
