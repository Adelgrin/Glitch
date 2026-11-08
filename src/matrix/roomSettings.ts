/**
 * Helpers para as configurações de sala (equivalentes às do Element):
 * níveis de poder, regras de entrada, notificações por sala.
 */
import {
  ConditionKind,
  EventType,
  PushRuleActionName,
  PushRuleKind,
  TweakName,
  type IPushRule,
  type Room,
} from "matrix-js-sdk";
import { getClient } from "./client";

/* ------------------------------------------------------------------ */
/* Níveis de poder                                                     */
/* ------------------------------------------------------------------ */

export interface PowerLevels {
  users?: Record<string, number>;
  users_default?: number;
  events?: Record<string, number>;
  events_default?: number;
  state_default?: number;
  ban?: number;
  kick?: number;
  redact?: number;
  invite?: number;
  notifications?: { room?: number };
  [k: string]: unknown;
}

export function getPowerLevels(room: Room): PowerLevels {
  return (room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as PowerLevels) ?? {};
}

/** Chave de permissão: campo de topo ("ban"), notificação ("notifications.room") ou evento ("event:m.room.name"). */
export type PermKey = string;

/** Padrões da especificação quando o campo não existe. */
const SPEC_DEFAULTS: Record<string, number> = {
  users_default: 0,
  events_default: 0,
  state_default: 50,
  ban: 50,
  kick: 50,
  redact: 50,
  invite: 0,
  "notifications.room": 50,
};

/** Tipos de evento que são estado (caem em state_default quando não listados). */
const STATE_EVENTS = new Set<string>([
  EventType.RoomName,
  EventType.RoomAvatar,
  EventType.RoomTopic,
  EventType.RoomCanonicalAlias,
  EventType.RoomPowerLevels,
  EventType.RoomHistoryVisibility,
  EventType.RoomEncryption,
  EventType.RoomServerAcl,
  EventType.RoomTombstone,
  EventType.RoomPinnedEvents,
  EventType.RoomJoinRules,
  EventType.RoomGuestAccess,
  EventType.SpaceChild,
  "im.vector.modular.widgets",
  "org.matrix.msc3401.call.member",
  "com.matrixcord.space.banner",
]);

export function effectiveLevel(pl: PowerLevels, key: PermKey): number {
  if (key.startsWith("event:")) {
    const type = key.slice(6);
    const v = pl.events?.[type];
    if (typeof v === "number") return v;
    return STATE_EVENTS.has(type) ? (pl.state_default ?? 50) : (pl.events_default ?? 0);
  }
  if (key === "notifications.room") return pl.notifications?.room ?? 50;
  const v = pl[key];
  return typeof v === "number" ? v : (SPEC_DEFAULTS[key] ?? 0);
}

export function withLevel(pl: PowerLevels, key: PermKey, level: number): PowerLevels {
  const next: PowerLevels = structuredClone(pl);
  if (key.startsWith("event:")) {
    next.events = { ...(next.events ?? {}), [key.slice(6)]: level };
  } else if (key === "notifications.room") {
    next.notifications = { ...(next.notifications ?? {}), room: level };
  } else {
    next[key] = level;
  }
  return next;
}

export function withUserLevel(pl: PowerLevels, userId: string, level: number | null): PowerLevels {
  const next: PowerLevels = structuredClone(pl);
  const users = { ...(next.users ?? {}) };
  if (level === null || level === (next.users_default ?? 0)) delete users[userId];
  else users[userId] = level;
  next.users = users;
  return next;
}

export async function savePowerLevels(roomId: string, pl: PowerLevels) {
  await getClient().sendStateEvent(roomId, EventType.RoomPowerLevels, pl as never, "");
}

export function roleName(level: number) {
  if (level === 100) return "Administrador";
  if (level === 50) return "Moderador";
  if (level === 0) return "Membro";
  return `Personalizado (${level})`;
}

/**
 * Criadores da sala nas versões "hydra" (v12+): têm poder ilimitado e não aparecem
 * na lista de níveis de poder.
 */
