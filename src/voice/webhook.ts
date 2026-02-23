import { generateAnswerTwiml } from "./call.ts";
import { createCallSession, handleMediaMessage, endCallSession, getCallSession } from "./conversational.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

type TwilioStreamMessage =
  | { event: "connected"; protocol: string; version: string }
  | { event: "start"; start: { streamSid: string; callSid: string; accountSid: string } }
  | { event: "media"; media: { payload: string }; streamSid: string }
  | { event: "stop"; streamSid: string }
  | { event: "mark"; mark: { name: string } };

let server: ReturnType<typeof Bun.serve> | null = null;

function getWebhookBaseUrl(_req: Request): string {
  const port = config.TWILIO_WEBHOOK_PORT;
  return `https://localhost:${port}`;
}

async function validateTwilioSignature(req: Request, body: string): Promise<boolean> {
  const authToken = config.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logger.warn("webhook:no-auth-token", { msg: "TWILIO_AUTH_TOKEN not set, rejecting request" });
    return false;
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const webhookUrl = config.TWILIO_WEBHOOK_URL;
  const reqUrl = new URL(req.url);
  const publicUrl = webhookUrl ? `${webhookUrl}${reqUrl.pathname}` : req.url;
  const params = new URLSearchParams(body);
  const sortedParams = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const data = publicUrl + sortedParams.map(([k, v]) => k + v).join("");

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return signature === expected;
}

async function handleAnswerRoute(req: Request): Promise<Response> {
  const body = await req.clone().text();
  const params = new URLSearchParams(body);
  const from = params.get("From") || "";
  const ownerPhone = config.OWNER_PHONE;

  if (ownerPhone && from !== ownerPhone) {
    logger.warn("webhook:rejected-caller", { from, expected: ownerPhone });
    const reject = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this number is not accepting calls.</Say><Hangup/></Response>`;
    return new Response(reject, { headers: { "Content-Type": "application/xml" } });
  }

  const webhookUrl = config.TWILIO_WEBHOOK_URL;
  const baseUrl = webhookUrl || getWebhookBaseUrl(req);
  const twiml = generateAnswerTwiml(baseUrl);
  logger.info("webhook:answer", { baseUrl, from, twiml });
  return new Response(twiml, {
    headers: { "Content-Type": "application/xml" },
  });
}

async function handleStatusRoute(req: Request): Promise<Response> {
  const form = await req.formData();
  const callSid = form.get("CallSid") as string;
  const callStatus = form.get("CallStatus") as string;
  logger.info("webhook:status", { callSid, callStatus });

  if (callStatus === "completed" || callStatus === "failed" || callStatus === "no-answer" || callStatus === "busy" || callStatus === "canceled") {
    await endCallSession(callSid);
  }

  return new Response("<Response/>", {
    headers: { "Content-Type": "application/xml" },
  });
}

function handleWebSocket(ws: ServerWebSocket<{ callSid: string | null }>): void {
  ws.data.callSid = null;
}

function handleWsMessage(ws: ServerWebSocket<{ callSid: string | null }>, raw: string | Buffer): void {
  const message = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as TwilioStreamMessage;

  switch (message.event) {
    case "connected":
      logger.info("webhook:ws-connected");
      break;

    case "start": {
      const { callSid, streamSid } = message.start;
      ws.data.callSid = callSid;
      const session = createCallSession(callSid);
      session.streamSid = streamSid;
      logger.info("webhook:ws-start", { callSid, streamSid });
      break;
    }

    case "media": {
      const callSid = ws.data.callSid;
      if (!callSid) break;
      handleMediaMessage(callSid, message.media.payload, (base64Audio: string) => {
        const session = getCallSession(callSid);
        if (!session?.streamSid) return;
        ws.send(JSON.stringify({
          event: "media",
          streamSid: session.streamSid,
          media: { payload: base64Audio },
        }));
      });
      break;
    }

    case "stop": {
      const callSid = ws.data.callSid;
      if (callSid) {
        endCallSession(callSid);
        logger.info("webhook:ws-stop", { callSid });
      }
      break;
    }
  }
}

function handleWsClose(ws: ServerWebSocket<{ callSid: string | null }>): void {
  const callSid = ws.data.callSid;
  if (callSid) {
    endCallSession(callSid);
    logger.info("webhook:ws-closed", { callSid });
  }
}

type ServerWebSocket<T> = {
  data: T;
  send(data: string | Buffer): void;
};

export function startWebhookServer(port: number): void {
  server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/voice/stream" && server.upgrade(req, { data: { callSid: null } })) {
        return undefined as unknown as Response;
      }

      if (req.method === "POST" && url.pathname === "/voice/answer") {
        const body = await req.clone().text();
        if (!await validateTwilioSignature(req, body)) {
          logger.warn("webhook:invalid-signature", { path: "/voice/answer" });
          return new Response("Forbidden", { status: 403 });
        }
        return handleAnswerRoute(req);
      }

      if (req.method === "POST" && url.pathname === "/voice/status") {
        const body = await req.clone().text();
        if (!await validateTwilioSignature(req, body)) {
          logger.warn("webhook:invalid-signature", { path: "/voice/status" });
          return new Response("Forbidden", { status: 403 });
        }
        return handleStatusRoute(req);
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) { handleWebSocket(ws as unknown as ServerWebSocket<{ callSid: string | null }>); },
      message(ws, raw) { handleWsMessage(ws as unknown as ServerWebSocket<{ callSid: string | null }>, raw as string | Buffer); },
      close(ws) { handleWsClose(ws as unknown as ServerWebSocket<{ callSid: string | null }>); },
    },
  });

  logger.info("webhook:started", { port });
}

export function stopWebhookServer(): void {
  if (server) {
    server.stop();
    server = null;
    logger.info("webhook:stopped");
  }
}
