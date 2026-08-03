import { WorkspaceShell } from "../../workspace-shell";

export default async function SettingsPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <WorkspaceShell projectId={projectId} tab="settings" />;
}
