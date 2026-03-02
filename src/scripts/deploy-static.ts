/**
 * deploy-static.ts — Deploy a directory of static files to Netlify (primary) or Surge (fallback)
 *
 * Usage:
 *   bun src/scripts/deploy-static.ts <directory> [site-name]
 *
 * Examples:
 *   bun src/scripts/deploy-static.ts ~/brain-vault/10\ -\ Projects/shur/competitive-demo shur-demo
 *   bun src/scripts/deploy-static.ts /tmp/my-site
 *
 * Output: prints the live URL to stdout
 * Credentials: ~/.config/eddie-accounts/credentials.json
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

import { homedir } from "node:os";

const CREDENTIALS_PATH = path.join(
  homedir(),
  ".config/eddie-accounts/credentials.json",
);
const NETLIFY_API = "https://api.netlify.com/api/v1";

interface Credentials {
  netlify?: {
    api_token: string;
    email: string;
    sites?: Record<string, { id: string; url: string }>;
  };
  surge?: {
    email: string;
    token: string;
  };
  internet_archive?: {
    s3_access_key: string;
    s3_secret_key: string;
    screen_name: string;
  };
  [key: string]: unknown;
}

function loadCredentials(): Credentials {
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
}

function saveCredentials(creds: Credentials) {
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

async function netlifyDeploy(
  dir: string,
  siteName: string,
  token: string,
  creds: Credentials,
): Promise<string> {
  const zipPath = `/tmp/deploy-${Date.now()}.zip`;

  // Zip the directory
  const zipResult = spawnSync("zip", ["-r", zipPath, "."], { cwd: dir });
  if (zipResult.status !== 0) {
    throw new Error(`zip failed: ${zipResult.stderr?.toString()}`);
  }

  // Check for existing site
  const existingSiteId = creds.netlify?.sites?.[siteName]?.id;

  let siteId: string;
  let siteUrl: string;

  if (existingSiteId) {
    siteId = existingSiteId;
    siteUrl = creds.netlify!.sites![siteName]!.url;
    console.error(`[netlify] Reusing site: ${siteName} (${siteId})`);
  } else {
    // Create new site
    const createRes = await fetch(`${NETLIFY_API}/sites`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: siteName }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(
        `Failed to create Netlify site: ${createRes.status} ${err}`,
      );
    }

    const site = (await createRes.json()) as {
      id: string;
      ssl_url: string;
      name: string;
    };
    siteId = site.id;
    siteUrl = site.ssl_url;
    console.error(`[netlify] Created site: ${site.name} → ${siteUrl}`);

    // Persist site ID
    if (!creds.netlify!.sites) creds.netlify!.sites = {};
    creds.netlify!.sites[siteName] = { id: siteId, url: siteUrl };
    saveCredentials(creds);
  }

  // Deploy zip
  const zipData = fs.readFileSync(zipPath);
  const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/zip",
    },
    body: zipData,
  });

  fs.unlinkSync(zipPath);

  if (!deployRes.ok) {
    const err = await deployRes.text();
    throw new Error(`Netlify deploy failed: ${deployRes.status} ${err}`);
  }

  const deploy = (await deployRes.json()) as {
    id: string;
    ssl_url: string;
    state: string;
  };
  console.error(`[netlify] Deploy ${deploy.id} — state: ${deploy.state}`);

  // Poll for ready (up to 2 minutes)
  if (deploy.state !== "ready") {
    for (let i = 0; i < 24; i++) {
      await Bun.sleep(5000);
      const pollRes = await fetch(`${NETLIFY_API}/deploys/${deploy.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const polled = (await pollRes.json()) as {
        state: string;
        ssl_url: string;
      };
      console.error(`[netlify] Deploy state: ${polled.state}`);
      if (polled.state === "ready") {
        return polled.ssl_url;
      }
      if (polled.state === "error") {
        throw new Error(`Netlify deploy failed with state: error`);
      }
    }
  }

  return deploy.ssl_url || siteUrl;
}

async function surgeDeploy(
  dir: string,
  siteName: string,
  token: string,
): Promise<string> {
  const domain = `${siteName}.surge.sh`;

  // Prefer bun-installed surge; fall back to system surge
  const home = homedir();
  const SURGE_PATHS = [
    path.join(home, ".bun/bin/surge"),
    path.join(home, ".nvm/versions/node/v22.22.0/bin/surge"),
  ];
  let surgeBin = SURGE_PATHS.find((p) => fs.existsSync(p)) ?? "surge";

  // Install via bun if not found
  if (surgeBin === "surge") {
    try {
      execSync("which surge", { stdio: "ignore" });
    } catch {
      console.error("[surge] Installing surge via bun...");
      execSync(`${path.join(home, ".bun/bin/bun")} install -g surge`, {
        stdio: "inherit",
      });
      surgeBin = path.join(home, ".bun/bin/surge");
    }
  }

  const result = spawnSync(surgeBin, [dir, domain, "--token", token], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`Surge deploy failed: ${result.stderr?.toString()}`);
  }

  return `https://${domain}`;
}

async function githubPagesDeploy(
  dir: string,
  siteName: string,
): Promise<string> {
  const HOSTING_REPO = "nac70x7/eddie-sites";
  const BASE_BRANCH = "gh-pages";
  const repoDir = `/tmp/eddie-sites-${Date.now()}`;

  try {
    // Clone or create the hosting repo
    const cloneResult = spawnSync(
      "gh",
      [
        "repo",
        "clone",
        HOSTING_REPO,
        repoDir,
        "--",
        "--depth=1",
        "--branch",
        BASE_BRANCH,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    if (cloneResult.status !== 0) {
      // Repo doesn't exist or branch doesn't exist — create it
      console.error("[github-pages] Creating hosting repo...");
      execSync(
        `gh repo create ${HOSTING_REPO} --public --description "EDDIE static site hosting" 2>&1 || true`,
      );
      execSync(
        `mkdir -p ${repoDir} && cd ${repoDir} && git init && git checkout -b ${BASE_BRANCH}`,
      );
      execSync(`echo "# EDDIE Sites" > ${repoDir}/README.md`);
      execSync(
        `cd ${repoDir} && git add . && git commit -m "init" && gh repo set-default ${HOSTING_REPO} && git push -u origin ${BASE_BRANCH}`,
      );
    }

    // Copy files into site subdirectory
    const siteDir = `${repoDir}/${siteName}`;
    execSync(`mkdir -p ${siteDir}`);
    execSync(`cp -r ${dir}/. ${siteDir}/`);

    // Commit and push
    execSync(
      `cd ${repoDir} && git add ${siteName}/ && git commit -m "deploy: ${siteName}" && git push origin ${BASE_BRANCH}`,
    );

    // Enable GitHub Pages if not already
    execSync(
      `gh api repos/${HOSTING_REPO}/pages --method POST --field source[branch]=${BASE_BRANCH} --field source[path]=/ 2>/dev/null || true`,
    );

    fs.rmSync(repoDir, { recursive: true, force: true });
    return `https://nac70x7.github.io/eddie-sites/${siteName}/`;
  } catch (e) {
    try {
      fs.rmSync(repoDir, { recursive: true, force: true });
    } catch {}
    throw e;
  }
}

async function iaDeploy(
  dir: string,
  siteName: string,
  creds: Credentials,
): Promise<string> {
  const ia = creds.internet_archive!;
  const identifier = `${siteName}-${new Date().toISOString().slice(0, 10)}`;
  const files = fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile());
  const urls: string[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const ext = path.extname(file).toLowerCase();
    const contentType =
      ext === ".html" ? "text/html" : "application/octet-stream";

    const res = await fetch(`https://s3.us.archive.org/${identifier}/${file}`, {
      method: "PUT",
      headers: {
        Authorization: `LOW ${ia.s3_access_key}:${ia.s3_secret_key}`,
        "x-archive-auto-make-bucket": "1",
        "Content-Type": contentType,
      },
      body: fs.readFileSync(filePath),
    });

    if (!res.ok) throw new Error(`IA upload failed for ${file}: ${res.status}`);
    urls.push(`https://archive.org/download/${identifier}/${file}`);
  }

  return urls[0] ?? `https://archive.org/details/${identifier}`;
}

async function main() {
  const [, , dirArg, siteNameArg] = process.argv;

  if (!dirArg) {
    console.error(
      "Usage: bun src/scripts/deploy-static.ts <directory> [site-name]",
    );
    process.exit(1);
  }

  let dir = path.resolve(dirArg.replace(/^~/, process.env.HOME!));
  if (!fs.existsSync(dir)) {
    console.error(`Path not found: ${dir}`);
    process.exit(1);
  }

  // Auto-wrap single HTML files in a temp dir as index.html
  let tempDir: string | null = null;
  if (fs.statSync(dir).isFile()) {
    if (!dir.endsWith(".html")) {
      console.error(`Single-file deploy only supports .html files: ${dir}`);
      process.exit(1);
    }
    tempDir = `/tmp/deploy-wrap-${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(dir, path.join(tempDir, "index.html"));
    console.error(
      `[deploy] Single file detected — wrapping as index.html in ${tempDir}`,
    );
    dir = tempDir;
  }

  const siteName =
    siteNameArg ?? `eddie-${path.basename(dir)}-${Date.now().toString(36)}`;

  const creds = loadCredentials();
  const cleanup = () => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    // Try Netlify first
    if (creds.netlify?.api_token) {
      try {
        console.error(`[deploy] Netlify → ${siteName}`);
        const url = await netlifyDeploy(
          dir,
          siteName,
          creds.netlify.api_token,
          creds,
        );
        console.log(url);
        return;
      } catch (e) {
        console.error(`[deploy] Netlify failed: ${e}`);
      }
    } else {
      console.error("[deploy] No Netlify token — skipping");
    }

    // Try Surge
    if (creds.surge?.token) {
      try {
        console.error(`[deploy] Surge → ${siteName}.surge.sh`);
        const url = await surgeDeploy(dir, siteName, creds.surge.token);
        console.log(url);
        return;
      } catch (e) {
        console.error(`[deploy] Surge failed: ${e}`);
      }
    } else {
      console.error("[deploy] No Surge token — skipping");
    }

    // Try GitHub Pages (via nac70x7 gh CLI)
    try {
      execSync("gh auth status", { stdio: "ignore" });
      console.error(
        `[deploy] GitHub Pages → nac70x7.github.io/eddie-sites/${siteName}/`,
      );
      const url = await githubPagesDeploy(dir, siteName);
      console.log(url);
      return;
    } catch (e) {
      console.error(`[deploy] GitHub Pages failed: ${e}`);
    }

    // Fallback: Internet Archive
    if (creds.internet_archive?.s3_access_key) {
      console.error(`[deploy] Falling back to Internet Archive`);
      const url = await iaDeploy(dir, siteName, creds);
      console.log(url);
      return;
    }

    console.error(
      "[deploy] No hosting provider available. Add Netlify or Surge token to credentials.",
    );
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
