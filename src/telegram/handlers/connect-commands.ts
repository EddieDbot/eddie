import type { MessageContext } from "./shared.ts";
import { config } from "../../config.ts";

type ServiceEntry = {
  label: string;
  generator: (chatId: number) => Promise<string | null>;
};

const SERVICES: Record<string, ServiceEntry> = {
  google: {
    label: "Google (Gmail, Calendar, Drive, YouTube)",
    generator: async (chatId) => {
      const { generateOAuthUrl } = await import("../../comms/google/oauth-flow.ts");
      return generateOAuthUrl(chatId);
    },
  },
};

export async function handleConnect(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/connect\s*/, "").trim().toLowerCase() ?? "";

  if (!args) {
    const list = Object.entries(SERVICES)
      .map(([key, svc]) => `  /connect ${key} — ${svc.label}`)
      .join("\n");
    await context.send(`Available services:\n${list}`);
    return;
  }

  const service = SERVICES[args];
  if (!service) {
    await context.send(`Unknown service "${args}". Run /connect to see available options.`);
    return;
  }

  try {
    const chatId = context.chat?.id ?? config.OWNER_TELEGRAM_ID;
    const url = await service.generator(chatId);
    if (!url) {
      await context.send(
        "OAuth credentials not configured. Set GOOGLE_OAUTH_CREDENTIALS_PATH in .env.",
      );
      return;
    }

    await context.send("Tap to authorize:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Connect ${service.label.split(" (")[0]}`, url }],
        ],
      },
    });
  } catch (err) {
    await context.send(
      `Connect error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
