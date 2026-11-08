/** Envio de figurinhas e emojis personalizados (compatível com Cinny/Element). */
import { EventType, type Room } from "matrix-js-sdk";
import { getClient } from "./client";
import type { PackImage } from "./imagePacks";

const EMOTE_RE = /:([\p{L}\p{N}_-]+):/gu;

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Se o texto tem :atalhos: de emojis personalizados, gera o formatted_body com
 * `<img data-mx-emoticon>` (MSC2545). Retorna null quando não há nenhum.
 */
export function emoteFormatting(body: string, emotes: Map<string, PackImage>) {
  let html = "";
  let last = 0;
  let found = false;
  for (const m of body.matchAll(EMOTE_RE)) {
    const img = emotes.get(m[1]);
    if (!img) continue;
    found = true;
    const code = escapeHtml(`:${m[1]}:`);
    html += escapeHtml(body.slice(last, m.index));
    html += `<img data-mx-emoticon src="${escapeHtml(img.url)}" alt="${code}" title="${code}" height="32" />`;
    last = m.index! + m[0].length;
  }
  if (!found) return null;
  html += escapeHtml(body.slice(last));
  return { format: "org.matrix.custom.html", formatted_body: html.replace(/\n/g, "<br />") };
}

export async function sendSticker(room: Room, img: PackImage, replyTo?: string) {
  const info: Record<string, unknown> = { ...(img.info ?? {}) };
  // Figurinhas grandes são exibidas reduzidas pelos outros clientes
  if (typeof info.w === "number" && typeof info.h === "number") {
    const scale = Math.min(1, 256 / Math.max(info.w as number, info.h as number));
    info.w = Math.round((info.w as number) * scale);
    info.h = Math.round((info.h as number) * scale);
  }
  const content: Record<string, unknown> = { body: img.body || img.shortcode, url: img.url, info };
  if (replyTo) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo } };
  await getClient().sendEvent(room.roomId, EventType.Sticker, content as never);
}
