import { logger } from "../utils/logger.ts";
import { getYouTubeAccessToken } from "./youtube-auth.ts";

const UPLOAD_API =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const DATA_API = "https://www.googleapis.com/youtube/v3/videos";

export type UploadParams = {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  privacyStatus?: "public" | "private" | "unlisted";
  madeForKids?: boolean;
};

export type UploadResult = {
  videoId: string;
  url: string;
  title: string;
};

export async function uploadVideo(params: UploadParams): Promise<UploadResult> {
  const {
    videoPath,
    title,
    description,
    tags,
    categoryId = "28",
    privacyStatus = "public",
    madeForKids = false,
  } = params;

  const file = Bun.file(videoPath);
  if (!(await file.exists())) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  const fileSize = file.size;

  const token = await getYouTubeAccessToken();

  const metadata = {
    snippet: {
      title,
      description,
      tags,
      categoryId,
    },
    status: {
      privacyStatus,
      madeForKids,
    },
  };

  logger.info("youtube:upload:start", { title, videoPath, fileSize });

  // Step 1: initiate resumable upload session
  const initRes = await fetch(UPLOAD_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(fileSize),
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(30_000),
  });

  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(
      `YouTube upload init failed ${initRes.status}: ${body}`,
    );
  }

  const uploadUri = initRes.headers.get("Location");
  if (!uploadUri) {
    throw new Error("YouTube upload init did not return a Location header.");
  }

  logger.info("youtube:upload:session-started", { uploadUri });

  // Step 2: PUT the video bytes
  const videoBytes = await file.arrayBuffer();
  const uploadRes = await fetch(uploadUri, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(fileSize),
    },
    body: videoBytes,
    // No timeout — large files can take a long time
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`YouTube upload PUT failed ${uploadRes.status}: ${body}`);
  }

  const result = (await uploadRes.json()) as {
    id: string;
    snippet?: { title?: string };
  };

  const videoId = result.id;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  logger.info("youtube:upload:complete", { videoId, url });

  return {
    videoId,
    url,
    title: result.snippet?.title ?? title,
  };
}

export async function getUploadStatus(videoId: string): Promise<string> {
  const token = await getYouTubeAccessToken();

  const res = await fetch(
    `${DATA_API}?part=processingDetails,status&id=${videoId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    throw new Error(
      `YouTube status fetch failed ${res.status}: ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    items?: Array<{
      status?: { uploadStatus?: string };
      processingDetails?: { processingStatus?: string };
    }>;
  };

  const item = data.items?.[0];
  if (!item) return "not_found";

  const uploadStatus = item.status?.uploadStatus ?? "unknown";
  const processingStatus =
    item.processingDetails?.processingStatus ?? "unknown";

  return `${uploadStatus}/${processingStatus}`;
}
