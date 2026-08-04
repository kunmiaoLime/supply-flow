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
