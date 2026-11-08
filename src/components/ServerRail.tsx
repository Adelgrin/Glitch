import { useState } from "react";
import { KnownMembership, type Room } from "matrix-js-sdk";
import { getClient } from "../matrix/client";
import { getChildEvents, getJoinedSpaces, getRoomsInAnySpace, setServerOrder } from "../matrix/rooms";
import { useAppStore, useVersion } from "../store/app";
import Avatar from "./Avatar";
import { IconCompass, IconPlus } from "./icons";

function spaceUnread(space: Room): number {
  const c = getClient();
  let n = 0;
  const visit = (r: Room, depth: number) => {
    for (const ch of getChildEvents(r)) {
      const child = c.getRoom(ch.roomId);
      if (!child || child.getMyMembership() !== KnownMembership.Join) continue;
      if (child.isSpaceRoom()) {
        if (depth < 2) visit(child, depth + 1);
      } else n += child.getUnreadNotificationCount() ?? 0;
    }
  };
  visit(space, 0);
  return n;
}

export default function ServerRail() {
  useVersion();
  const selected = useAppStore((s) => s.selectedSpaceId);
  const selectSpace = useAppStore((s) => s.selectSpace);
  const openModal = useAppStore((s) => s.openModal);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const c = getClient();
  const spaces = getJoinedSpaces();
  const invites = c.getRooms().filter((r) => r.getMyMembership() === KnownMembership.Invite);

  const inSpace = getRoomsInAnySpace();
  const homeUnread = c
    .getRooms()
    .filter((r) => !r.isSpaceRoom() && !inSpace.has(r.roomId) && r.getMyMembership() === KnownMembership.Join)
    .reduce((n, r) => n + (r.getUnreadNotificationCount() ?? 0), 0);

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = spaces.map((s) => s.roomId).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setServerOrder(ids);
    useAppStore.getState().bump();
  };

  return (
    <nav className="server-rail">
      <RailItem
        active={selected === null}
        label="Mensagens diretas"
        badge={homeUnread + invites.filter((r) => !r.isSpaceRoom()).length}
        onClick={() => selectSpace(null)}
      >
        <div className="rail-home logo">
          <img src="/icon-192.png?v=2" alt="" draggable={false} />
        </div>
      </RailItem>
      <div className="rail-sep" />
      {spaces.map((s) => (
        <div
          key={s.roomId}
          draggable
          onDragStart={() => setDragId(s.roomId)}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOverId(s.roomId);
          }}
          onDrop={() => drop(s.roomId)}
          className={overId === s.roomId && dragId && dragId !== s.roomId ? "drop-target" : ""}
        >
          <RailItem
            active={selected === s.roomId}
            label={s.name}
            badge={spaceUnread(s)}
            onClick={() => selectSpace(s.roomId)}
          >
            <Avatar mxc={s.getMxcAvatarUrl()} name={s.name} id={s.roomId} size={48} shape="server" />
          </RailItem>
        </div>
      ))}
      {invites
        .filter((r) => r.isSpaceRoom())
        .map((r) => (
          <RailItem key={r.roomId} label={`Convite: ${r.name}`} active={false} badge={1} onClick={() => acceptInvite(r)}>
            <Avatar mxc={r.getMxcAvatarUrl()} name={r.name} id={r.roomId} size={48} shape="server" className="invite" />
          </RailItem>
        ))}
      <RailItem label="Criar um servidor" active={false} onClick={() => openModal({ type: "createServer" })}>
        <div className="rail-action create">
          <IconPlus size={24} />
        </div>
      </RailItem>
      <RailItem label="Entrar em um servidor" active={false} onClick={() => openModal({ type: "joinServer" })}>
        <div className="rail-action join">
          <IconCompass size={24} />
        </div>
      </RailItem>
    </nav>
  );
}

async function acceptInvite(r: Room) {
  if (!confirm(`Aceitar convite para "${r.name}"?`)) {
    if (confirm("Recusar o convite?")) await getClient().leave(r.roomId);
    return;
  }
  await getClient().joinRoom(r.roomId);
  useAppStore.getState().selectSpace(r.roomId);
}

function RailItem({
  active,
  label,
  badge,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  badge?: number;
  onClick(): void;
  children: React.ReactNode;
}) {
  const [tipTop, setTipTop] = useState<number | null>(null);
  return (
    <div
      className={`rail-item ${active ? "active" : ""} ${badge ? "unread" : ""}`}
      onClick={onClick}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTipTop(r.top + r.height / 2);
      }}
      onMouseLeave={() => setTipTop(null)}
    >
      <span className="rail-pill" />
      <div className="rail-icon">{children}</div>
      {!!badge && <span className="badge rail-badge">{badge > 99 ? "99+" : badge}</span>}
      {tipTop !== null && (
        <span className="rail-tooltip" style={{ top: tipTop }}>
          {label}
        </span>
      )}
    </div>
  );
}
