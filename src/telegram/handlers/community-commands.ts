import type { ContextType, BotLike } from "@gramio/contexts";
import {
  inviteToProRepo,
  removeFromProRepo,
  listPendingInvites,
} from "../../community/github-invite.ts";
import { logger } from "../../utils/logger.ts";

type MessageContext = ContextType<BotLike, "message">;

/**
 * /ginvite [github_username]
 * Send a GitHub collaborator invite to EddieDbot/eddie-community-pro
 */
export async function handleGinvite(context: MessageContext): Promise<void> {
  const args = context.text?.split(" ").slice(1) ?? [];
  const username = args[0]?.trim().replace(/^@/, "");

  if (!username) {
    await context.send(
      "Usage: /ginvite <github_username>\n\nExample: /ginvite torvalds",
    );
    return;
  }

  await context.send(`Inviting @${username} to Pro repo...`);

  const result = await inviteToProRepo(username);

  logger.info("community:ginvite", { username, result: result.status });

  if (result.success) {
    await context.send(`✓ ${result.message}`);
  } else {
    await context.send(`✗ ${result.message}`);
  }
}

/**
 * /gkick [github_username]
 * Remove a user from EddieDbot/eddie-community-pro (on Skool churn)
 */
export async function handleGkick(context: MessageContext): Promise<void> {
  const args = context.text?.split(" ").slice(1) ?? [];
  const username = args[0]?.trim().replace(/^@/, "");

  if (!username) {
    await context.send("Usage: /gkick <github_username>");
    return;
  }

  const result = await removeFromProRepo(username);
  await context.send(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
}

/**
 * /ginvites
 * List all pending GitHub invitations to the Pro repo
 */
export async function handleGinvites(context: MessageContext): Promise<void> {
  await context.send("Checking pending Pro repo invites...");

  const pending = await listPendingInvites();

  if (pending.length === 0) {
    await context.send("No pending invites.");
    return;
  }

  await context.send(
    `Pending invites (${pending.length}):\n${pending.map((u) => `• @${u}`).join("\n")}`,
  );
}