export function roomCreators(room: Room): string[] {
  const v = room.getVersion();
  const n = parseInt(v, 10);
  const hydra = v === "org.matrix.hydra.11" || (!Number.isNaN(n) && String(n) === v && n >= 12);
  if (!hydra) return [];
  const create = room.currentState.getStateEvents(EventType.RoomCreate, "");
  if (!create) return [];
  const ids = new Set<string>();
  const sender = create.getSender();
  if (sender) ids.add(sender);
  const extra = create.getContent().additional_creators;
  if (Array.isArray(extra)) extra.forEach((u) => typeof u === "string" && ids.add(u));
  return [...ids];
}

export function myPowerLevel(room: Room): number {
  const me = getClient().getUserId()!;
  if (roomCreators(room).includes(me)) return Infinity;
  const pl = getPowerLevels(room);
  return pl.users?.[me] ?? pl.users_default ?? 0;
}

/* ------------------------------------------------------------------ */
/* Espaços                                                             */
/* ------------------------------------------------------------------ */

/** Espaços dos quais esta sala é filha (m.space.parent) e que conhecemos. */
export function parentSpaceIds(room: Room): string[] {
  const c = getClient();
  const ids = new Set<string>();
  for (const ev of room.currentState.getStateEvents(EventType.SpaceParent)) {
    const k = ev.getStateKey();
    if (k && Object.keys(ev.getContent()).length > 0) ids.add(k);
  }
  // Também espaços que listam a sala como filha
  for (const r of c.getRooms()) {
    if (!r.isSpaceRoom() || r.getMyMembership() !== "join") continue;
    const child = r.currentState.getStateEvents(EventType.SpaceChild, room.roomId);
    if (child && Object.keys(child.getContent()).length > 0) ids.add(r.roomId);
  }
  return [...ids];
}

/** Versões de sala a partir das quais um recurso existe. */
export function roomVersionSupports(room: Room, feature: "knock" | "restricted" | "knock_restricted") {
  const v = parseInt(room.getVersion(), 10);
  if (Number.isNaN(v)) return true; // versões experimentais: deixa o servidor decidir
  if (feature === "knock") return v >= 7;
  if (feature === "restricted") return v >= 8;
  return v >= 10;
}

/* ------------------------------------------------------------------ */
/* Notificações por sala (mesmo modelo do Element)                     */
/* ------------------------------------------------------------------ */

export type RoomNotifState = "default" | "all" | "mentions" | "mute";

function findRule(kind: "override" | "room", roomId: string): IPushRule | undefined {
  return getClient().pushRules?.global?.[kind]?.find((r) => r.rule_id === roomId);
}

function isMuteRule(r: IPushRule | undefined) {
  if (!r || !r.enabled) return false;
  const notifies = r.actions.some((a) => a === PushRuleActionName.Notify);
  return !notifies && (r.conditions?.length ?? 0) === 1;
}

export function getRoomNotifState(roomId: string): RoomNotifState {
  if (isMuteRule(findRule("override", roomId))) return "mute";
  const roomRule = findRule("room", roomId);
  if (!roomRule || !roomRule.enabled) return "default";
  return roomRule.actions.some((a) => a === PushRuleActionName.Notify) ? "all" : "mentions";
}

export async function setRoomNotifState(roomId: string, state: RoomNotifState) {
  const c = getClient();
  const del = async (kind: PushRuleKind) => {
    if (findRule(kind as "override" | "room", roomId)) {
      await c.deletePushRule("global", kind, roomId).catch(() => undefined);
    }
  };
  await del(PushRuleKind.Override);
  await del(PushRuleKind.RoomSpecific);

  if (state === "mute") {
    await c.addPushRule("global", PushRuleKind.Override, roomId, {
      actions: [],
      conditions: [{ kind: ConditionKind.EventMatch, key: "room_id", pattern: roomId }],
    });
  } else if (state === "all") {
    await c.addPushRule("global", PushRuleKind.RoomSpecific, roomId, {
      actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Sound, value: "default" }],
    });
  } else if (state === "mentions") {
    await c.addPushRule("global", PushRuleKind.RoomSpecific, roomId, { actions: [] });
  }
  // Atualiza o cache local sem esperar o sync
  try {
    c.pushRules = await c.getPushRules();
  } catch {
    /* o sync trará as regras novas */
  }
}
