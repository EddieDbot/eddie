import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export async function synthesize(text: string, outputFormat: "mp3_44100_128" | "pcm_24000" = "mp3_44100_128"): Promise<Buffer> {
  if (!config.ELEVENLABS_API_KEY) throw new Error("ElevenLabs not configured");

  const voiceId = config.ELEVENLABS_VOICE_ID;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error("tts:error", { status: res.status, body });
    throw new Error(`TTS failed: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
