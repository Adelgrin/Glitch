import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EventType, KnownMembership, type Room } from "matrix-js-sdk";
import { getClient } from "../matrix/client";
import { getChildEvents, getDirectRoomIds, getJoinedSpaces, isVoiceRoom, startDm } from "../matrix/rooms";
import { useAppStore, useVersion, type ProfileAnchor } from "../store/app";
import { useSettings } from "../store/settings";
import { setUserVolume, useVoice } from "../voice/voice";
import Avatar from "./Avatar";
import ProfileBanner from "./ProfileBanner";
import Select, { roleOptions } from "./Select";
import { IconAt, IconChat, IconChevronDown, IconChevronRight, IconHash, IconSpeaker, IconX } from "./icons";

type Presence = "online" | "unavailable" | "offline";
const PRESENCE_LABEL: Record<Presence, string> = { online: "Disponível", unavailable: "Ausente", offline: "Offline" };

/** Insere texto na caixa de mensagem aberta (usado por "Mencionar"). */
export function insertIntoComposer(text: string) {
  window.dispatchEvent(new CustomEvent("mc:composer-insert", { detail: text }));
}

function roleOf(level: number): { name: string; color?: string } | null {
  if (level === Infinity) return { name: "Criador", color: "var(--admin-color)" };
  if (level >= 100) return { name: "Administrador", color: "var(--admin-color)" };
  if (level >= 50) return { name: "Moderador", color: "var(--mod-color)" };
  if (level > 0) return { name: `Nível ${level}` };
  return null;
}

/** Salas filhas (recursivo) de um espaço em que estamos. */
function descendants(space: Room): Room[] {
  const c = getClient();
  const out: Room[] = [];
  const seen = new Set<string>([space.roomId]);
  const walk = (s: Room) => {
    for (const ch of getChildEvents(s)) {
      if (seen.has(ch.roomId)) continue;
      seen.add(ch.roomId);
      const r = c.getRoom(ch.roomId);
      if (!r || r.getMyMembership() !== KnownMembership.Join) continue;
      out.push(r);
      if (r.isSpaceRoom()) walk(r);
    }
  };
  walk(space);
  return out;
}

/** Abre uma sala, escolhendo o servidor que a contém. */
function openRoom(roomId: string) {
  const store = useAppStore.getState();
  const c = getClient();
  const room = c.getRoom(roomId);
  if (room?.isSpaceRoom()) return store.selectSpace(roomId);
  const space = getJoinedSpaces().find((s) => descendants(s).some((r) => r.roomId === roomId));
  store.selectSpace(space?.roomId ?? null);
  store.selectRoom(roomId);
}

/**
 * Conteúdo do perfil (cartão ao lado do clique ou modal central).
 * O "contexto" é o servidor aberto (se a pessoa for membro dele) ou a sala de onde veio.
 */
