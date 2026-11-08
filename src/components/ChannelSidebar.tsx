import { useEffect, useMemo, useRef, useState } from "react";
import { KnownMembership, NotificationCountType, type Room } from "matrix-js-sdk";
import { getClient } from "../matrix/client";
import {
  hasUnread,
  BANNER_EVENT,
  canSendState,
  getChildEvents,
  getDirectRoomIds,
  getDmPartner,
  getRoomsInAnySpace,
  isVoiceRoom,
  roomDisplayName,
} from "../matrix/rooms";
import { useMxc } from "../matrix/media";
import { anchorOf, useAppStore, useVersion } from "../store/app";
import { joinVoice, useVoice } from "../voice/voice";
import { useRtcMembers } from "../voice/useRtcMembers";
import Avatar from "./Avatar";
import UserPanel from "./UserPanel";
import VoiceConnectedPanel from "./VoiceConnectedPanel";
import {
  IconChevronDown,
  IconChevronRight,
  IconHash,
  IconHeadphonesOff,
  IconMicOff,
  IconPlus,
  IconSettings,
  IconSpeaker,
  IconUserPlus,
  IconVideo,
  IconX,
  IconFolder,
  IconLogout,
} from "./icons";

export default function ChannelSidebar() {
  useVersion();
  const spaceId = useAppStore((s) => s.selectedSpaceId);
  const space = spaceId ? getClient().getRoom(spaceId) : null;
  return (
    <aside className="channel-sidebar">
      {space ? <SpaceChannels space={space} /> : <HomeChannels />}
      <VoiceConnectedPanel />
      <UserPanel />
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Hierarquia (para canais que ainda não entramos)                     */
/* ------------------------------------------------------------------ */

interface HierarchyInfo {
  name?: string;
  room_type?: string;
  avatar_url?: string;
  topic?: string;
}

function useHierarchy(space: Room) {
  const [info, setInfo] = useState<Record<string, HierarchyInfo>>({});
  const childKey = getChildEvents(space)
    .map((c) => c.roomId)
    .join(",");
  useEffect(() => {
    let alive = true;
    getClient()
      .getRoomHierarchy(space.roomId, 200, 2)
      .then((res) => {
        if (!alive) return;
        const map: Record<string, HierarchyInfo> = {};
        for (const r of res.rooms) map[r.room_id] = r as HierarchyInfo;
        setInfo(map);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [space.roomId, childKey]);
  return info;
}

/* ------------------------------------------------------------------ */
/* Servidor (espaço)                                                   */
/* ------------------------------------------------------------------ */

function SpaceChannels({ space }: { space: Room }) {
  const c = getClient();
  const openModal = useAppStore((s) => s.openModal);
  const collapsed = useAppStore((s) => s.collapsedCategories);
  const toggleCategory = useAppStore((s) => s.toggleCategory);
  const hierarchy = useHierarchy(space);
  const [menu, setMenu] = useState(false);
  const bannerMxc = space.currentState.getStateEvents(BANNER_EVENT, "")?.getContent()?.url as string | undefined;
  const banner = useMxc(bannerMxc, undefined);
  const canManage = canSendState(space, "m.space.child");

  const children = getChildEvents(space);
  const loose: string[] = [];
  const categories: { id: string; name: string; children: string[] }[] = [];
  for (const ch of children) {
    const r = c.getRoom(ch.roomId);
    const isSpace = r ? r.isSpaceRoom() : hierarchy[ch.roomId]?.room_type === "m.space";
    if (isSpace) {
      categories.push({
        id: ch.roomId,
        name: r?.name || hierarchy[ch.roomId]?.name || "Categoria",
        children: r ? getChildEvents(r).map((x) => x.roomId) : [],
      });
    } else loose.push(ch.roomId);
  }
  const typeOf = (id: string) => {
    const r = c.getRoom(id);
    return isVoiceRoom(r, r ? undefined : hierarchy[id]?.room_type) ? "voice" : "text";
  };
  const looseText = loose.filter((id) => typeOf(id) === "text");
  const looseVoice = loose.filter((id) => typeOf(id) === "voice");

  const renderChannel = (id: string, parentId: string) =>
    typeOf(id) === "voice" ? (
      <VoiceChannelItem key={id} roomId={id} spaceId={space.roomId} info={hierarchy[id]} />
    ) : (
      <TextChannelItem key={id} roomId={id} spaceId={space.roomId} parentId={parentId} info={hierarchy[id]} />
    );

  return (
    <>
      <header className={`sidebar-header server-header ${banner ? "with-banner" : ""}`} onClick={() => setMenu((m) => !m)}>
        {banner && <img className="server-banner" src={banner} alt="" />}
        <div className="server-header-row">
          <span className="ellipsis">{space.name}</span>
          {menu ? <IconX size={18} /> : <IconChevronDown size={18} />}
        </div>
      </header>
      {menu && (
        <ServerMenu
          space={space}
          canManage={canManage}
          onClose={() => setMenu(false)}
          onAction={(a) => {
            setMenu(false);
            if (a === "invite") openModal({ type: "invite", roomId: space.roomId });
            if (a === "settings") openModal({ type: "serverSettings", spaceId: space.roomId });
            if (a === "text") openModal({ type: "createChannel", spaceId: space.roomId });
            if (a === "voice") openModal({ type: "createChannel", spaceId: space.roomId, voice: true });
            if (a === "category") openModal({ type: "createCategory", spaceId: space.roomId });
            if (a === "leave") leaveServer(space);
          }}
        />
      )}
      <div className="channel-list">
        {looseText.length > 0 && (
          <CategoryHeader
            label="Canais de texto"
            collapsed={!!collapsed[space.roomId + ":text"]}
            onToggle={() => toggleCategory(space.roomId + ":text")}
            onAdd={canManage ? () => openModal({ type: "createChannel", spaceId: space.roomId }) : undefined}
          />
        )}
        {!collapsed[space.roomId + ":text"] && looseText.map((id) => renderChannel(id, space.roomId))}
        {looseVoice.length > 0 && (
          <CategoryHeader
            label="Canais de voz"
            collapsed={!!collapsed[space.roomId + ":voice"]}
            onToggle={() => toggleCategory(space.roomId + ":voice")}
            onAdd={canManage ? () => openModal({ type: "createChannel", spaceId: space.roomId, voice: true }) : undefined}
          />
        )}
        {!collapsed[space.roomId + ":voice"] && looseVoice.map((id) => renderChannel(id, space.roomId))}
        {categories.map((cat) => {
          const joined = c.getRoom(cat.id)?.getMyMembership() === KnownMembership.Join;
          return (
            <div key={cat.id}>
              <CategoryHeader
                label={cat.name}
                collapsed={!!collapsed[cat.id]}
                onToggle={() => {
                  if (!joined) void c.joinRoom(cat.id).catch((e) => alert(e.message));
                  toggleCategory(cat.id);
                }}
                onAdd={
                  canManage && joined
                    ? () => openModal({ type: "createChannel", spaceId: space.roomId, parentId: cat.id })
                    : undefined
                }
              />
              {!collapsed[cat.id] && cat.children.map((id) => renderChannel(id, cat.id))}
            </div>
          );
        })}
        {children.length === 0 && <p className="muted small pad">Nenhum canal ainda.</p>}
      </div>
    </>
  );
}

async function leaveServer(space: Room) {
  if (!confirm(`Sair do servidor "${space.name}"?`)) return;
  const c = getClient();
  for (const ch of getChildEvents(space)) {
    const r = c.getRoom(ch.roomId);
    if (r?.getMyMembership() === KnownMembership.Join) await c.leave(ch.roomId).catch(() => undefined);
  }
  await c.leave(space.roomId);
  useAppStore.getState().selectSpace(null);
}

function ServerMenu({
  space,
  canManage,
  onAction,
  onClose,
}: {
  space: Room;
  canManage: boolean;
  onAction(a: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".server-header"))
        onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  void space;
  return (
    <div className="dropdown server-menu" ref={ref}>
      <button className="dropdown-item accent" onClick={() => onAction("invite")}>
        Convidar pessoas <IconUserPlus size={16} />
      </button>
      <button className="dropdown-item" onClick={() => onAction("settings")}>
        Configurações do servidor <IconSettings size={16} />
      </button>
      {canManage && (
        <>
          <button className="dropdown-item" onClick={() => onAction("text")}>
            Criar canal de texto <IconHash size={16} />
          </button>
          <button className="dropdown-item" onClick={() => onAction("voice")}>
            Criar canal de voz <IconSpeaker size={16} />
          </button>
          <button className="dropdown-item" onClick={() => onAction("category")}>
            Criar categoria <IconFolder size={16} />
          </button>
        </>
      )}
      <div className="dropdown-sep" />
      <button className="dropdown-item danger" onClick={() => onAction("leave")}>
        Sair do servidor <IconLogout size={16} />
      </button>
    </div>
  );
}

function CategoryHeader({
  label,
  collapsed,
  onToggle,
  onAdd,
}: {
  label: string;
  collapsed: boolean;
  onToggle(): void;
  onAdd?: () => void;
}) {
  return (
    <div className="category-header" onClick={onToggle}>
      {collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
      <span className="ellipsis">{label}</span>
      {onAdd && (
        <button
          className="icon-btn tiny"
          title="Criar canal"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <IconPlus size={16} />
        </button>
      )}
    </div>
  );
}

async function openChannel(roomId: string) {
  const c = getClient();
  const r = c.getRoom(roomId);
  if (!r || r.getMyMembership() !== KnownMembership.Join) {
    try {
      await c.joinRoom(roomId);
    } catch (e) {
      alert("Não foi possível entrar no canal: " + (e instanceof Error ? e.message : e));
      return;
    }
  }
  useAppStore.getState().selectRoom(roomId);
}

function TextChannelItem({
  roomId,
  spaceId,
  parentId,
  info,
}: {
  roomId: string;
  spaceId: string;
  parentId: string;
  info?: HierarchyInfo;
}) {
  const c = getClient();
  const room = c.getRoom(roomId);
  const selected = useAppStore((s) => s.selectedRooms[spaceId] === roomId);
  const openModal = useAppStore((s) => s.openModal);
  const joined = room?.getMyMembership() === KnownMembership.Join;
  const name = room ? roomDisplayName(room) : (info?.name ?? "canal");
  const unread = joined && hasUnread(room!);
  const mentions = joined ? (room!.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0) : 0;
  void parentId;
  return (
    <div
      className={`channel-item ${selected ? "selected" : ""} ${unread ? "unread" : ""} ${joined ? "" : "not-joined"}`}
      onClick={() => openChannel(roomId)}
    >
      <IconHash size={18} className="channel-icon" />
      <span className="ellipsis">{name}</span>
      {mentions > 0 && <span className="badge">{mentions}</span>}
      {joined && (
        <span className="channel-actions">
          <button
            className="icon-btn tiny"
            title="Convidar"
            onClick={(e) => {
              e.stopPropagation();
              openModal({ type: "invite", roomId: spaceId });
            }}
          >
            <IconUserPlus size={14} />
          </button>
          <button
            className="icon-btn tiny"
            title="Editar canal"
            onClick={(e) => {
              e.stopPropagation();
              openModal({ type: "channelSettings", roomId, spaceId });
            }}
          >
            <IconSettings size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

function VoiceChannelItem({ roomId, spaceId, info }: { roomId: string; spaceId: string; info?: HierarchyInfo }) {
  const c = getClient();
  const room = c.getRoom(roomId);
  const joined = room?.getMyMembership() === KnownMembership.Join;
  const members = useRtcMembers(joined ? room : null);
  const selected = useAppStore((s) => s.selectedRooms[spaceId] === roomId);
  const openModal = useAppStore((s) => s.openModal);
  const voiceRoomId = useVoice((s) => s.roomId);
  const participants = useVoice((s) => s.participants);
  const connectedHere = voiceRoomId === roomId;
  const name = room ? roomDisplayName(room) : (info?.name ?? "voz");

  // Quando estamos conectados, mostramos também quem está no LiveKit (mais atual).
  const speaking = new Set(participants.filter((p) => p.speaking).map((p) => p.userId));
  const list = useMemo(() => {
    const ids = new Map(members.map((m) => [m.userId, m]));
    if (connectedHere) {
      for (const p of participants) {
        if (!ids.has(p.userId)) {
          ids.set(p.userId, {
            userId: p.userId,
            deviceId: "",
            muted: p.micMuted,
            deafened: false,
            video: !!p.camera,
            streaming: !!p.screen,
          });
        }
      }
    }
    return [...ids.values()];
  }, [members, participants, connectedHere]);

  const onClick = async () => {
    await openChannel(roomId);
    void joinVoice(roomId);
  };

  return (
    <div className="voice-channel">
      <div
        className={`channel-item ${selected ? "selected" : ""} ${joined ? "" : "not-joined"} ${connectedHere ? "connected" : ""}`}
        onClick={onClick}
      >
        <IconSpeaker size={18} className="channel-icon" />
        <span className="ellipsis">{name}</span>
        {joined && (
          <span className="channel-actions">
            <button
              className="icon-btn tiny"
              title="Editar canal"
              onClick={(e) => {
                e.stopPropagation();
                openModal({ type: "channelSettings", roomId, spaceId });
              }}
            >
              <IconSettings size={14} />
            </button>
          </span>
        )}
      </div>
      {list.length > 0 && (
        <div className="voice-members">
          {list.map((m) => {
            const member = room?.getMember(m.userId);
            const live = connectedHere ? participants.find((p) => p.userId === m.userId) : undefined;
            const muted = live ? live.micMuted : m.muted;
            const displayName = member?.name ?? c.getUser(m.userId)?.displayName ?? m.userId;
            return (
              <div
                key={m.userId}
                className="voice-member"
                onClick={(e) => openModal({ type: "userProfile", userId: m.userId, roomId, anchor: anchorOf(e.currentTarget) })}
              >
                <Avatar
                  mxc={member?.getMxcAvatarUrl() ?? c.getUser(m.userId)?.avatarUrl}
                  name={displayName}
                  id={m.userId}
                  size={24}
                  speaking={speaking.has(m.userId)}
                />
                <span className="ellipsis">{displayName}</span>
                <span className="voice-member-icons">
                  {(m.streaming || live?.screen) && <span className="live-badge">AO VIVO</span>}
                  {(m.video || live?.camera) && <IconVideo size={14} />}
                  {m.deafened ? <IconHeadphonesOff size={14} className="danger" /> : muted && <IconMicOff size={14} className="danger" />}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Início: DMs e salas fora de servidores                              */
/* ------------------------------------------------------------------ */

function HomeChannels() {
  const c = getClient();
  const openModal = useAppStore((s) => s.openModal);
  const selected = useAppStore((s) => s.selectedRooms["home"]);
  const selectRoom = useAppStore((s) => s.selectRoom);
  const [filter, setFilter] = useState("");
  const inSpace = getRoomsInAnySpace();
  const direct = getDirectRoomIds();
  const rooms = c
    .getRooms()
    .filter((r) => !r.isSpaceRoom() && !inSpace.has(r.roomId))
    .filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
  const invites = rooms.filter((r) => r.getMyMembership() === KnownMembership.Invite);
  const joined = rooms
    .filter((r) => r.getMyMembership() === KnownMembership.Join)
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
  const dms = joined.filter((r) => direct.has(r.roomId));
  const others = joined.filter((r) => !direct.has(r.roomId));

  const item = (r: Room) => {
    const partner = direct.has(r.roomId) ? getDmPartner(r) : null;
    const presence = partner ? c.getUser(partner.userId)?.presence : undefined;
    const unread = r.getUnreadNotificationCount() ?? 0;
    return (
      <div
        key={r.roomId}
        className={`dm-item ${selected === r.roomId ? "selected" : ""} ${unread ? "unread" : ""}`}
        onClick={() => selectRoom(r.roomId)}
      >
        <Avatar
          mxc={r.getMxcAvatarUrl() ?? partner?.getMxcAvatarUrl()}
          name={r.name}
          id={partner?.userId ?? r.roomId}
          size={32}
          status={partner ? ((presence as "online" | "unavailable" | "offline") ?? null) : null}
        />
        <span className="ellipsis">{r.name}</span>
        {unread > 0 && <span className="badge">{unread}</span>}
        <button
          className="icon-btn tiny dm-close"
          title="Sair da conversa"
          onClick={async (e) => {
            e.stopPropagation();
            if (confirm(`Sair de "${r.name}"?`)) await c.leave(r.roomId);
          }}
        >
          <IconX size={14} />
        </button>
      </div>
    );
  };

  return (
    <>
      <header className="sidebar-header">
        <input
          className="search-input"
          placeholder="Encontrar uma conversa"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>
      <div className="channel-list">
        {invites.length > 0 && <div className="section-label">Convites — {invites.length}</div>}
        {invites.map((r) => (
          <div key={r.roomId} className="dm-item invite">
            <Avatar mxc={r.getMxcAvatarUrl()} name={r.name} id={r.roomId} size={32} />
            <span className="ellipsis">{r.name}</span>
            <button
              className="btn tiny primary"
              onClick={async () => {
                await c.joinRoom(r.roomId);
                selectRoom(r.roomId);
              }}
            >
              Aceitar
            </button>
            <button className="icon-btn tiny" title="Recusar" onClick={() => c.leave(r.roomId)}>
              <IconX size={14} />
            </button>
          </div>
        ))}
        <div className="section-label with-action">
          Mensagens diretas
          <button className="icon-btn tiny" title="Nova mensagem direta" onClick={() => openModal({ type: "startDm" })}>
            <IconPlus size={16} />
          </button>
        </div>
        {dms.map(item)}
        {dms.length === 0 && <p className="muted small pad">Nenhuma conversa ainda.</p>}
        {others.length > 0 && <div className="section-label">Salas</div>}
        {others.map(item)}
      </div>
    </>
  );
}
