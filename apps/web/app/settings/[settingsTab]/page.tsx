import { redirect } from "next/navigation";
import { WorkspaceShell } from "../../workspace-shell";
import {
  defaultSettingsTab,
  isSettingsTab,
  projectIdFromSearchParam,
  settingsTabUrl,
  type SettingsTab
} from "../../workspace-url";

export default async function SettingsPage({
  params,
  searchParams
}: {
  params: Promise<{ settingsTab: string }>;
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const [{ settingsTab }, { project }] = await Promise.all([params, searchParams]);

  if (!isSettingsTab(settingsTab)) {
    redirect(settingsTabUrl(defaultSettingsTab, settingsTab));
  }

  return (
    <WorkspaceShell
      projectId={projectIdFromSearchParam(project)}
      settingsTab={settingsTab as SettingsTab}
      tab="settings"
    />
  );
}
