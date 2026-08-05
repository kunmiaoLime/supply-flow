import { redirect } from "next/navigation";
import { queryParamValue, workspaceTabUrl } from "../../workspace-url";

export default async function AiSessionsProjectPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const [{ projectId }, { session }] = await Promise.all([params, searchParams]);

  redirect(workspaceTabUrl("/ai_sessions", projectId, queryParamValue(session)));
}
