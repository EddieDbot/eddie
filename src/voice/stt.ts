import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export async function transcribe(audioBuffer: Buffer): Promise<string> {
  if (!config.ELEVENLABS_API_KEY) throw new Error("ElevenLabs not configured");

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");
  form.append("model_id", "scribe_v1");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": config.ELEVENLABS_API_KEY },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error("stt:error", { status: res.status, body });
    throw new Error(`STT failed: ${res.status}`);
  }

  const data = await res.json() as { text: string };
  return data.text;
}
