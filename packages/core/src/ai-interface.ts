import { z } from "zod";

export const aiInterfaceIds = [
  "slack",
  "google-doc",
  "confluence",
  "figma",
  "circleci"
] as const;

export const AiInterfaceIdSchema = z.enum(aiInterfaceIds);
export type AiInterfaceId = z.infer<typeof AiInterfaceIdSchema>;

export const aiInterfaceStatusValues = [
  "unknown",
  "accessible",
  "needs_setup",
  "needs_user_action",
  "error"
] as const;

export const AiInterfaceStatusSchema = z.enum(aiInterfaceStatusValues);
export type AiInterfaceStatus = z.infer<typeof AiInterfaceStatusSchema>;

export const AiInterfaceAccessSchema = z.object({
  status: AiInterfaceStatusSchema,
  checkedAt: z.string().datetime().nullable(),
  detail: z.string().trim().min(1).max(4_000).nullable()
});

export type AiInterfaceAccess = z.infer<typeof AiInterfaceAccessSchema>;

export const AiInterfaceStatusIndexSchema = z.object({
  schemaVersion: z.literal(1),
  interfaces: z.object({
    slack: AiInterfaceAccessSchema,
    "google-doc": AiInterfaceAccessSchema,
    confluence: AiInterfaceAccessSchema,
    figma: AiInterfaceAccessSchema,
    circleci: AiInterfaceAccessSchema.default(createDefaultAccess)
  })
});

export type AiInterfaceStatusIndex = z.infer<typeof AiInterfaceStatusIndexSchema>;

export function createDefaultAiInterfaceStatus(): AiInterfaceStatusIndex {
  return {
    schemaVersion: 1,
    interfaces: {
      slack: createDefaultAccess(),
      "google-doc": createDefaultAccess(),
      confluence: createDefaultAccess(),
      figma: createDefaultAccess(),
      circleci: createDefaultAccess()
    }
  };
}

function createDefaultAccess(): AiInterfaceAccess {
  return {
    status: "unknown",
    checkedAt: null,
    detail: null
  };
}
