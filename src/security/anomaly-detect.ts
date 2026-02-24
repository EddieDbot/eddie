import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";

const JOBS_DIR = resolve(import.meta.dir, "../../data/jobs");

// Patterns that indicate potential threats in job output
const THREAT_PATTERNS = [
  { pattern: /curl\s+[^|]*\s+\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, label: "curl-to-ip" },
  { pattern: /wget\s+[^|]*\s+\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, label: "wget-to-ip" },
  { pattern: /echo\s+['"]?[A-Za-z0-9+/]{40,}={0,2}['"]?\s*\|.*base64/g, label: "base64-payload" },
  { pattern: /ANTHROPIC_API_KEY\s*=\s*sk-ant-/g, label: "api-key-echo" },
  { pattern: /cat\s+~\/\.env/g, label: "env-read" },
  { pattern: /rm\s+-rf\s+~[^\s]*/g, label: "destructive-rm" },
];

export type Anomaly = {
  jobOutputFile: string;
  label: string;
  excerpt: string;
  detectedAt: string;
};

export async function detectAnomalies(maxFiles = 20): Promise<Anomaly[]> {
  if (!config.ANOMALY_DETECT_ENABLED) return [];

  const anomalies: Anomaly[] = [];

  let files: string[] = [];
  try {
    const all = await readdir(JOBS_DIR);
    files = all
      .filter((f) => f.endsWith("-output.txt"))
      .sort()
      .slice(-maxFiles); // check most recent N files
  } catch {
    return [];
  }

  for (const filename of files) {
    const path = resolve(JOBS_DIR, filename);
    let content = "";
    try {
      content = await Bun.file(path).text();
    } catch {
      continue;
    }

    for (const { pattern, label } of THREAT_PATTERNS) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        anomalies.push({
          jobOutputFile: filename,
          label,
          excerpt: match[0].slice(0, 120),
          detectedAt: new Date().toISOString(),
        });
        logger.warn("anomaly-detect:threat", { file: filename, label });
      }
    }
  }

  return anomalies;
}

export async function runAnomalyCheck(): Promise<void> {
  const anomalies = await detectAnomalies();
  if (anomalies.length > 0) {
    logger.warn("anomaly-detect:summary", { count: anomalies.length, anomalies });
  } else {
    logger.info("anomaly-detect:clean");
  }
}
