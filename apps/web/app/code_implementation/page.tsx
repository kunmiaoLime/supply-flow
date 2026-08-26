import { WorkspaceShell } from "../workspace-shell";
import { projectIdFromSearchParam, queryParamValue } from "../workspace-url";

export default async function CodeImplementationPage({
  searchParams
}: {
  searchParams: Promise<{ project?: string | string[]; task?: string | string[] }>;
}) {
  const { project, task } = await searchParams;
  return (
    <WorkspaceShell
      implementationTaskTicket={queryParamValue(task)}
      projectId={projectIdFromSearchParam(project)}
      tab="code-implementation"
    />
  );
}
