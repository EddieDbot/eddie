import { homedir } from "os";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";
import { runSQL } from "../../database/admin.ts";

const BRAIN_VAULT = join(homedir(), "brain-vault");
const CONTACTS_FILE = join(BRAIN_VAULT, "20 - Areas", "contacts.md");

interface RelayContact {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  organization: string | null;
  phones: string[];
  emails: string[];
}

async function fetchContacts(): Promise<RelayContact[]> {
  const baseUrl = config.COMMS_IMESSAGE_RELAY_URL!;
  const headers: Record<string, string> = {};
  if (config.COMMS_IMESSAGE_RELAY_KEY)
    headers["x-api-key"] = config.COMMS_IMESSAGE_RELAY_KEY;

  const res = await fetch(`${baseUrl}/contacts`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`contacts fetch error: ${res.status}`);
  const data = (await res.json()) as { contacts: RelayContact[] };
  return data.contacts ?? [];
}

async function upsertToSupabase(contacts: RelayContact[]): Promise<void> {
  if (!config.SUPABASE_PAT) return;

  // Deduplicate by full_name (merge phones/emails for same-named contacts)
  const deduped = new Map<string, RelayContact>();
  for (const c of contacts) {
    const key =
      c.fullName ||
      `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ||
      "Unknown";
    const existing = deduped.get(key);
    if (existing) {
      existing.phones = [...new Set([...existing.phones, ...c.phones])];
      existing.emails = [...new Set([...existing.emails, ...c.emails])];
    } else {
      deduped.set(key, { ...c, fullName: key });
    }
  }
  const dedupedContacts = Array.from(deduped.values());

  // Clear existing apple-contacts and re-insert (clean daily sync)
  await runSQL(`DELETE FROM contacts WHERE source = 'apple-contacts'`);

  // Batch insert in chunks of 100
  const chunk = 100;
  for (let i = 0; i < dedupedContacts.length; i += chunk) {
    const batch = dedupedContacts.slice(i, i + chunk);
    const values = batch
      .map((c) => {
        const firstName = c.firstName
          ? `'${c.firstName.replace(/'/g, "''")}'`
          : "NULL";
        const lastName = c.lastName
          ? `'${c.lastName.replace(/'/g, "''")}'`
          : "NULL";
        const fullName = c.fullName.replace(/'/g, "''");
        const org = c.organization
          ? `'${c.organization.replace(/'/g, "''")}'`
          : "NULL";
        const phones = JSON.stringify(c.phones).replace(/'/g, "''");
        const emails = JSON.stringify(c.emails).replace(/'/g, "''");
        return `(${firstName}, ${lastName}, '${fullName}', ${org}, '${phones}'::jsonb, '${emails}'::jsonb, 'apple-contacts', now())`;
      })
      .join(",\n");

    await runSQL(`
      INSERT INTO contacts (first_name, last_name, full_name, organization, phones, emails, source, last_synced)
      VALUES ${values}
      ON CONFLICT (source, full_name) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        organization = EXCLUDED.organization,
        phones = EXCLUDED.phones,
        emails = EXCLUDED.emails,
        last_synced = now()
    `);
  }
}

function writeBrainVault(contacts: RelayContact[]): void {
  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const rows = contacts
    .filter((c) => c.fullName)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((c) => {
      const phones = c.phones.join(", ") || "—";
      const emails = c.emails.join(", ") || "—";
      return `| ${c.fullName} | ${phones} | ${emails} |`;
    })
    .join("\n");

  const content = `# Apple Contacts

> Last synced: ${now} CT
> Total: ${contacts.length} contacts

| Name | Phones | Emails |
|------|--------|--------|
${rows}
`;

  mkdirSync(join(BRAIN_VAULT, "20 - Areas"), { recursive: true });
  writeFileSync(CONTACTS_FILE, content, "utf8");
}

export async function syncContacts(): Promise<void> {
  if (!config.COMMS_IMESSAGE_RELAY_URL) {
    logger.warn("contact-sync:skip", {
      reason: "COMMS_IMESSAGE_RELAY_URL not set",
    });
    return;
  }

  logger.info("contact-sync:start");
  try {
    const contacts = await fetchContacts();
    logger.info("contact-sync:fetched", { count: contacts.length });

    await Promise.all([
      upsertToSupabase(contacts).catch((err) =>
        logger.warn("contact-sync:supabase-error", { error: String(err) }),
      ),
      Promise.resolve().then(() => {
        try {
          writeBrainVault(contacts);
          logger.info("contact-sync:brain-vault-written", {
            path: CONTACTS_FILE,
          });
        } catch (err) {
          logger.warn("contact-sync:brain-vault-error", { error: String(err) });
        }
      }),
    ]);

    logger.info("contact-sync:done", { count: contacts.length });
  } catch (err) {
    logger.error("contact-sync:error", { error: String(err) });
    throw err;
  }
}

function msUntil(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h!, m!, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

export function startContactSync(): void {
  // Initial sync on startup
  syncContacts().catch((err) =>
    logger.warn("contact-sync:startup-error", { error: String(err) }),
  );

  // Daily sync at configured time
  const schedule = () => {
    const delay = msUntil(config.CONTACT_SYNC_TIME);
    setTimeout(async () => {
      await syncContacts().catch((err) =>
        logger.warn("contact-sync:scheduled-error", { error: String(err) }),
      );
      schedule();
    }, delay);
  };
  schedule();

  logger.info("contact-sync:scheduled", { time: config.CONTACT_SYNC_TIME });
}
