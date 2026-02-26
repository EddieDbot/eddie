import { logger } from "../utils/logger.ts";
import { getAccessToken } from "../comms/google/auth.ts";

const TTS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TTS_API = "https://texttospeech.googleapis.com/v1/text:synthesize";

const VOICE = {
  languageCode: "en-US",
  name: "en-US-Wavenet-D",
  ssmlGender: "MALE",
};

const AUDIO_CONFIG = {
  audioEncoding: "MP3",
  speakingRate: 1.14,
  pitch: 0.0,
  sampleRateHertz: 44100,
};

export async function synthesizeGoogle(text: string): Promise<Buffer> {
  const token = await getAccessToken(TTS_SCOPE);

  const res = await fetch(TTS_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: { text },
      voice: VOICE,
      audioConfig: AUDIO_CONFIG,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error("google-tts:error", { status: res.status, body: body.slice(0, 200) });
    throw new Error(`Google TTS failed: ${res.status}`);
  }

  const data = await res.json() as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error("Google TTS returned no audioContent");
  }

  const audioBytes = Buffer.from(data.audioContent, "base64");
  logger.info("google-tts:done", { textLength: text.length, audioBytes: audioBytes.length });
  return audioBytes;
}
