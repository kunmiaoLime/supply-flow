import { WorkspaceShell } from "../../workspace-shell";

export default async function PullRequestPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <WorkspaceShell projectId={projectId} tab="pr" />;
}
