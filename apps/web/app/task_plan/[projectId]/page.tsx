import { WorkspaceShell } from "../../workspace-shell";

export default async function TaskPlanPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <WorkspaceShell projectId={projectId} tab="task-plan" />;
}
