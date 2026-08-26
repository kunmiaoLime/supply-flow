import { redirect } from "next/navigation";
import { codeImplementationUrl, queryParamValue } from "../../workspace-url";

export default async function CodeImplementationPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const { projectId } = await params;
  const { task } = await searchParams;

  redirect(codeImplementationUrl(projectId, queryParamValue(task)));
}
