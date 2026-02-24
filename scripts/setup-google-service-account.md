# Google Service Account Setup — Browser Automation

## Goal
Create a Google Cloud service account with domain-wide delegation so EDDIE never needs OAuth re-auth again.

## Context
- Google Cloud Project: `gen-lang-client-0088821361`
- Google Workspace domain: `nac70x7.com`
- Impersonation subject: `nicholas@nac70x7.com`
- Key destination on server: `~/.claude/google-hub/service-account.json`

## Required Scopes (comma-separated for Workspace Admin)
```
https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/drive
```

---

## Step 1 — Create Service Account (Google Cloud Console)

Navigate to:
```
https://console.cloud.google.com/iam-admin/serviceaccounts?project=gen-lang-client-0088821361
```

1. Click **"+ Create Service Account"**
2. Name: `eddie-server`
3. Description: `EDDIE homelab assistant — domain-wide delegation`
4. Click **"Create and Continue"**
5. Skip role assignment (click **"Continue"** → **"Done"**)

---

## Step 2 — Enable Domain-Wide Delegation

After creation, click the `eddie-server` service account row to open it.

1. Click the **"Advanced settings"** or **"Details"** tab
2. Find **"Domain-wide delegation"** section
3. Click **"Enable Google Workspace Domain-wide Delegation"**
4. Product name: `EDDIE`
5. Click **"Save"**
6. **Copy the Client ID** shown (format: `1234567890123456789`) — you'll need it in Step 4

---

## Step 3 — Download JSON Key

While still on the service account page:

1. Click the **"Keys"** tab
2. Click **"Add Key"** → **"Create new key"**
3. Select **"JSON"** → **"Create"**
4. File downloads automatically — note the filename

Then run this on the server to move it:
```bash
# On Mac, the file is in ~/Downloads — sync it to the server
scp ~/Downloads/gen-lang-client-*.json na@100.73.11.127:~/.claude/google-hub/service-account.json
```

---

## Step 4 — Authorize in Workspace Admin

Navigate to:
```
https://admin.google.com/ac/owl/domainwidedelegation
```

1. Click **"Add new"**
2. **Client ID**: paste the client ID from Step 2
3. **OAuth scopes**: paste this exactly:
```
https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/drive
```
4. Click **"Authorize"**

---

## Step 5 — Configure EDDIE

Once the key is on the server at `~/.claude/google-hub/service-account.json`, run:

```bash
# Add to /home/na/eddie/.env
echo 'GOOGLE_SERVICE_ACCOUNT_PATH=~/.claude/google-hub/service-account.json' >> /home/na/eddie/.env
echo 'GOOGLE_SUBJECT=nicholas@nac70x7.com' >> /home/na/eddie/.env
```

Then check config.ts supports these vars, and restart:
```bash
systemctl --user restart eddie
```

---

## Step 6 — Verify

Check EDDIE logs after restart:
```bash
journalctl --user -u eddie -f | grep "google:auth"
```

Should see `google:auth:sa-token` instead of `google:auth:oauth-loaded`. Gmail + Calendar should come back online without any re-auth.
