import { WorkspaceShell } from "../../workspace-shell";

export default async function CodeImplementationPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <WorkspaceShell projectId={projectId} tab="code-implementation" />;
}
