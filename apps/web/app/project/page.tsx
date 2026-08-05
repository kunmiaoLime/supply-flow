import { WorkspaceShell } from "../workspace-shell";
import { projectIdFromSearchParam } from "../workspace-url";

export default async function ProjectPage({
  searchParams
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { project } = await searchParams;
  return <WorkspaceShell projectId={projectIdFromSearchParam(project)} tab="project" />;
}
