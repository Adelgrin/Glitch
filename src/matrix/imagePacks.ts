/**
 * Pacotes de emojis e figurinhas personalizados — MSC2545 (o mesmo formato do Cinny,
 * FluffyChat e Nheko):
 *  - pacote pessoal: account data `im.ponies.user_emotes`
 *  - pacotes de sala/servidor: estado `im.ponies.room_emotes` (state_key = id do pacote)
 *  - pacotes de salas usados em qualquer lugar: account data `im.ponies.emote_rooms`
 */
import { EventType, type Room } from "matrix-js-sdk";
import { getClient } from "./client";
import { uploadBlob } from "./media";

export const USER_EMOTES = "im.ponies.user_emotes";
export const ROOM_EMOTES = "im.ponies.room_emotes";
export const EMOTE_ROOMS = "im.ponies.emote_rooms";

export type PackUsage = "emoticon" | "sticker";

export interface ImageInfo {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
}

export interface PackImageContent {
  url: string;
  body?: string;
  info?: ImageInfo;
  usage?: PackUsage[];
}

export interface PackContent {
  pack?: { display_name?: string; avatar_url?: string; usage?: PackUsage[]; attribution?: string };
  images?: Record<string, PackImageContent>;
}

export type PackRef = { kind: "user" } | { kind: "room"; roomId: string; stateKey: string };

export interface PackImage extends PackImageContent {
  shortcode: string;
  /** usos efetivos (da imagem ou herdados do pacote) */
  uses: PackUsage[];
}

export interface Pack {
  id: string;
  ref: PackRef;
  name: string;
  avatar?: string;
  usage: PackUsage[];
  images: PackImage[];
  content: PackContent;
}

const BOTH: PackUsage[] = ["emoticon", "sticker"];

function validUsage(u: unknown): PackUsage[] | undefined {
  if (!Array.isArray(u)) return undefined;
  const out = u.filter((x): x is PackUsage => x === "emoticon" || x === "sticker");
  return out.length ? out : undefined;
}

export function packId(ref: PackRef) {
  return ref.kind === "user" ? "user" : `${ref.roomId}|${ref.stateKey}`;
}

function toPack(ref: PackRef, raw: unknown, fallbackName: string): Pack | null {
  if (!raw || typeof raw !== "object") return null;
  const content = raw as PackContent;
  const usage = validUsage(content.pack?.usage) ?? BOTH;
  const images: PackImage[] = [];
  for (const [shortcode, img] of Object.entries(content.images ?? {})) {
    if (!img || typeof img.url !== "string" || !img.url.startsWith("mxc://")) continue;
    images.push({ ...img, shortcode, uses: validUsage(img.usage) ?? usage });
  }
  return {
    id: packId(ref),
    ref,
    name: content.pack?.display_name || fallbackName,
    avatar: content.pack?.avatar_url || images[0]?.url,
    usage,
    images,
    content,
  };
}

export function getUserPack(): Pack {
  const c = getClient();
  const raw = c.getAccountData(USER_EMOTES as never)?.getContent() ?? { images: {} };
  return toPack({ kind: "user" }, raw, "Pacote pessoal")!;
}

export function getRoomPacks(room: Room): Pack[] {
  const out: Pack[] = [];
  for (const ev of room.currentState.getStateEvents(ROOM_EMOTES)) {
    const stateKey = ev.getStateKey() ?? "";
    const p = toPack({ kind: "room", roomId: room.roomId, stateKey }, ev.getContent(), stateKey || room.name);
    if (p && (p.images.length || p.content.pack)) out.push(p);
  }
  return out;
}

/** Pacotes de salas marcados como "usar em todas as salas". */
export function getGlobalPackRefs(): { roomId: string; stateKey: string }[] {
  const raw = getClient().getAccountData(EMOTE_ROOMS as never)?.getContent() as
    | { rooms?: Record<string, Record<string, object>> }
    | undefined;
  const out: { roomId: string; stateKey: string }[] = [];
  for (const [roomId, keys] of Object.entries(raw?.rooms ?? {})) {
    for (const stateKey of Object.keys(keys ?? {})) out.push({ roomId, stateKey });
  }
  return out;
}

export function isPackGlobal(roomId: string, stateKey: string) {
  return getGlobalPackRefs().some((r) => r.roomId === roomId && r.stateKey === stateKey);
}

