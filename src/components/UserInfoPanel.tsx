import { useEffect, useState } from "react";
import { KnownMembership, type Room } from "matrix-js-sdk";
import { getClient } from "../matrix/client";
import { getJoinedSpaces } from "../matrix/rooms";
import { useAppStore, useVersion } from "../store/app";
import Avatar from "./Avatar";
import ProfileBanner from "./ProfileBanner";
import UserNote from "./UserNote";
import { IconChevronDown, IconChevronRight, IconShieldAlert, IconShieldCheck } from "./icons";

type Presence = "online" | "unavailable" | "offline";

const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Disponível",
  unavailable: "Ausente",
  offline: "Offline",
};

function ago(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/** Painel lateral das mensagens diretas: perfil da outra pessoa, como no Discord. */
export default function UserInfoPanel({ room, userId }: { room: Room; userId: string }) {
  useVersion();
  const c = getClient();
  const openModal = useAppStore((s) => s.openModal);
  const member = room.getMember(userId);
  const user = c.getUser(userId);
  const [profile, setProfile] = useState<{ displayname?: string; avatar_url?: string }>({});
  const [verified, setVerified] = useState<boolean | null>(null);
  const [showServers, setShowServers] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setProfile({});
    c.getProfileInfo(userId)
      .then(setProfile)
      .catch(() => undefined);
    setVerified(null);
    c.getCrypto()
      ?.getUserVerificationStatus(userId)
      .then((s) => setVerified(s.isCrossSigningVerified()))
      .catch(() => setVerified(null));
  }, [c, userId]);

  const name = member?.name ?? user?.displayName ?? profile.displayname ?? userId;
  const avatar = member?.getMxcAvatarUrl() ?? user?.avatarUrl ?? profile.avatar_url;
  const hasPresence = !!user && (!!user.lastPresenceTs || user.currentlyActive || user.presence !== "offline");
  const presence = hasPresence ? ((user?.presence as Presence) ?? "offline") : null;
  const lastActive = user?.lastActiveAgo ? user.lastActiveAgo + (Date.now() - (user.lastPresenceTs || Date.now())) : null;
  const status = user?.presenceStatusMsg;
  const server = userId.split(":").slice(1).join(":");
  const since = member?.events.member?.getTs();

  // Servidores (espaços) em que vocês dois estão
  const mutual = getJoinedSpaces().filter((s) => s.getMember(userId)?.membership === KnownMembership.Join);

  const copyId = () => {
    void navigator.clipboard.writeText(userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside className="member-list user-info">
      <ProfileBanner userId={userId} className="user-info-banner" />
      <div className="user-info-avatar">
        <Avatar
          mxc={avatar}
          name={name}
          id={userId}
          size={80}
          status={presence}
          onClick={() => openModal({ type: "userProfile", userId, roomId: room.roomId })}
        />
      </div>

      <div className="user-info-card">
        <div className="user-info-name">{name}</div>
        <button className="user-info-id" onClick={copyId} title="Copiar ID">
          {copied ? "ID copiado!" : userId}
        </button>
        {status && <div className="user-info-status">{status}</div>}
      </div>

      <div className="user-info-card">
        <UserNote userId={userId} />
      </div>

      <div className="user-info-card">
        {presence && (
          <div className="user-info-row">
            <span className={`user-info-dot ${presence}`} />
            <span>
              {PRESENCE_LABEL[presence]}
              {presence !== "online" && lastActive ? <span className="muted"> · visto {ago(lastActive)}</span> : null}
            </span>
          </div>
        )}
        {verified !== null && (
          <div className={`user-info-row ${verified ? "ok" : ""}`}>
            {verified ? <IconShieldCheck size={16} /> : <IconShieldAlert size={16} />}
            <span>{verified ? "Identidade verificada" : "Identidade não verificada"}</span>
          </div>
        )}
        <div className="user-info-label">Servidor Matrix</div>
        <div className="user-info-value">{server}</div>
        {since && (
          <>
            <div className="user-info-label">Na conversa desde</div>
            <div className="user-info-value">{new Date(since).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</div>
          </>
        )}
      </div>

      <div className="user-info-card">
        <button className="user-info-section" onClick={() => setShowServers((s) => !s)}>
          <span>
            Servidores em comum — {mutual.length}
          </span>
          {showServers ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </button>
        {showServers &&
          (mutual.length ? (
            <div className="user-info-servers">
              {mutual.map((s) => (
                <button
                  key={s.roomId}
                  className="user-info-server"
                  onClick={() => useAppStore.getState().selectSpace(s.roomId)}
                  title={`Abrir ${s.name}`}
                >
                  <Avatar mxc={s.getMxcAvatarUrl()} name={s.name} id={s.roomId} size={28} shape="server" />
                  <span className="ellipsis">{s.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="muted small user-info-empty">Nenhum servidor em comum.</div>
          ))}
      </div>

      <button className="btn secondary small user-info-full" onClick={() => openModal({ type: "userProfile", userId, roomId: room.roomId })}>
        Ver perfil completo
      </button>
    </aside>
  );
}
