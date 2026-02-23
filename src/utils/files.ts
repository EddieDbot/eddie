import { join } from "node:path";
import { unlinkSync } from "node:fs";

type BotWithApi = {
  api: { getFile: (params: { file_id: string }) => Promise<{ file_path?: string }> };
  options: { token: string };
};

export async function downloadTelegramFile(bot: BotWithApi, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile({ file_id: fileId });

  if (!file.file_path) {
    throw new Error(`No file_path returned for file_id: ${fileId}`);
  }

  const token = bot.options.token;
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function saveTempFile(buffer: Buffer, ext: string): Promise<string> {
  const name = `cc-hands-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = join("/tmp", name);
  await Bun.write(path, buffer);
  return path;
}

export function cleanupTempFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already cleaned up
  }
}
