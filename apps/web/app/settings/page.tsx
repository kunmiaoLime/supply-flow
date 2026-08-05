import { redirect } from "next/navigation";
import {
  defaultSettingsTab,
  projectIdFromSearchParam,
  settingsTabUrl
} from "../workspace-url";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { project } = await searchParams;
  redirect(settingsTabUrl(defaultSettingsTab, projectIdFromSearchParam(project)));
}
