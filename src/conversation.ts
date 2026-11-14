/**
 * Chat-style notifications on the web: the messages of one conversation stack in one notification (its tag), the
 * sender's photo is the icon, and a group shows its name with "sender: text" lines.
 *
 * A message is shown this way when its data has a `conversationId` (the same keys as every Rivium Push SDK):
 * `conversationId`, `senderName`, `senderId`, `senderAvatarUrl`, `conversationTitle`, `conversationIsGroup`.
 * service-worker.js has the same logic for pushes that arrive while no page is open.
 */
export interface WebConversation {
  id: string;
  senderName: string;
  avatarUrl?: string;
  title?: string;
  isGroup: boolean;
}

/** Lines kept in one stacked notification. */
export const MAX_CONVERSATION_LINES = 5;

const text = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
};

export function conversationOf(data: Record<string, unknown> | undefined | null, fallbackSender: string): WebConversation | null {
  if (!data) return null;
  const id = text(data.conversationId);
  if (!id) return null;
  const avatar = text(data.senderAvatarUrl);
  return {
    id: id.slice(0, 200),
    senderName: text(data.senderName) ?? (fallbackSender || '?'),
    avatarUrl: avatar && /^https?:\/\//i.test(avatar) ? avatar : undefined,
    title: text(data.conversationTitle),
    isGroup: data.conversationIsGroup === true || String(data.conversationIsGroup).toLowerCase() === 'true',
  };
}

export const conversationTag = (c: WebConversation) => `rivium-conversation:${c.id}`;

/** Title, body (earlier lines + this one) and the lines to keep on the notification. */
export function conversationView(c: WebConversation, body: string, previousLines: unknown): { title: string; body: string; lines: string[] } {
  const line = c.isGroup ? `${c.senderName}: ${body}` : body;
  const before = Array.isArray(previousLines) ? previousLines.filter((l): l is string => typeof l === 'string') : [];
  const lines = [...before, line].slice(-MAX_CONVERSATION_LINES);
  return { title: c.isGroup && c.title ? c.title : c.senderName, body: lines.join('\n'), lines };
}
