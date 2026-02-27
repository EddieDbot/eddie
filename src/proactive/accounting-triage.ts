import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { runPromptMulti } from "../llm/run-prompt-multi.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";

const ACCOUNTING_LOG = resolve(
  homedir(),
  "brain-vault/90 - Agent Memory/State/accounting-log.md",
);

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.modify";
const FINANCIAL_PATTERN =
  /invoice|receipt|payment|charge|bill|subscription|renewal|refund|transfer/i;

interface GmailListResponse {
  messages?: { id: string }[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
  };
}

function getHeader(msg: GmailMessage, name: string): string {
  return (
    msg.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

async function fetchFinancialEmails(
  account: string,
): Promise<Array<{ from: string; subject: string; snippet: string }>> {
  const { getAccessToken } = await import("../comms/google/auth.ts");
  const token = await getAccessToken(GMAIL_SCOPES, account);

  const listRes = await fetch(
    `${GMAIL_API}/users/me/messages?q=${encodeURIComponent("is:unread")}&maxResults=20`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!listRes.ok) throw new Error(`Gmail list ${listRes.status}`);
  const listData = (await listRes.json()) as GmailListResponse;
  const ids = listData.messages ?? [];
  if (ids.length === 0) return [];

  const results: Array<{ from: string; subject: string; snippet: string }> = [];

  for (const { id } of ids.slice(0, 20)) {
    try {
      const msgRes = await fetch(
        `${GMAIL_API}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as GmailMessage;
      const from = getHeader(msg, "from");
      const subject = getHeader(msg, "subject");
      const snippet = msg.snippet ?? "";

      if (FINANCIAL_PATTERN.test(subject + snippet)) {
        results.push({ from, subject, snippet });
      }
    } catch {
      // skip individual failures
    }
  }

  return results;
}

export async function runAccountingTriage(): Promise<void> {
  if (!config.ACCOUNTING_PIPELINE_ENABLED) return;

  const accounts = (config.COMMS_EMAIL_ACCOUNTS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  if (accounts.length === 0) {
    logger.warn("accounting-triage:no-accounts");
    return;
  }

  let allEmails: Array<{ from: string; subject: string; snippet: string }> = [];

  for (const account of accounts) {
    try {
      const emails = await fetchFinancialEmails(account);
      allEmails = allEmails.concat(emails);
    } catch (err) {
      logger.warn("accounting-triage:gmail-error", {
        account,
        error: String(err),
      });
    }
  }

  if (allEmails.length === 0) {
    logger.info("accounting-triage:no-financial-emails");
    return;
  }

  const emailSummary = allEmails
    .map((e) => `From: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`)
    .join("\n\n---\n\n")
    .slice(0, 4000);

  const { text, ok } = await runPromptMulti({
    provider: "gemini",
    system: `You are an accounting assistant. Analyze these financial emails and extract:
- Date
- Description (what it's for)
- Amount (if mentioned)
- Category (software/tools, client payment, subscription, tax, misc)
- Source (company name)

Format as a markdown table:
| Date | Description | Amount | Category | Source |
|------|-------------|--------|----------|--------|

Only include actual financial transactions, ignore marketing emails.`,
    prompt: emailSummary,
    source: "accounting-triage",
  });

  if (!ok || !text) return;

  const entry = `## Accounting Triage — ${new Date().toLocaleDateString()}\n\n${text}\n\n`;

  let existing = "";
  try {
    existing = await Bun.file(ACCOUNTING_LOG).text();
  } catch {}
  await Bun.write(ACCOUNTING_LOG, entry + existing);

  logger.info("accounting-triage:complete");
}
