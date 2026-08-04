import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  SessionEventSchema,
  SessionIndexSchema,
  SessionRecordSchema,
  type SessionEvent,
  type SessionRecord,
  type SessionStore,
  type SessionUpdate
} from "@supply-flow/core/session";

const META_FILE = "meta.json";
const EVENTS_FILE = "events.ndjson";
const SESSIONS_INDEX_FILE = "sessions.json";

export class FileSessionStore implements SessionStore {
  public constructor(private readonly rootDirectory: string) {}

  public async create(record: SessionRecord): Promise<SessionRecord> {
    const parsedRecord = SessionRecordSchema.parse(record);
    const directory = this.sessionDirectory(parsedRecord.id);

    await mkdir(directory, { recursive: true });

    if (await this.get(parsedRecord.id)) {
      throw new Error(`A session with id "${parsedRecord.id}" already exists.`);
    }

    await writeJsonAtomically(path.join(directory, META_FILE), parsedRecord);
    await this.upsertSessionIndex(parsedRecord);
    return parsedRecord;
  }

  public async get(id: string): Promise<SessionRecord | null> {
    try {
      const content = await readFile(path.join(this.sessionDirectory(id), META_FILE), "utf8");
      return SessionRecordSchema.parse(JSON.parse(content));
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  public async list(): Promise<SessionRecord[]> {
    const indexedSessions = await this.readSessionIndex();
    if (indexedSessions) {
      return sortSessions(indexedSessions);
    }

    const sessions = await this.readSessionDirectories();
    await this.writeSessionIndex(sessions);
    return sortSessions(sessions);
  }

  public async update(id: string, update: SessionUpdate): Promise<SessionRecord> {
    const current = await this.get(id);
    if (!current) {
      throw new Error(`Unknown session "${id}".`);
    }

    const updated = SessionRecordSchema.parse({
      ...current,
      ...update,
      updatedAt: new Date().toISOString()
    });

    await writeJsonAtomically(path.join(this.sessionDirectory(id), META_FILE), updated);
    await this.upsertSessionIndex(updated);
    return updated;
  }

  public async remove(id: string): Promise<void> {
    await rm(this.sessionDirectory(id), { recursive: true, force: true });
    const sessions = (await this.readSessionIndex()) ?? (await this.readSessionDirectories());
    await this.writeSessionIndex(sessions.filter((session) => session.id !== id));
  }

  public async appendEvent(event: SessionEvent): Promise<void> {
    const parsedEvent = SessionEventSchema.parse(event);
    const directory = this.sessionDirectory(parsedEvent.sessionId);

    await mkdir(directory, { recursive: true });
    await appendFile(
      path.join(directory, EVENTS_FILE),
      `${JSON.stringify(parsedEvent)}\n`,
      "utf8"
    );
  }

  public async readEvents(id: string): Promise<SessionEvent[]> {
    try {
      const content = await readFile(path.join(this.sessionDirectory(id), EVENTS_FILE), "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => SessionEventSchema.parse(JSON.parse(line)));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  private sessionsDirectory(): string {
    return path.join(this.rootDirectory, "sessions");
  }

  private sessionIndexPath(): string {
    return path.join(this.rootDirectory, SESSIONS_INDEX_FILE);
  }

  private sessionDirectory(id: string): string {
    assertPathSegment(id, "session id");
    return path.join(this.sessionsDirectory(), id);
  }

  private async readSessionIndex(): Promise<SessionRecord[] | null> {
    try {
      const content = await readFile(this.sessionIndexPath(), "utf8");
      return SessionIndexSchema.parse(JSON.parse(content)).sessions;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readSessionDirectories(): Promise<SessionRecord[]> {
    try {
      const entries = await readdir(this.sessionsDirectory(), { withFileTypes: true });
      const sessions = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.get(entry.name))
      );

      return sessions.filter((session): session is SessionRecord => session !== null);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async upsertSessionIndex(session: SessionRecord): Promise<void> {
    const sessions = (await this.readSessionIndex()) ?? (await this.readSessionDirectories());
    await this.writeSessionIndex([
      ...sessions.filter((currentSession) => currentSession.id !== session.id),
      session
    ]);
  }

  private async writeSessionIndex(sessions: SessionRecord[]): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await writeJsonAtomically(this.sessionIndexPath(), {
      schemaVersion: 1,
      sessions: sortSessions(sessions)
    });
  }
}

function sortSessions(sessions: SessionRecord[]): SessionRecord[] {
  return [...sessions].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

async function writeJsonAtomically(targetPath: string, value: unknown): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

function assertPathSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: "${value}".`);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
