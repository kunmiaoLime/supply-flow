import { redirect } from "next/navigation";
import { workspaceTabUrl } from "../../workspace-url";

export default async function PullRequestPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  redirect(workspaceTabUrl("/pr", projectId));
}
