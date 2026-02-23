import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

type CallStatus = "queued" | "ringing" | "in-progress" | "completed" | "busy" | "no-answer" | "canceled" | "failed";

type CallResponse = {
  sid: string;
  status: CallStatus;
};

function twilioAuth(): string {
  return btoa(`${config.TWILIO_ACCOUNT_SID!}:${config.TWILIO_AUTH_TOKEN!}`);
}

function twilioAccountSid(): string {
  return config.TWILIO_ACCOUNT_SID!;
}

function twilioPhoneNumber(): string {
  return config.TWILIO_PHONE_NUMBER!;
}

export function generateAnswerTwiml(webhookBaseUrl: string): string {
  const wsUrl = webhookBaseUrl.replace(/^http/, "ws") + "/voice/stream";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    '  <Connect><Stream url="' + wsUrl + '" /></Connect>',
    "</Response>",
  ].join("\n");
}

export async function initiateCall(toNumber: string, webhookBaseUrl: string): Promise<CallResponse> {
  const sid = twilioAccountSid();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`;

  const body = new URLSearchParams({
    To: toNumber,
    From: twilioPhoneNumber(),
    Url: `${webhookBaseUrl}/voice/answer`,
    StatusCallback: `${webhookBaseUrl}/voice/status`,
    StatusCallbackEvent: "initiated ringing answered completed",
  });

  logger.info("call:initiate", { to: toNumber, webhookBaseUrl });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${twilioAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error("call:initiate-error", { status: res.status, body: errBody });
    throw new Error(`Twilio call failed: ${res.status}`);
  }

  const data = (await res.json()) as { sid: string; status: CallStatus };
  logger.info("call:initiated", { callSid: data.sid, status: data.status });
  return { sid: data.sid, status: data.status };
}

export async function getCallStatus(callSid: string): Promise<CallStatus> {
  const sid = twilioAccountSid();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}.json`;

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${twilioAuth()}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error("call:status-error", { callSid, status: res.status, body: errBody });
    throw new Error(`Twilio status check failed: ${res.status}`);
  }

  const data = (await res.json()) as { status: CallStatus };
  return data.status;
}
