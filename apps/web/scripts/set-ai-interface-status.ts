import {
  AiInterfaceIdSchema,
  AiInterfaceStatusSchema,
  type AiInterfaceId,
  type AiInterfaceStatus
} from "@supply-flow/core/ai-interface";
import { FileAiInterfaceStore } from "@supply-flow/core/file-ai-interface-store";

interface Arguments {
  dataDirectory: string;
  interfaceId: AiInterfaceId;
  status: AiInterfaceStatus;
  detail: string | null;
}

const usage =
  "Usage: set-ai-interface-status --data-directory <path> --interface <slack|google-doc|confluence|figma|circleci> --status <unknown|accessible|needs_setup|needs_user_action|error> --detail <message>";

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const updated = await new FileAiInterfaceStore(arguments_.dataDirectory).updateInterface(
    arguments_.interfaceId,
    arguments_.status,
    arguments_.detail
  );
  const access = updated.interfaces[arguments_.interfaceId];
  console.log(
    `${arguments_.interfaceId} access is ${access.status}${
      access.detail ? `: ${access.detail}` : "."
    }`
  );
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(usage);
    }

    arguments_.set(flag, value);
  }

  const dataDirectory = arguments_.get("--data-directory")?.trim();
  const interfaceId = AiInterfaceIdSchema.safeParse(arguments_.get("--interface"));
  const status = AiInterfaceStatusSchema.safeParse(arguments_.get("--status"));
  const detail = arguments_.get("--detail")?.trim() || null;
  if (
    !dataDirectory ||
    !interfaceId.success ||
    !status.success ||
    arguments_.size !== 4
  ) {
    throw new Error(usage);
  }

  return {
    dataDirectory,
    interfaceId: interfaceId.data,
    status: status.data,
    detail
  };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to update AI interface status.");
  process.exitCode = 1;
});
