import { redirect } from "next/navigation";
import { workspaceTabUrl } from "../../workspace-url";

export default async function TaskPlanPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  redirect(workspaceTabUrl("/task_plan", projectId));
}
