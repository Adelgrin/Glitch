import {
  EventType,
  Preset,
  Visibility,
  KnownMembership,
  type ICreateRoomOpts,
  type MatrixClient,
  type Room,
  type RoomMember,
} from "matrix-js-sdk";
import { getClient } from "./client";

export const VOICE_ROOM_TYPES = ["org.matrix.msc3417.call", "io.element.video"];
export const CALL_MEMBER_EVENT = "org.matrix.msc3401.call.member";
export const BANNER_EVENT = "com.matrixcord.space.banner";
export const SERVER_ORDER_KEY = "mc.serverOrder";

export function isVoiceRoom(room?: Room | null, roomType?: string): boolean {
  const t = roomType ?? room?.getType();
  return !!t && VOICE_ROOM_TYPES.includes(t);
}

export function serverName(c: MatrixClient = getClient()): string {
  return c.getDomain() ?? c.getUserId()!.split(":").slice(1).join(":");
}

export function getJoinedSpaces(): Room[] {
  const c = getClient();
  const spaces = c.getRooms().filter((r) => r.isSpaceRoom() && r.getMyMembership() === KnownMembership.Join);
  // Espaços que são filhos de outro espaço entrado viram categorias, não servidores.
  const childIds = new Set<string>();
  for (const s of spaces) for (const ch of getChildEvents(s)) childIds.add(ch.roomId);
  const top = spaces.filter((s) => !childIds.has(s.roomId));
  const order = getServerOrder();
  return top.sort((a, b) => {
    const ia = order.indexOf(a.roomId);
    const ib = order.indexOf(b.roomId);
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function getServerOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SERVER_ORDER_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function setServerOrder(ids: string[]) {
  localStorage.setItem(SERVER_ORDER_KEY, JSON.stringify(ids));
}

export interface ChildRef {
  roomId: string;
  order?: string;
  ts: number;
}

export function getChildEvents(space: Room): ChildRef[] {
  const evs = space.currentState.getStateEvents(EventType.SpaceChild);
  return evs
    .filter((e) => {
      const via = e.getContent().via;
      return Array.isArray(via) && via.length > 0;
    })
    .map((e) => {
      const order = e.getContent().order;
      return { roomId: e.getStateKey()!, order: typeof order === "string" ? order : undefined, ts: e.getTs() };
    })
    .sort((a, b) => {
      if (a.order && b.order) return a.order < b.order ? -1 : a.order > b.order ? 1 : 0;
      if (a.order) return -1;
      if (b.order) return 1;
      return a.ts - b.ts;
    });
}

/** Todos os ids de salas que pertencem (recursivamente) a algum espaço entrado. */
export function getRoomsInAnySpace(): Set<string> {
  const c = getClient();
  const out = new Set<string>();
  for (const r of c.getRooms()) {
    if (!r.isSpaceRoom() || r.getMyMembership() !== KnownMembership.Join) continue;
    for (const ch of getChildEvents(r)) out.add(ch.roomId);
  }
  return out;
}

export function getDirectRoomIds(): Set<string> {
  const c = getClient();
  const content = c.getAccountData(EventType.Direct)?.getContent() ?? {};
  const ids = new Set<string>();
  for (const list of Object.values(content)) if (Array.isArray(list)) list.forEach((id) => ids.add(id));
  return ids;
}

export function getDmPartner(room: Room): RoomMember | null {
  const me = getClient().getUserId();
  const members = room.getMembers().filter((m) => m.userId !== me);
  return members.length === 1 ? members[0] : (room.getAvatarFallbackMember() ?? null);
}

const VISIBLE_TYPES = new Set(["m.room.message", "m.room.encrypted", "m.sticker"]);

/** Há mensagem de outra pessoa que ainda não lemos? */
export function hasUnread(room: Room): boolean {
  const me = getClient().getUserId()!;
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!VISIBLE_TYPES.has(ev.getType()) || ev.isRelation()) continue;
    if (ev.getSender() === me) return false;
    return !room.hasUserReadEvent(me, ev.getId()!);
  }
  return false;
}

export function roomDisplayName(room: Room): string {
  return room.name || room.getCanonicalAlias() || room.roomId;
}

export function getMyPowerLevel(room: Room): number {
  const me = getClient().getUserId()!;
  return room.getMember(me)?.powerLevel ?? 0;
}

export function canSendState(room: Room, eventType: string): boolean {
  const me = getClient().getUserId()!;
  return room.currentState.maySendStateEvent(eventType, me);
}

function defaultPowerEvents(extra: Record<string, number> = {}) {
  return {
    "m.room.name": 50,
    "m.room.power_levels": 100,
    "m.room.history_visibility": 100,
    "m.room.canonical_alias": 50,
    "m.room.avatar": 50,
    "m.room.tombstone": 100,
    "m.room.server_acl": 100,
    "m.room.encryption": 100,
    "m.room.topic": 50,
    "m.space.child": 50,
    "m.room.pinned_events": 50,
    [BANNER_EVENT]: 50,
    ...extra,
  };
}

export async function createServer(opts: { name: string; isPublic: boolean; avatarUrl?: string; topic?: string }) {
  const c = getClient();
  const initial_state: ICreateRoomOpts["initial_state"] = [
    { type: EventType.RoomHistoryVisibility, state_key: "", content: { history_visibility: opts.isPublic ? "world_readable" : "invited" } },
  ];
  if (opts.avatarUrl) initial_state.push({ type: EventType.RoomAvatar, state_key: "", content: { url: opts.avatarUrl } });
  const { room_id } = await c.createRoom({
    name: opts.name,
    topic: opts.topic,
    preset: opts.isPublic ? Preset.PublicChat : Preset.PrivateChat,
    visibility: opts.isPublic ? Visibility.Public : Visibility.Private,
    creation_content: { type: "m.space" },
    power_level_content_override: {
      events_default: 100,
      invite: opts.isPublic ? 0 : 50,
      events: defaultPowerEvents(),
    },
    initial_state,
  });
  await createChannel({ spaceId: room_id, name: "geral", voice: false, isPublic: opts.isPublic });
  await createChannel({ spaceId: room_id, name: "Geral", voice: true, isPublic: opts.isPublic });
  return room_id;
}

export async function addChild(spaceId: string, childId: string, order?: string) {
  const c = getClient();
  const via = [serverName(c)];
  await c.sendStateEvent(spaceId, EventType.SpaceChild, { via, ...(order ? { order } : {}) }, childId);
}

export async function createChannel(opts: {
  spaceId: string;
  parentId?: string;
  name: string;
  topic?: string;
  voice: boolean;
  isPublic?: boolean;
  encrypted?: boolean;
}) {
  const c = getClient();
  const parent = opts.parentId ?? opts.spaceId;
  const via = [serverName(c)];
  const initial_state: ICreateRoomOpts["initial_state"] = [
    { type: EventType.SpaceParent, state_key: parent, content: { via, canonical: true } },
    { type: EventType.RoomHistoryVisibility, state_key: "", content: { history_visibility: "shared" } },
  ];
  if (!opts.isPublic) {
    initial_state.push({
      type: EventType.RoomJoinRules,
      state_key: "",
      content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: opts.spaceId }] },
    });
  }
  if (opts.encrypted) {
    initial_state.push({ type: EventType.RoomEncryption, state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } });
  }
  const { room_id } = await c.createRoom({
    name: opts.name,
    topic: opts.topic,
    preset: opts.isPublic ? Preset.PublicChat : Preset.PrivateChat,
    visibility: Visibility.Private,
    creation_content: opts.voice ? { type: "org.matrix.msc3417.call" } : undefined,
    power_level_content_override: {
      events: defaultPowerEvents(opts.voice ? { [CALL_MEMBER_EVENT]: 0, "org.matrix.msc3401.call": 100 } : {}),
    },
    initial_state,
  });
  await addChild(parent, room_id);
  return room_id;
}

