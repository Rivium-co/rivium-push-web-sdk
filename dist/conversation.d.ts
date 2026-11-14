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
export declare const MAX_CONVERSATION_LINES = 5;
export declare function conversationOf(data: Record<string, unknown> | undefined | null, fallbackSender: string): WebConversation | null;
export declare const conversationTag: (c: WebConversation) => string;
/** Title, body (earlier lines + this one) and the lines to keep on the notification. */
export declare function conversationView(c: WebConversation, body: string, previousLines: unknown): {
    title: string;
    body: string;
    lines: string[];
};
