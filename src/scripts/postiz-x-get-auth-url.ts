/**
 * Gets a fresh Postiz X OAuth auth URL with state stored in Redis,
 * then prints it for Nicholas to open in his browser.
 */
const POSTIZ_URL = "https://m7k4x.nac70x7.com";
const POSTIZ_EMAIL = "eddie@nac70x7.com";
const POSTIZ_PASSWORD = "EddieDbot2026!#";

async function login(): Promise<string> {
  const resp = await fetch(`${POSTIZ_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: POSTIZ_EMAIL,
      password: POSTIZ_PASSWORD,
      provider: "LOCAL",
    }),
  });
  const cookie =
    resp.headers.get("auth") ||
    resp.headers.get("set-cookie")?.match(/auth=([^;]+)/)?.[1];
  if (!cookie)
    throw new Error(`Login failed: ${resp.status} ${await resp.text()}`);
  return cookie;
}

async function run() {
  const token = await login();

  const resp = await fetch(`${POSTIZ_URL}/api/integrations/social/x`, {
    headers: { Cookie: `auth=${token}` },
  });
  if (!resp.ok)
    throw new Error(`Failed: ${resp.status} ${await resp.text()}`);

  const { url } = (await resp.json()) as { url: string };
  const oauthToken = new URL(url).searchParams.get("oauth_token");

  console.log("\n✅ Redis state is set (login + organization keys, 1hr TTL)");
  console.log(`\n📋 Open this URL in your browser to authorize @EddieDbot:\n`);
  console.log(url);
  console.log(`\n   oauth_token: ${oauthToken}`);
  console.log(`\n   After you click Authorize on X, you'll be redirected to:`);
  console.log(`   ${POSTIZ_URL}/integrations/social/x?oauth_token=...&oauth_verifier=...`);
  console.log(`   Postiz frontend will complete the connection automatically.\n`);
}

run().catch(console.error);
