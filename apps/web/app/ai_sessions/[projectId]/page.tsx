import { WorkspaceShell } from "../../workspace-shell";

export default async function AiSessionsProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <WorkspaceShell projectId={projectId} tab="ai-sessions" />;
}
