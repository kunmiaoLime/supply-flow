import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { findProvider } from "@supply-flow/core/providers";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import type { SessionRecord } from "@supply-flow/core/session";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
const store = new FileSessionStore(dataDirectory);
const tmux = new TmuxAdapter();

async function main(): Promise<void> {
  const [command = "help", ...arguments_] = process.argv.slice(2);

  switch (command) {
    case "doctor":
      await printDoctor();
      return;
    case "list":
      await listSessions();
      return;
    case "start":
      await startSession(arguments_);
      return;
    case "stop":
      await stopSession(arguments_);
      return;
    case "help":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command "${command}". Run "help" for usage.`);
  }
}

async function printDoctor(): Promise<void> {
  const tmuxVersion = await tmux.version();
  console.log(`tmux: ${tmuxVersion}`);
  console.log(`state directory: ${dataDirectory}`);
  console.log("provider executables are checked only when a session starts.");
}

async function listSessions(): Promise<void> {
  const sessions = await store.list();

  if (sessions.length === 0) {
    console.log("No recorded sessions.");
    return;
  }

  for (const session of sessions) {
    console.log(`${session.id}\t${session.providerId}\t${session.status}\t${session.tmuxSessionName}`);
  }
}

async function startSession(arguments_: string[]): Promise<void> {
  const [providerId, workspaceArgument] = arguments_;
  if (!providerId || !workspaceArgument) {
    throw new Error("Usage: start <provider-id> <absolute-worktree-path>");
  }

  const provider = findProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider "${providerId}".`);
  }

  const workspacePath = path.resolve(workspaceArgument);
  const id = `session_${randomUUID().replaceAll("-", "")}`;
  const tmuxSessionName = `sf_${id}`;
  const timestamp = new Date().toISOString();
  const record: SessionRecord = {
    schemaVersion: 1,
    id,
    providerId: provider.id,
    workspacePath,
    tmuxSessionName,
    status: "starting",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await store.create(record);
  await store.appendEvent({
    schemaVersion: 1,
    sessionId: id,
    timestamp,
    type: "created",
    message: `Prepared ${provider.displayName} session.`
  });

  try {
    await tmux.createSession({
      sessionName: tmuxSessionName,
      workspacePath,
      launch: provider.createLaunchSpec()
    });
    await store.update(id, { status: "running" });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: id,
      timestamp: new Date().toISOString(),
      type: "started",
      message: `Started ${provider.displayName} in ${tmuxSessionName}.`
    });
    console.log(`Started ${id} in tmux session ${tmuxSessionName}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.update(id, { status: "failed", lastError: message });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: id,
      timestamp: new Date().toISOString(),
      type: "failed",
      message
    });
    throw error;
  }
}

async function stopSession(arguments_: string[]): Promise<void> {
  const [id] = arguments_;
  if (!id) {
    throw new Error("Usage: stop <session-id>");
  }

  const session = await store.get(id);
  if (!session) {
    throw new Error(`Unknown session "${id}".`);
  }

  await tmux.terminateSession(session.tmuxSessionName);
  await store.update(id, { status: "stopped" });
  await store.appendEvent({
    schemaVersion: 1,
    sessionId: id,
    timestamp: new Date().toISOString(),
    type: "stopped",
    message: `Stopped ${session.tmuxSessionName}.`
  });
  console.log(`Stopped ${id}.`);
}

function printHelp(): void {
  console.log("Supply Flow session runner");
  console.log("");
  console.log("Commands:");
  console.log("  doctor");
  console.log("  list");
  console.log("  start <provider-id> <absolute-worktree-path>");
  console.log("  stop <session-id>");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runner error: ${message}`);
  process.exitCode = 1;
});
