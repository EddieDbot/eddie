import type { InboxItem } from "./types.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import { logger } from "../utils/logger.ts";

export interface ContraLead {
  threadId: string;
  inboxExternalId: string;
  leadName: string;
  leadEmail: string;
  subject: string;
  preview: string;
  body?: string;
}

const CONTRA_SENDER_PATTERN = /@contra\.com$/i;
const CONTRA_SUBJECT_PATTERNS = [
  /contra/i,
  /new message from/i,
  /inquiry/i,
  /project request/i,
];

export function detectContraLead(item: InboxItem): ContraLead | null {
  if (item.channel !== "gmail-eddie") return null;

  const fromEmail = item.from.match(/<([^>]+)>/)?.[1] ?? item.from;
  const isContraSender = CONTRA_SENDER_PATTERN.test(fromEmail);
  const isContraSubject =
    !isContraSender &&
    CONTRA_SUBJECT_PATTERNS.some((p) => p.test(item.subject ?? ""));

  if (!isContraSender && !isContraSubject) return null;

  const threadId =
    (item.metadata as Record<string, string> | undefined)?.threadId ??
    item.externalId;
  const leadName =
    item.from.match(/^([^<@]+)/)?.[1]?.trim() ??
    fromEmail.split("@")[0] ??
    fromEmail;

  return {
    threadId,
    inboxExternalId: item.externalId,
    leadName,
    leadEmail: fromEmail,
    subject: item.subject ?? "(no subject)",
    preview: item.preview,
    body: item.body,
  };
}

export async function isDuplicate(threadId: string): Promise<boolean> {
  if (!memoryEnabled) return false;
  try {
    const { data } = await getSupabase()
      .from("contra_replies")
      .select("id")
      .eq("thread_id", threadId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

const FALLBACK_TEMPLATE = (lead: ContraLead) => `Hi ${lead.leadName},

Thanks for reaching out — I saw your message about "${lead.subject}".

Before we dig in, I do a quick Project Fit Check to make sure the engagement is set up for success on both sides. A few questions:

1. What are you building, and who is it for? (2–3 sentences)
2. What's your timeline pressure — when does this need to be live?
3. What's your budget range? (Under $5K / $5K–$10K / $10K–$20K / $20K+)
4. Are you hands-on throughout or do you prefer to brief once and get a result?

Once I have that, I can tell you quickly whether we're a fit and what the engagement looks like.

— EDDIE`;

export async function generateIntakeResponse(
  lead: ContraLead,
): Promise<string> {
  const system = `You are EDDIE, an AI agent that builds websites, automation systems, and agent infrastructure. You respond to Contra inquiries. Your voice: crisp, professional, direct. No fluff. You do a Project Fit Check before any engagement — 4 questions about what they're building, timeline, budget, and how they work. Keep it under 150 words.`;

  const prompt = `Draft a reply to this Contra inquiry:
From: ${lead.leadName} <${lead.leadEmail}>
Subject: ${lead.subject}
Message: ${(lead.body ?? lead.preview).slice(0, 500)}

Write a short, direct reply that: acknowledges their message, confirms you can help (if topic matches: websites, automations, agent infra/code), and asks the 4 Project Fit Check questions. No greeting fluff.`;

  const result = await runPrompt({
    prompt,
    system,
    model: "claude-haiku-4-5-20251001",
    maxWaitMs: 15_000,
  });

  return result.ok && result.text.length > 50
    ? result.text
    : FALLBACK_TEMPLATE(lead);
}

export async function saveDraft(
  lead: ContraLead,
  responseBody: string,
): Promise<boolean> {
  if (!memoryEnabled) return false;
  try {
    await getSupabase().from("contra_replies").insert({
      thread_id: lead.threadId,
      inbox_external_id: lead.inboxExternalId,
      lead_name: lead.leadName,
      lead_email: lead.leadEmail,
      response_body: responseBody,
      status: "drafted",
    });
    return true;
  } catch (err) {
    logger.warn("contra-intake:save-draft-failed", {
      threadId: lead.threadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function markReplySent(threadId: string): Promise<void> {
  if (!memoryEnabled) return;
  try {
    await getSupabase()
      .from("contra_replies")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("thread_id", threadId);
  } catch (err) {
    logger.warn("contra-intake:mark-sent-failed", {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function markReplySkipped(threadId: string): Promise<void> {
  if (!memoryEnabled) return;
  try {
    await getSupabase()
      .from("contra_replies")
      .update({ status: "skipped" })
      .eq("thread_id", threadId);
  } catch (err) {
    logger.warn("contra-intake:mark-skipped-failed", {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getDraft(
  threadId: string,
): Promise<{
  responseBody: string;
  leadEmail: string;
  leadName: string;
} | null> {
  if (!memoryEnabled) return null;
  try {
    const { data } = await getSupabase()
      .from("contra_replies")
      .select("response_body, lead_email, lead_name")
      .eq("thread_id", threadId)
      .single();
    if (!data) return null;
    return {
      responseBody: data.response_body as string,
      leadEmail: data.lead_email as string,
      leadName: data.lead_name as string,
    };
  } catch {
    return null;
  }
}

export async function updateDraft(
  threadId: string,
  responseBody: string,
): Promise<void> {
  if (!memoryEnabled) return;
  try {
    await getSupabase()
      .from("contra_replies")
      .update({ response_body: responseBody })
      .eq("thread_id", threadId);
  } catch (err) {
    logger.warn("contra-intake:update-draft-failed", {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
