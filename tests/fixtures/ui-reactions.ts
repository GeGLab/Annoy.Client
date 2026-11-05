import type { ElectronApplication } from "@playwright/test";

/**
 * Renderer-only fixtures for reactions and sends. Channel messages are plain
 * again (TODO item 3), so they answer the server's own HTTP routes.
 */
export interface ReactionFixture {
  writes: string[];
  delay: boolean;
  release: null | (() => void);
}

export async function uiReactionFixture(app: ElectronApplication): Promise<ReactionFixture> {
  const page = await app.firstWindow();
  const fixture: ReactionFixture = { writes: [], delay: false, release: null };
  await page.route(/\/api\/channels\/[^/]+\/messages\/[^/]+\/reactions\/[^/?]+$/, async (route) => {
    const method = route.request().method();
    if (method !== "PUT" && method !== "DELETE") return route.fallback();
    const [, channel, messageId, emoji] = /\/api\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/?]+)$/.exec(new URL(route.request().url()).pathname)!;
    const message = await page.evaluate(
      async ({ channel, messageId }) => {
        const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
        return getState().instances.test.messages[channel].items.find((m: { id: string }) => m.id === messageId);
      },
      { channel: decodeURIComponent(channel!), messageId: decodeURIComponent(messageId!) },
    );
    const add = method === "PUT", content = decodeURIComponent(emoji!);
    fixture.writes.push(method);
    const result = structuredClone(message);
    const reaction = result.reactions?.find((r: { emoji: string }) => r.emoji === content) ?? { emoji: content, userIds: [] as string[] };
    reaction.userIds = add ? [...new Set([...reaction.userIds, "person"])] : reaction.userIds.filter((id: string) => id !== "person");
    result.reactions = [...(result.reactions ?? []).filter((r: { emoji: string }) => r.emoji !== content), ...(reaction.userIds.length ? [reaction] : [])];
    if (fixture.delay) {
      fixture.delay = false;
      await new Promise<void>((resolve) => (fixture.release = resolve));
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
  });
  return fixture;
}

export interface SendFixture {
  sends: { channel: string; content: string; files: string[] }[];
}

/** Records what the composer sends to POST /channels/:id/messages and answers like the server. */
export async function uiSendFixture(app: ElectronApplication): Promise<SendFixture> {
  const page = await app.firstWindow();
  const fixture: SendFixture = { sends: [] };
  await page.route(/\/api\/channels\/[^/]+\/messages$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const channel = decodeURIComponent(/\/api\/channels\/([^/]+)\/messages$/.exec(new URL(route.request().url()).pathname)![1]!);
    const body = route.request().postData() ?? "";
    const json = (() => {
      try {
        return JSON.parse(body) as { content?: string };
      } catch {
        return null;
      }
    })();
    const files = json ? [] : [...body.matchAll(/filename="([^"]+)"/g)].map((m) => m[1]!);
    const content = json?.content ?? /name="content"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? "";
    fixture.sends.push({ channel, content, files });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: `sent-${fixture.sends.length}`, channelId: channel, author: { id: "person", username: "tester", displayName: "Pessoa de teste", avatarUrl: null }, content, attachments: [], replyToId: null, createdAt: new Date().toISOString(), editedAt: null, mentionIds: [], mentionsEveryone: false }),
    });
  });
  return fixture;
}
