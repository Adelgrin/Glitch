import { useEffect } from "react";
import { KnownMembership, type Room, type RoomMember } from "matrix-js-sdk";
import { getClient } from "../matrix/client";
import { useAppStore, useVersion } from "../store/app";
import Avatar from "./Avatar";

type Presence = "online" | "unavailable" | "offline";

/** Lista de membros do servidor (do espaço) ou da conversa, como no Discord. */
export default function MemberList({ room, spaceId }: { room: Room; spaceId: string | null }) {
  useVersion();
  const c = getClient();
  const source = (spaceId && c.getRoom(spaceId)) || room;
  const openModal = useAppStore((s) => s.openModal);

  useEffect(() => {
    source.loadMembersIfNeeded().catch(() => undefined);
  }, [source]);

  const members = source.getMembers().filter((m) => m.membership === KnownMembership.Join);
  const presenceOf = (m: RoomMember): Presence | null => {
    const u = c.getUser(m.userId);
    if (!u || (!u.lastPresenceTs && !u.currentlyActive && u.presence === "offline")) return null;
    return (u.presence as Presence) ?? null;
  };
  const anyPresence = members.some((m) => presenceOf(m) && presenceOf(m) !== "offline");

  const groups: { label: string; list: RoomMember[] }[] = [];
  const admins = members.filter((m) => m.powerLevel >= 100);
  const mods = members.filter((m) => m.powerLevel >= 50 && m.powerLevel < 100);
  const rest = members.filter((m) => m.powerLevel < 50);
  const byName = (a: RoomMember, b: RoomMember) => a.name.localeCompare(b.name);
  if (admins.length) groups.push({ label: "Administradores", list: admins.sort(byName) });
  if (mods.length) groups.push({ label: "Moderadores", list: mods.sort(byName) });
  if (anyPresence) {
    const online = rest.filter((m) => presenceOf(m) && presenceOf(m) !== "offline");
    const offline = rest.filter((m) => !presenceOf(m) || presenceOf(m) === "offline");
    if (online.length) groups.push({ label: "Disponível", list: online.sort(byName) });
    if (offline.length) groups.push({ label: "Offline", list: offline.sort(byName) });
  } else if (rest.length) groups.push({ label: "Membros", list: rest.sort(byName) });

  return (
    <aside className="member-list">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="section-label">
            {g.label} — {g.list.length}
          </div>
          {g.list.map((m) => {
            const p = presenceOf(m);
            const status = c.getUser(m.userId)?.presenceStatusMsg;
            return (
              <div
                key={m.userId}
                className={`member ${anyPresence && (!p || p === "offline") ? "offline" : ""}`}
                onClick={() => openModal({ type: "userProfile", userId: m.userId, roomId: source.roomId })}
              >
                <Avatar mxc={m.getMxcAvatarUrl()} name={m.name} id={m.userId} size={32} status={anyPresence ? (p ?? "offline") : null} />
                <div className="member-names">
                  <span
                    className="ellipsis"
                    style={{ color: m.powerLevel >= 100 ? "var(--admin-color)" : m.powerLevel >= 50 ? "var(--mod-color)" : undefined }}
                  >
                    {m.name}
                  </span>
                  {status && <span className="ellipsis muted tiny">{status}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