export function UserCard({ userId, roomId, onClose }: { userId: string; roomId?: string; onClose(): void }) {
  useVersion();
  const c = getClient();
  const me = c.getUserId()!;
  const isMe = userId === me;
  const spaceId = useAppStore((s) => s.selectedSpaceId);
  const room = roomId ? c.getRoom(roomId) : null;
  const space = spaceId ? c.getRoom(spaceId) : null;
  const ctx: Room | null = space && space.getMember(userId)?.membership === KnownMembership.Join ? space : room;
  const member = ctx?.getMember(userId) ?? room?.getMember(userId);
  const user = c.getUser(userId);
  const inCall = useVoice((s) => s.participants.some((p) => p.userId === userId && !p.isLocal));
  const volume = useSettings((s) => s.voice.userVolumes[userId] ?? 100);
  const [profile, setProfile] = useState<{ displayname?: string; avatar_url?: string }>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRooms, setShowRooms] = useState(false);

  useEffect(() => {
    c.getProfileInfo(userId)
      .then(setProfile)
      .catch(() => undefined);
  }, [c, userId]);

  const flash = (t: string) => {
    setMsg(t);
    window.setTimeout(() => setMsg((m) => (m === t ? "" : m)), 2500);
  };

  const name = member?.name ?? user?.displayName ?? profile.displayname ?? userId;
  const avatar = member?.getMxcAvatarUrl() ?? user?.avatarUrl ?? profile.avatar_url;
  const hasPresence = !!user && (!!user.lastPresenceTs || user.currentlyActive || user.presence !== "offline");
  const presence = hasPresence ? ((user?.presence as Presence) ?? "offline") : null;
  const level = member?.powerLevel ?? 0;
  const role = roleOf(level);
  const since = member?.membership === KnownMembership.Join ? member.events.member?.getTs() : undefined;

  // Permissões no contexto (servidor ou sala)
  const myLevel = ctx?.getMember(me)?.powerLevel ?? 0;
  const canPl = !!ctx && ctx.currentState.maySendStateEvent(EventType.RoomPowerLevels, me) && (isMe || level < myLevel) && level !== Infinity;
  const plContent = ctx?.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ?? {};
  const kickLevel = (plContent.kick as number) ?? 50;
  const banLevel = (plContent.ban as number) ?? 50;
  const canKick = !!ctx && !isMe && myLevel >= kickLevel && level < myLevel && member?.membership === KnownMembership.Join;
  const canBan = !!ctx && !isMe && myLevel >= banLevel && level < myLevel;
  const ctxRooms = ctx ? (ctx.isSpaceRoom() ? [ctx, ...descendants(ctx)] : [ctx]) : [];
  const ctxLabel = ctx?.isSpaceRoom() ? "do servidor" : "da sala";

  // Em comum
  const directIds = getDirectRoomIds();
  const joined = c.getRooms().filter((r) => r.getMyMembership() === KnownMembership.Join && r.getMember(userId)?.membership === KnownMembership.Join);
  const mutualServers = isMe ? [] : getJoinedSpaces().filter((s) => joined.includes(s));
  const mutualRooms = isMe ? [] : joined.filter((r) => !r.isSpaceRoom() && !directIds.has(r.roomId));
  const ignored = c.getIgnoredUsers().includes(userId);

  /* ------------------------------ ações ------------------------------ */

  const message = async () => {
    setBusy(true);
    try {
      const rid = await startDm(userId);
      useAppStore.getState().selectSpace(null);
      useAppStore.getState().selectRoom(rid);
      onClose();
    } catch (e) {
      flash("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = `https://matrix.to/#/${userId}`;
    try {
      if (navigator.share) await navigator.share({ title: name, url });
      else {
        await navigator.clipboard.writeText(url);
        flash("Link do perfil copiado!");
      }
    } catch {
      /* compartilhamento cancelado */
    }
  };

  const copyId = async () => {
    await navigator.clipboard.writeText(userId).catch(() => undefined);
    flash("ID copiado!");
  };

  const mention = () => {
    insertIntoComposer(`${userId} `);
    onClose();
  };

  /** Aplica no servidor e em todos os canais dele em que você pode mudar cargos. */
  const changeRole = async (newLevel: number) => {
    if (isMe && newLevel < level && !confirm("Você vai reduzir o seu próprio cargo e não poderá desfazer isso sozinho. Continuar?")) return;
    setBusy(true);
    let ok = 0;
    let skipped = 0;
    for (const r of ctxRooms) {
      const theirs = r.getMember(userId)?.powerLevel ?? 0;
      const mine = r.getMember(me)?.powerLevel ?? 0;
      if (!r.currentState.maySendStateEvent(EventType.RoomPowerLevels, me) || theirs === Infinity || (!isMe && theirs >= mine) || newLevel > mine) {
        skipped++;
        continue;
      }
      try {
        await c.setPowerLevel(r.roomId, userId, newLevel);
        ok++;
      } catch {
        skipped++;
      }
    }
    setBusy(false);
    flash(ok ? `Cargo atualizado em ${ok} ${ok === 1 ? "sala" : "salas"}${skipped ? ` (${skipped} sem permissão)` : ""}.` : "Sem permissão para mudar o cargo.");
  };

  const moderate = async (kind: "kick" | "ban") => {
    const verb = kind === "kick" ? "Expulsar" : "Banir";
    const reason = prompt(`${verb} ${name} ${ctxLabel}? Motivo (opcional):`, "");
    if (reason === null) return;
    setBusy(true);
    let ok = 0;
    for (const r of [...ctxRooms].reverse()) {
      const theirs = r.getMember(userId);
      if (kind === "kick" && theirs?.membership !== KnownMembership.Join) continue;
      try {
        if (kind === "kick") await c.kick(r.roomId, userId, reason || undefined);
        else await c.ban(r.roomId, userId, reason || undefined);
        ok++;
      } catch {
        /* sem permissão nessa sala */
      }
    }
    setBusy(false);
    if (ok) onClose();
    else flash("Não foi possível.");
  };

  const toggleIgnore = async () => {
    const list = c.getIgnoredUsers();
    if (!ignored && !confirm(`Ignorar ${name}? Você deixará de ver as mensagens e convites dessa pessoa.`)) return;
    await c.setIgnoredUsers(ignored ? list.filter((u) => u !== userId) : [...list, userId]).catch((e) => flash(String(e.message ?? e)));
    flash(ignored ? "Você não está mais ignorando." : "Usuário ignorado.");
  };

  return (
    <div className="user-card">
      <ProfileBanner userId={userId} className="user-card-banner" />
      <div className="user-card-top">
        <div className="user-card-avatar">
          <Avatar mxc={avatar} name={name} id={userId} size={80} status={presence} />
        </div>
        {!isMe && (
          <div className="user-card-quick">
            <button className="icon-btn" title="Enviar mensagem" disabled={busy} onClick={() => void message()}>
              <IconChat size={18} />
            </button>
            <button className="icon-btn" title="Mencionar" onClick={mention}>
              <IconAt size={18} />
            </button>
            <button className="icon-btn" title="Compartilhar perfil" onClick={() => void share()}>
              <ShareIcon />
            </button>
          </div>
        )}
      </div>

      <div className="user-card-body">
        <div className="user-card-name">{name}</div>
        <button className="user-card-id" title="Copiar ID" onClick={() => void copyId()}>
          {userId}
        </button>
        {(role || presence) && (
          <div className="user-card-chips">
            {presence && (
              <span className="chip">
                <span className={`user-info-dot ${presence}`} /> {PRESENCE_LABEL[presence]}
              </span>
            )}
            {role && (
              <span className="chip">
                <span className="role-dot" style={{ background: role.color ?? "var(--muted)" }} /> {role.name}
              </span>
            )}
          </div>
        )}
        {user?.presenceStatusMsg && <div className="user-card-status">{user.presenceStatusMsg}</div>}

        {since && (
          <div className="user-card-field">
            <div className="user-info-label">Membro {ctxLabel} desde</div>
            <div className="user-info-value">{new Date(since).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
        )}

        {canPl && (
          <div className="user-card-field">
            <div className="user-info-label">Cargo {ctxLabel}</div>
            <Select
              className="user-card-select"
              value={level}
              options={roleOptions(level, myLevel)}
              disabled={busy}
              aria-label="Cargo"
              onChange={(v) => {
                if (v === "custom") {
                  const n = parseInt(prompt("Nível de poder (número):", String(level)) ?? "", 10);
                  if (!Number.isNaN(n)) void changeRole(n);
                  return;
                }
                void changeRole(v);
              }}
            />
            {ctx?.isSpaceRoom() && <div className="muted tiny">Aplica no servidor e em todos os canais dele.</div>}
          </div>
        )}

        {inCall && (
          <div className="user-card-field">
            <div className="user-info-label">Volume — {volume}%</div>
            <input type="range" min={0} max={200} value={volume} onChange={(e) => setUserVolume(userId, Number(e.target.value))} />
          </div>
        )}

        {!isMe && (
          <div className="user-card-field">
            <button className="user-info-section" onClick={() => setShowRooms((s) => !s)}>
              <span>
                Em comum — {mutualServers.length} {mutualServers.length === 1 ? "servidor" : "servidores"}, {mutualRooms.length}{" "}
                {mutualRooms.length === 1 ? "sala" : "salas"}
              </span>
              {showRooms ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </button>
            {showRooms && (
              <div className="user-card-mutual">
                {mutualServers.map((s) => (
                  <button key={s.roomId} className="user-info-server" onClick={() => (openRoom(s.roomId), onClose())}>
                    <Avatar mxc={s.getMxcAvatarUrl()} name={s.name} id={s.roomId} size={24} shape="server" />
                    <span className="ellipsis">{s.name}</span>
                  </button>
                ))}
                {mutualRooms.map((r) => (
                  <button key={r.roomId} className="user-info-server" onClick={() => (openRoom(r.roomId), onClose())}>
                    <span className="user-card-room-icon">{isVoiceRoom(r) ? <IconSpeaker size={16} /> : <IconHash size={16} />}</span>
                    <span className="ellipsis">{r.name}</span>
                  </button>
                ))}
                {!mutualServers.length && !mutualRooms.length && <div className="muted small">Nada em comum além desta conversa.</div>}
              </div>
            )}
          </div>
        )}

        {msg && <div className="user-card-msg">{msg}</div>}

        {!isMe && (
          <div className="user-card-actions">
            <button className="btn primary small grow" disabled={busy} onClick={() => void message()}>
              Enviar mensagem
            </button>
            <button className="btn secondary small" onClick={() => void copyId()}>
              Copiar ID
            </button>
          </div>
        )}

        {!isMe && (
          <div className="user-card-danger">
            {canKick && (
              <button className="dropdown-item danger" disabled={busy} onClick={() => void moderate("kick")}>
                Expulsar {ctxLabel}
              </button>
            )}
            {canBan && (
              <button className="dropdown-item danger" disabled={busy} onClick={() => void moderate("ban")}>
                Banir {ctxLabel}
              </button>
            )}
            <button className="dropdown-item" onClick={() => void toggleIgnore()}>
              {ignored ? "Deixar de ignorar" : "Ignorar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

/** Cartão flutuante ao lado de onde a pessoa foi clicada (como no Cinny/Discord). */
export function UserPopout({ userId, roomId, anchor, onClose }: { userId: string; roomId?: string; anchor: ProfileAnchor; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const WIDTH = 340;

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = Math.min(el?.offsetHeight ?? 400, vh - 16);
      // À direita do clique; se não couber, à esquerda (lista de membros fica na direita)
      let left = anchor.x + anchor.w + 10;
      if (left + WIDTH > vw - 8) left = anchor.x - WIDTH - 10;
      if (left < 8) left = Math.min(Math.max(8, anchor.x), vw - WIDTH - 8);
      let top = anchor.y;
      if (top + h > vh - 8) top = vh - h - 8;
      setPos({ left, top: Math.max(8, top) });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element;
      // A lista do seletor de cargo abre fora do cartão (portal)
      if (ref.current?.contains(t) || t.closest?.(".select-menu")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".select-menu") && onClose();
    // adia para não fechar com o próprio clique que abriu
    const t = window.setTimeout(() => document.addEventListener("mousedown", down));
    document.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="user-popout"
      style={{ width: WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <button className="icon-btn tiny user-popout-close" title="Fechar" onClick={onClose}>
        <IconX size={16} />
      </button>
      <UserCard userId={userId} roomId={roomId} onClose={onClose} />
    </div>
  );
}
