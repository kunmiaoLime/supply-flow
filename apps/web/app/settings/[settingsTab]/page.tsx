import path from "node:path";
import { FilePullRequestTemplateStore } from "@supply-flow/core/file-pull-request-template-store";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "../../workspace-shell";
import {
  defaultSettingsTab,
  isSettingsTab,
  projectIdFromSearchParam,
  settingsTabUrl,
  type SettingsTab
} from "../../workspace-url";

export const dynamic = "force-dynamic";

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

  const initialPrTemplates =
    settingsTab === "pr-templates" ? await loadPullRequestTemplates() : undefined;

  return (
    <WorkspaceShell
      initialPrTemplates={initialPrTemplates}
      projectId={projectIdFromSearchParam(project)}
      settingsTab={settingsTab as SettingsTab}
      tab="settings"
    />
  );
}

async function loadPullRequestTemplates() {
  try {
    const projectRoot = path.resolve(process.cwd(), "../..");
    return await new FilePullRequestTemplateStore(
      path.join(projectRoot, "templates", "PR")
    ).list();
  } catch {
    return undefined;
  }
}
