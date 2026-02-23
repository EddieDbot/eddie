import { transcribe } from "./stt.ts";
import { synthesize } from "./tts.ts";
import { relayVoiceDirect } from "../claude/relay.ts";
import { storeConversation, logCommunication } from "../memory/store.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

type CallSession = {
  callSid: string;
  streamSid: string | null;
  audioChunks: Buffer[];
  transcript: { role: "user" | "assistant"; text: string }[];
  silenceTimer: ReturnType<typeof setTimeout> | null;
  speaking: boolean;
  processing: boolean;
  sending: boolean;
  interrupted: boolean;
  active: boolean;
  createdAt: number;
};

const activeSessions = new Map<string, CallSession>();
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  for (const [callSid, session] of activeSessions) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) {
      logger.warn("voice:session-expired", { callSid, age: now - session.createdAt });
      session.active = false;
      if (session.silenceTimer) clearTimeout(session.silenceTimer);
      activeSessions.delete(callSid);
    }
  }
}, 5 * 60 * 1000); // check every 5 min

const SILENCE_THRESHOLD_MS = 800;
const SPEECH_THRESHOLD = 300;
const MIN_SPEECH_CHUNKS = 10;
const MULAW_SAMPLE_RATE = 8000;

function mulawDecode(mulawByte: number): number {
  mulawByte = ~mulawByte & 0xff;
  const sign = mulawByte & 0x80;
  const exponent = (mulawByte >> 4) & 0x07;
  const mantissa = mulawByte & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function mulawEncode(sample: number): number {
  const BIAS = 0x84;
  const MAX = 0x7fff;
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > MAX) sample = MAX;
  sample += BIAS;
  let exponent = 7;
  const expMask = 0x4000;
  for (; exponent > 0; exponent--) {
    if (sample & expMask) break;
    sample <<= 1;
  }
  const mantissa = (sample >> 10) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function mulawToPcm16(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    const sample = mulawDecode(mulaw[i]!);
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

function pcm16ToMulaw(pcm: Buffer): Buffer {
  const mulaw = Buffer.alloc(pcm.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    const sample = pcm.readInt16LE(i * 2);
    mulaw[i] = mulawEncode(sample);
  }
  return mulaw;
}

function resamplePcm(input: Buffer, fromRate: number, toRate: number): Buffer {
  const ratio = fromRate / toRate;
  const inputSamples = input.length / 2;
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = Buffer.alloc(outputSamples * 2);
  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = Math.min(Math.floor(i * ratio), inputSamples - 1);
    output.writeInt16LE(input.readInt16LE(srcIndex * 2), i * 2);
  }
  return output;
}

function pcm16ToWav(pcm: Buffer, sampleRate: number, channels: number = 1, bitsPerSample: number = 16): Buffer {
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function getChunkEnergy(mulaw: Buffer): number {
  let sum = 0;
  for (let i = 0; i < mulaw.length; i++) {
    const sample = Math.abs(mulawDecode(mulaw[i]!));
    sum += sample;
  }
  return mulaw.length > 0 ? sum / mulaw.length : 0;
}

export function createCallSession(callSid: string): CallSession {
  const session: CallSession = {
    callSid,
    streamSid: null,
    audioChunks: [],
    transcript: [],
    silenceTimer: null,
    speaking: false,
    processing: false,
    sending: false,
    interrupted: false,
    active: true,
    createdAt: Date.now(),
  };
  activeSessions.set(callSid, session);
  logger.info("voice:session-created", { callSid });
  return session;
}

export function getCallSession(callSid: string): CallSession | undefined {
  return activeSessions.get(callSid);
}

export async function handleMediaMessage(
  callSid: string,
  payload: string,
  sendAudio: (base64Audio: string) => void,
): Promise<void> {
  const session = activeSessions.get(callSid);
  if (!session || !session.active) return;

  const chunk = Buffer.from(payload, "base64");
  const energy = getChunkEnergy(chunk);

  if (energy > SPEECH_THRESHOLD) {
    // Barge-in: user started speaking while EDDIE is sending audio
    if (session.sending) {
      session.interrupted = true;
      session.sending = false;
      logger.info("voice:barge-in", { callSid, energy });
    }

    if (!session.speaking) {
      session.speaking = true;
      logger.debug("voice:speech-start", { callSid, energy });
    }
    session.audioChunks.push(chunk);

    if (session.silenceTimer) {
      clearTimeout(session.silenceTimer);
      session.silenceTimer = null;
    }
  } else if (session.speaking) {
    session.audioChunks.push(chunk);

    if (!session.silenceTimer) {
      session.silenceTimer = setTimeout(async () => {
        session.silenceTimer = null;

        if (!session.active || session.audioChunks.length < MIN_SPEECH_CHUNKS) {
          session.audioChunks = [];
          session.speaking = false;
          return;
        }

        // Don't start new processing if already processing
        if (session.processing) {
          session.audioChunks = [];
          session.speaking = false;
          return;
        }

        const audioData = Buffer.concat(session.audioChunks);
        session.audioChunks = [];
        session.speaking = false;
        session.processing = true;
        session.interrupted = false;

        logger.info("voice:processing", { callSid, audioBytes: audioData.length, chunks: audioData.length / 160 });

        try {
          await processUtterance(session, audioData, sendAudio);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("voice:utterance-error", { callSid, error: msg });
        } finally {
          session.processing = false;
        }
      }, SILENCE_THRESHOLD_MS);
    }
  }
}

async function processUtterance(
  session: CallSession,
  mulawAudio: Buffer,
  sendAudio: (base64Audio: string) => void,
): Promise<void> {
  const pcm8k = mulawToPcm16(mulawAudio);
  const pcm16k = resamplePcm(pcm8k, MULAW_SAMPLE_RATE, 16000);
  const wav = pcm16ToWav(pcm16k, 16000);

  const userText = await transcribe(wav);
  if (!userText.trim()) return;

  logger.info("voice:transcribed", { callSid: session.callSid, text: userText });
  session.transcript.push({ role: "user", text: userText });

  const contextPrompt = session.transcript.length > 1
    ? "[Phone call transcript so far]\n" +
      session.transcript.slice(0, -1).map(t => `${t.role === "user" ? "Nicholas" : "EDDIE"}: ${t.text}`).join("\n") +
      "\n\n[Nicholas just said]\n" + userText
    : userText;

  const response = await relayVoiceDirect(contextPrompt);
  const assistantText = response.text || "I didn't catch that. Could you repeat?";

  logger.info("voice:response", { callSid: session.callSid, textLen: assistantText.length });
  session.transcript.push({ role: "assistant", text: assistantText });

  const ttsAudio = await synthesize(assistantText, "pcm_24000");

  const responsePcm8k = resamplePcm(ttsAudio, 24000, MULAW_SAMPLE_RATE);
  const responseMulaw = pcm16ToMulaw(responsePcm8k);

  session.sending = true;
  session.interrupted = false;
  const CHUNK_SIZE = 640;
  for (let i = 0; i < responseMulaw.length; i += CHUNK_SIZE) {
    if (session.interrupted || !session.active) {
      logger.info("voice:playback-interrupted", { callSid: session.callSid, sentBytes: i, totalBytes: responseMulaw.length });
      break;
    }
    const chunk = responseMulaw.subarray(i, i + CHUNK_SIZE);
    sendAudio(chunk.toString("base64"));
  }
  session.sending = false;
}

export async function endCallSession(callSid: string): Promise<void> {
  const session = activeSessions.get(callSid);
  if (!session) return;

  session.active = false;
  if (session.silenceTimer) clearTimeout(session.silenceTimer);

  logger.info("voice:session-end", { callSid, turns: session.transcript.length });

  if (session.transcript.length > 0) {
    const fullTranscript = session.transcript
      .map((t) => `${t.role}: ${t.text}`)
      .join("\n");

    await storeConversation(`voice-${callSid}`, "user", fullTranscript);
    await logCommunication("voice", "inbound", `Voice call with ${session.transcript.length} turns`);

    await sendTelegramSummary(session);
  }

  activeSessions.delete(callSid);
}

async function sendTelegramSummary(session: CallSession): Promise<void> {
  const summary = session.transcript
    .map((t) => `${t.role === "user" ? "You" : "EDDIE"}: ${t.text}`)
    .join("\n");

  const message = `Voice call ended (${session.transcript.length} turns):\n\n${summary}`;

  const botToken = config.TELEGRAM_BOT_TOKEN;
  const chatId = config.OWNER_TELEGRAM_ID;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("voice:telegram-summary-error", { error: msg });
  }
}
