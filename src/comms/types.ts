export type ChannelId =
  | "gmail"
  | "gmail-eddie"
  | "google-calendar"
  | "icloud-calendar"
  | "imessage"
  | "slack"
  | "whatsapp";

export type InboxItemStatus = "unread" | "read" | "archived";
export type InboxItemPriority = "high" | "normal" | "low";

export interface InboxItem {
  id?: string;
  channel: ChannelId;
  externalId: string;
  from: string;
  subject?: string;
  preview: string;
  body?: string;
  receivedAt: string;
  status: InboxItemStatus;
  priority: InboxItemPriority;
  metadata?: Record<string, unknown>;
}

export interface ChannelStatus {
  channel: ChannelId;
  enabled: boolean;
  healthy: boolean;
  lastPolledAt?: string;
  lastError?: string;
  itemCount?: number;
}

export interface ChannelProvider {
  id: ChannelId;
  pollIntervalMs: number;
  poll(): Promise<InboxItem[]>;
  healthCheck(): Promise<boolean>;
  getStatus(): Promise<ChannelStatus>;
}