export async function createCategory(spaceId: string, name: string) {
  const c = getClient();
  const via = [serverName(c)];
  const { room_id } = await c.createRoom({
    name,
    preset: Preset.PrivateChat,
    creation_content: { type: "m.space" },
    power_level_content_override: { events_default: 100, events: defaultPowerEvents() },
    initial_state: [
      { type: EventType.SpaceParent, state_key: spaceId, content: { via, canonical: true } },
      {
        type: EventType.RoomJoinRules,
        state_key: "",
        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] },
      },
    ],
  });
  await addChild(spaceId, room_id);
  return room_id;
}

export async function removeChild(parentId: string, childId: string) {
  await getClient().sendStateEvent(parentId, EventType.SpaceChild, {}, childId);
}

export async function startDm(userId: string): Promise<string> {
  const c = getClient();
  // Reaproveita uma DM existente
  const direct = c.getAccountData(EventType.Direct)?.getContent() ?? {};
  for (const rid of (direct[userId] as string[] | undefined) ?? []) {
    const r = c.getRoom(rid);
    if (r && r.getMyMembership() === KnownMembership.Join) return rid;
  }
  const { room_id } = await c.createRoom({
    is_direct: true,
    invite: [userId],
    preset: Preset.TrustedPrivateChat,
  });
  const next = { ...direct, [userId]: [...((direct[userId] as string[]) ?? []), room_id] };
  await c.setAccountData(EventType.Direct, next);
  return room_id;
}

/** Ordem Unicode simples para posicionar um item entre dois outros. */
export function orderBetween(a?: string, b?: string): string {
  const min = 0x20;
  const max = 0x7e;
  const A = a ?? "";
  const B = b ?? "";
  let out = "";
  for (let i = 0; ; i++) {
    const ca = i < A.length ? A.charCodeAt(i) : min;
    const cb = i < B.length ? B.charCodeAt(i) : max + 1;
    if (cb - ca > 1) return out + String.fromCharCode(Math.floor((ca + cb) / 2));
    out += String.fromCharCode(ca);
    if (out.length > 40) return out;
  }
}
