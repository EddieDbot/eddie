import { getAccessToken } from "./auth.ts";

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  from?: string;
}

export interface SendEmailResult {
  messageId?: string;
  threadId?: string;
  ok: boolean;
  error?: string;
}

function buildMime(from: string, opts: SendEmailOptions): string {
  const headers = [
    `From: ${from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);
  return `${headers.join("\r\n")}\r\n\r\n${opts.body}`;
}

function base64urlEncode(raw: string): string {
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function fetchOriginalMessageId(
  account: string,
  gmailMessageId: string,
): Promise<string | null> {
  try {
    const token = await getAccessToken(
      "https://www.googleapis.com/auth/gmail.readonly",
      account,
    );
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      payload?: { headers?: { name: string; value: string }[] };
    };
    return (
      data.payload?.headers?.find((h) => h.name === "Message-ID")?.value ??
      null
    );
  } catch {
    return null;
  }
}

export async function sendGmail(
  account: string,
  opts: SendEmailOptions,
): Promise<SendEmailResult> {
  try {
    const from = opts.from ?? account;
    const raw = buildMime(from, opts);
    const encoded = base64urlEncode(raw);

    const token = await getAccessToken(
      "https://www.googleapis.com/auth/gmail.send",
      account,
    );
    const body: Record<string, string> = { raw: encoded };
    if (opts.threadId) body.threadId = opts.threadId;

    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Gmail API ${res.status}: ${errText}` };
    }

    const data = (await res.json()) as { id?: string; threadId?: string };
    return { ok: true, messageId: data.id, threadId: data.threadId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
