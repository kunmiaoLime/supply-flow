export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { reconcilePersistedAiSessions } = await import(
      "./app/persisted-session-reconciliation"
    );
    const result = await reconcilePersistedAiSessions();
    if (result === null) {
      console.warn("Skipped persisted AI session reconciliation because tmux is unavailable.");
      return;
    }

    if (result.stoppedCount > 0) {
      console.info(
        `Reconciled ${result.stoppedCount} stopped AI session(s) across ${result.projectCount} project(s).`
      );
    }
  } catch (error) {
    console.error(
      `Unable to reconcile persisted AI sessions at web-server startup: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }
}
