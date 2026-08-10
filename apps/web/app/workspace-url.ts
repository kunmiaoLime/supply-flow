export const defaultSettingsTab = "ai-model";

export const settingsTabs = [
  "ai-model",
  "setup-ai-interface",
  "pr-templates",
  "rfc-template"
] as const;

export type SettingsTab = (typeof settingsTabs)[number];

export function isSettingsTab(value: string): value is SettingsTab {
  return settingsTabs.some((tab) => tab === value);
}

export function projectIdFromSearchParam(
  project: string | string[] | undefined
): string | undefined {
  return queryParamValue(project);
}

export function queryParamValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function workspaceTabUrl(
  pathname: string,
  projectId?: string,
  sessionId?: string
): string {
  const searchParams = new URLSearchParams();
  if (projectId) {
    searchParams.set("project", projectId);
  }
  if (sessionId) {
    searchParams.set("session", sessionId);
  }

  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function settingsTabUrl(tab: SettingsTab, projectId?: string): string {
  return workspaceTabUrl(`/settings/${tab}`, projectId);
}

export function aiInterfaceSetupSessionUrl(sessionId: string, projectId?: string): string {
  return workspaceTabUrl("/ai_sessions", projectId, sessionId);
}
