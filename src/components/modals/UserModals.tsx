import { useEffect, useState } from "react";
import { getClient } from "../../matrix/client";
import { startDm } from "../../matrix/rooms";
import { useAppStore } from "../../store/app";
import { useSettings } from "../../store/settings";
import { setUserVolume, useVoice } from "../../voice/voice";
import Avatar, { colorFor } from "../Avatar";
import { Modal } from "./Modal";

function normalizeUserId(input: string) {
  let s = input.trim();
  if (!s) return s;
  if (!s.startsWith("@")) s = "@" + s;
  if (!s.includes(":")) s += ":" + getClient().getDomain();
  return s;
}

interface SearchResult {
  user_id: string;
  display_name?: string;
  avatar_url?: string;
}

function useUserSearch(term: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      getClient()
        .searchUserDirectory({ term: term.trim(), limit: 8 })
        .then((r) => setResults(r.results))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [term]);
  return results;
}

function UserPickerList({ term, onPick }: { term: string; onPick(id: string): void }) {
  const results = useUserSearch(term);
  return (
    <div className="user-results">
      {results.map((r) => (
        <div key={r.user_id} className="user-result" onClick={() => onPick(r.user_id)}>
          <Avatar mxc={r.avatar_url} name={r.display_name ?? r.user_id} id={r.user_id} size={32} />
          <div className="grow ellipsis">
            <div className="ellipsis">{r.display_name ?? r.user_id}</div>
            <div className="muted tiny ellipsis">{r.user_id}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function InviteModal({ onClose, roomId }: { onClose(): void; roomId: string }) {
  const c = getClient();
  const room = c.getRoom(roomId);
  const [user, setUser] = useState("");
  const [msg, setMsg] = useState("");
  const alias = room?.getCanonicalAlias();
  const link = `https://matrix.to/#/${encodeURIComponent(alias ?? roomId)}`;

  const invite = async (id: string) => {
    setMsg("");
    try {
      const uid = normalizeUserId(id);
      await c.invite(roomId, uid);
      setMsg(`Convite enviado para ${uid}!`);
      setUser("");
    } catch (e) {
      setMsg("Erro: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <Modal title={`Convidar amigos para ${room?.name ?? "o servidor"}`} onClose={onClose}>
      <label className="field">
        <span>Usuário Matrix</span>
        <div className="row gap">
          <input
            className="grow"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="@amigo:matrix.org"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && user.trim() && invite(user)}
          />
          <button className="btn primary small" disabled={!user.trim()} onClick={() => invite(user)}>
            Convidar
          </button>
        </div>
      </label>
      <UserPickerList term={user} onPick={invite} />
      {msg && <p className="small">{msg}</p>}
      <div className="divider" />
      <label className="field">
        <span>Ou envie o link do servidor</span>
        <div className="row gap">
          <input readOnly value={link} className="grow" />
          <button className="btn secondary small" onClick={() => navigator.clipboard.writeText(link)}>
            Copiar
          </button>
        </div>
      </label>
    </Modal>
  );
}

export function StartDmModal({ onClose }: { onClose(): void }) {
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const roomId = await startDm(normalizeUserId(id));
      useAppStore.getState().selectSpace(null);
      useAppStore.getState().selectRoom(roomId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Nova mensagem direta" onClose={onClose}>
      <label className="field">
        <span>Para</span>
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="Nome ou @usuario:servidor"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && user.trim() && go(user)}
        />
      </label>
      <UserPickerList term={user} onPick={go} />
      {error && <div className="form-error">{error}</div>}
      <div className="modal-footer">
        <button className="btn primary" disabled={busy || !user.trim()} onClick={() => go(user)}>
          Iniciar conversa
        </button>
      </div>
    </Modal>
  );
}

export function UserProfileModal({ onClose, userId, roomId }: { onClose(): void; userId: string; roomId?: string }) {
  const c = getClient();
  const me = c.getUserId();
  const room = roomId ? c.getRoom(roomId) : null;
  const member = room?.getMember(userId);
  const user = c.getUser(userId);
  const [profile, setProfile] = useState<{ displayname?: string; avatar_url?: string }>({});
  const inCall = useVoice((s) => s.participants.some((p) => p.userId === userId && !p.isLocal));
  const volume = useSettings((s) => s.voice.userVolumes[userId] ?? 100);

  useEffect(() => {
    c.getProfileInfo(userId)
      .then(setProfile)
      .catch(() => undefined);
  }, [c, userId]);

  const name = member?.name ?? user?.displayName ?? profile.displayname ?? userId;
  const avatar = member?.getMxcAvatarUrl() ?? user?.avatarUrl ?? profile.avatar_url;
  const presence = user?.presence;
  const pl = member?.powerLevel ?? 0;

  return (
    <Modal onClose={onClose} className="profile-modal">
      <div className="profile-banner" style={{ background: colorFor(userId) }} />
      <div className="profile-avatar">
        <Avatar mxc={avatar} name={name} id={userId} size={92} status={(presence as "online") ?? null} />
      </div>
      <div className="profile-card">
        <h2 className="left">{name}</h2>
        <div className="muted selectable">{userId}</div>
        {pl >= 50 && <div className="role-chip">{pl >= 100 ? "Administrador" : "Moderador"}</div>}
        {user?.presenceStatusMsg && <p>{user.presenceStatusMsg}</p>}
        {inCall && (
          <label className="field">
            <span>Volume do usuário — {volume}%</span>
            <input type="range" min={0} max={200} value={volume} onChange={(e) => setUserVolume(userId, Number(e.target.value))} />
          </label>
        )}
        {userId !== me && (
          <button
            className="btn primary block"
            onClick={async () => {
              const rid = await startDm(userId);
              useAppStore.getState().selectSpace(null);
              useAppStore.getState().selectRoom(rid);
              onClose();
            }}
          >
            Enviar mensagem
          </button>
        )}
      </div>
    </Modal>
  );
}
