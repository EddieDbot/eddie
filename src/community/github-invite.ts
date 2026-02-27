import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const ORG = "EddieDbot";
const REPO = "eddie-community-pro";

export interface InviteResult {
  success: boolean;
  status: "invited" | "already_member" | "pending" | "error";
  message: string;
}

export async function inviteToProRepo(
  githubUsername: string,
): Promise<InviteResult> {
  const pat = config.GITHUB_PAT;
  if (!pat) {
    return { success: false, status: "error", message: "GITHUB_PAT not set" };
  }

  const url = `https://api.github.com/repos/${ORG}/${REPO}/collaborators/${encodeURIComponent(githubUsername)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ permission: "pull" }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("community:github-invite:fetch-error", { githubUsername, msg });
    return { success: false, status: "error", message: `Network error: ${msg}` };
  }

  logger.info("community:github-invite:response", {
    githubUsername,
    status: res.status,
  });

  // 201 = invite sent, 204 = already a collaborator
  if (res.status === 201) {
    return {
      success: true,
      status: "invited",
      message: `Invite sent to @${githubUsername}. They'll get an email from GitHub.`,
    };
  }

  if (res.status === 204) {
    return {
      success: true,
      status: "already_member",
      message: `@${githubUsername} is already a collaborator.`,
    };
  }

  if (res.status === 422) {
    // User doesn't exist on GitHub or other validation error
    const body = await res.json().catch(() => ({}));
    const detail = (body as any)?.message ?? "validation error";
    return {
      success: false,
      status: "error",
      message: `GitHub rejected invite for @${githubUsername}: ${detail}`,
    };
  }

  return {
    success: false,
    status: "error",
    message: `Unexpected GitHub response: HTTP ${res.status}`,
  };
}

export async function listPendingInvites(): Promise<string[]> {
  const pat = config.GITHUB_PAT;
  if (!pat) return [];

  try {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${REPO}/invitations`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    return data.map((inv) => inv.invitee?.login ?? "unknown");
  } catch {
    return [];
  }
}

export async function removeFromProRepo(
  githubUsername: string,
): Promise<{ success: boolean; message: string }> {
  const pat = config.GITHUB_PAT;
  if (!pat) return { success: false, message: "GITHUB_PAT not set" };

  const url = `https://api.github.com/repos/${ORG}/${REPO}/collaborators/${encodeURIComponent(githubUsername)}`;

  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 204) {
      return { success: true, message: `@${githubUsername} removed from Pro repo.` };
    }
    return { success: false, message: `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}
