import { WorkspaceShell } from "../workspace-shell";
import { projectIdFromSearchParam } from "../workspace-url";

export default async function PullRequestPage({
  searchParams
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { project } = await searchParams;
  return <WorkspaceShell projectId={projectIdFromSearchParam(project)} tab="pr" />;
}