export async function setPackGlobal(roomId: string, stateKey: string, enabled: boolean) {
  const c = getClient();
  const raw = (c.getAccountData(EMOTE_ROOMS as never)?.getContent() ?? {}) as { rooms?: Record<string, Record<string, object>> };
  const rooms = { ...(raw.rooms ?? {}) };
  const keys = { ...(rooms[roomId] ?? {}) };
  if (enabled) keys[stateKey] = {};
  else delete keys[stateKey];
  if (Object.keys(keys).length) rooms[roomId] = keys;
  else delete rooms[roomId];
  await c.setAccountData(EMOTE_ROOMS as never, { ...raw, rooms } as never);
}

function parentSpaces(room: Room): Room[] {
  const c = getClient();
  const out: Room[] = [];
  for (const ev of room.currentState.getStateEvents(EventType.SpaceParent)) {
    const r = c.getRoom(ev.getStateKey() ?? "");
    if (r && Object.keys(ev.getContent()).length) out.push(r);
  }
  for (const r of c.getRooms()) {
    if (!r.isSpaceRoom() || r.getMyMembership() !== "join" || out.includes(r)) continue;
    const child = r.currentState.getStateEvents(EventType.SpaceChild, room.roomId);
    if (child && Object.keys(child.getContent()).length) out.push(r);
  }
  return out;
}

/** Pacotes disponíveis numa sala: pessoal, globais, da sala e dos servidores pai. */
export function getAvailablePacks(room: Room | null | undefined): Pack[] {
  const c = getClient();
  const seen = new Set<string>();
  const out: Pack[] = [];
  const add = (p: Pack | null) => {
    if (!p || !p.images.length || seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  add(getUserPack());
  if (room) {
    getRoomPacks(room).forEach(add);
    parentSpaces(room).forEach((s) => getRoomPacks(s).forEach(add));
  }
  for (const ref of getGlobalPackRefs()) {
    const r = c.getRoom(ref.roomId);
    const ev = r?.currentState.getStateEvents(ROOM_EMOTES, ref.stateKey);
    if (r && ev) add(toPack({ kind: "room", ...ref }, ev.getContent(), ref.stateKey || r.name));
  }
  return out;
}

export function packsFor(packs: Pack[], use: PackUsage) {
  return packs
    .map((p) => ({ ...p, images: p.images.filter((i) => i.uses.includes(use)) }))
    .filter((p) => p.images.length);
}

/** Mapa :shortcode: → url dos emojis personalizados disponíveis (o primeiro pacote ganha). */
export function emoticonMap(packs: Pack[]): Map<string, PackImage> {
  const m = new Map<string, PackImage>();
  for (const p of packsFor(packs, "emoticon")) for (const img of p.images) if (!m.has(img.shortcode)) m.set(img.shortcode, img);
  return m;
}

/* ------------------------------------------------------------------ */
/* Edição                                                              */
/* ------------------------------------------------------------------ */

export async function savePack(ref: PackRef, content: PackContent) {
  const c = getClient();
  if (ref.kind === "user") await c.setAccountData(USER_EMOTES as never, content as never);
  else await c.sendStateEvent(ref.roomId, ROOM_EMOTES as never, content as never, ref.stateKey);
}

export function canEditPack(ref: PackRef) {
  if (ref.kind === "user") return true;
  const c = getClient();
  const room = c.getRoom(ref.roomId);
  return !!room?.currentState.maySendStateEvent(ROOM_EMOTES, c.getUserId()!);
}

/** Transforma um nome de arquivo em um shortcode válido e único. */
export function makeShortcode(name: string, taken: Set<string>) {
  const base =
    name
      .replace(/\.[a-z0-9]+$/i, "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "imagem";
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  taken.add(code);
  return code;
}

export function sanitizeShortcode(s: string) {
  return s.replace(/^:+|:+$/g, "").replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 60);
}

function imageSize(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Envia imagens e devolve as entradas prontas para o pacote. */
export async function uploadPackImages(
  files: File[],
  taken: Set<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<[string, PackImageContent][]> {
  const out: [string, PackImageContent][] = [];
  let done = 0;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const [url, size] = await Promise.all([uploadBlob(f, f.name), imageSize(f)]);
    const code = makeShortcode(f.name, taken);
    out.push([code, { url, body: code, info: { mimetype: f.type, size: f.size, ...(size ?? {}) } }]);
    onProgress?.(++done, files.length);
  }
  return out;
}

/** Id para um pacote novo de sala, a partir do nome. */
export function newPackStateKey(room: Room, name: string) {
  const taken = new Set(room.currentState.getStateEvents(ROOM_EMOTES).map((e) => e.getStateKey() ?? ""));
  return makeShortcode(name, taken);
}
