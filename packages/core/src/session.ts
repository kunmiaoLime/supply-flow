import { z } from "zod";
import { ReasoningEffortSchema } from "@supply-flow/core/ai-model-settings";

export const sessionStatuses = ["starting", "running", "stopped", "failed"] as const;

export const SessionStatusSchema = z.enum(sessionStatuses);

export const SessionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(16_000),
  providerId: z.string().min(1),
  model: z.string().trim().min(1).max(120).optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  readOnly: z.boolean().optional(),
  yoloMode: z.boolean().optional(),
  notifyWhenComplete: z.boolean().optional(),
  workspacePath: z.string().min(1),
  tmuxSessionName: z.string().min(1),
  status: SessionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastError: z.string().min(1).optional()
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionIndexSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.array(SessionRecordSchema)
});

export type SessionIndex = z.infer<typeof SessionIndexSchema>;

export const SessionEventSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  timestamp: z.string().datetime(),
  type: z.enum([
    "created",
    "started",
    "stopped",
    "failed",
    "terminal-output",
    "notification-requested",
    "notification-canceled"
  ]),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional()
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;

export type SessionUpdate = Partial<
  Pick<SessionRecord, "status" | "readOnly" | "notifyWhenComplete">
> & {
  lastError?: string;
};

export interface SessionStore {
  create(record: SessionRecord): Promise<SessionRecord>;
  get(id: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
  update(id: string, update: SessionUpdate): Promise<SessionRecord>;
  remove(id: string): Promise<void>;
  appendEvent(event: SessionEvent): Promise<void>;
  readEvents(id: string): Promise<SessionEvent[]>;
}
