import { WorkspaceShell } from "../../workspace-shell";

export default async function ProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <WorkspaceShell projectId={projectId} tab="project" />;
}
