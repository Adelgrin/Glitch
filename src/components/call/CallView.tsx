import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Room } from "matrix-js-sdk";
import type { Track } from "livekit-client";
import { getClient } from "../../matrix/client";
import { useSettings } from "../../store/settings";
import { anchorOf, useAppStore, type ProfileAnchor } from "../../store/app";
import { startDm } from "../../matrix/rooms";
import {
  getDownlinkStats,
  joinVoice,
  leaveVoice,
  resumeAudio,
  setFocused,
  setStreamMuted,
  setStreamVolume,
  setUserMuted,
  setUserVolume,
  setWatching,
  tileKey,
  toggleCamera,
  toggleDeafen,
  toggleMute,
  toggleScreenShare,
  useVoice,
  type DownlinkStats,
  type TileKind,
  type VParticipant,
} from "../../voice/voice";
import { useRtcMembers } from "../../voice/useRtcMembers";
import { useCallColor } from "../../matrix/profileStyle";
import Avatar, { colorFor } from "../Avatar";
import ChatView from "../chat/ChatView";
import RoomIcon from "../RoomIcon";
import ContextMenu, { type MenuItem } from "../ContextMenu";
import { insertIntoComposer } from "../UserCard";
import {
  IconChat,
  IconChevronDown,
  IconEye,
  IconGrid,
  IconHeadphones,
  IconHeadphonesOff,
  IconMic,
  IconMicOff,
  IconPhoneOff,
  IconScreenUp,
  IconShieldCheck,
  IconVideo,
  IconVideoOff,
  IconVolumeOff,
} from "../icons";

interface TileData {
  key: string;
  kind: TileKind;
  p: VParticipant;
}

/** O bloco tem vídeo publicado agora (câmera ligada ou transmissão de tela)? */
function tileHasVideo(t: TileData): boolean {
  const pub = t.kind === "screen" ? t.p.screen : t.p.camera;
  return !!pub && !pub.isMuted;
}

export default function CallView({ room }: { room: Room }) {
  const status = useVoice((s) => s.status);
  const voiceRoomId = useVoice((s) => s.roomId);
  const participants = useVoice((s) => s.participants);
  const focused = useVoice((s) => s.focused);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const error = useVoice((s) => s.error);
  const encrypted = useVoice((s) => s.encrypted);
  const debugStats = useSettings((s) => s.voice.debugStats);
  const hideNoVideo = useSettings((s) => s.voice.hideNoVideo);
  const setVoice = useSettings((s) => s.setVoice);
  const rtcMembers = useRtcMembers(room);
  const [showChat, setShowChat] = useState(false);
  const connectedHere = voiceRoomId === room.roomId && status !== "idle";

  const tiles: TileData[] = [];
  for (const p of participants) {
    if (p.screen) tiles.push({ key: tileKey(p.identity, "screen"), kind: "screen", p });
  }
  for (const p of participants) tiles.push({ key: tileKey(p.identity, "camera"), kind: "camera", p });
  const liveUsers = new Set(participants.map((p) => p.userId));
  const allGhosts = rtcMembers.filter((m) => !liveUsers.has(m.userId));
  // Modo "só vídeo": esconde blocos sem câmera/transmissão para caber mais lives na tela
  const visibleTiles = hideNoVideo ? tiles.filter(tileHasVideo) : tiles;
  const ghosts = hideNoVideo ? [] : allGhosts;
  const hiddenCount = tiles.length - visibleTiles.length + allGhosts.length - ghosts.length;
  const focusTile = focused ? tiles.find((t) => t.key === focused) : undefined;

  return (
    <div className="call-layout">
      <div className="call">
        <header className="chat-header call-header">
          <RoomIcon room={room} size={26} className="header-icon" />
          <span className="chat-title ellipsis">{room.name}</span>
          {connectedHere && encrypted && (
            <span className="call-e2ee" title="Mídia criptografada ponta a ponta">
              <IconShieldCheck size={16} />
            </span>
          )}
          <span className="flex-spacer" />
          {connectedHere && (
            <button
              className={`icon-btn call-hide-novideo ${hideNoVideo ? "active" : ""}`}
              title={
                hideNoVideo
                  ? `Mostrar todos os participantes${hiddenCount ? ` (${hiddenCount} oculto${hiddenCount > 1 ? "s" : ""})` : ""}`
                  : "Ocultar participantes sem vídeo"
              }
              onClick={() => setVoice({ hideNoVideo: !hideNoVideo })}
            >
              {hideNoVideo ? <IconVideo /> : <IconVideoOff />}
              {hideNoVideo && hiddenCount > 0 && <span className="call-hidden-count">{hiddenCount}</span>}
            </button>
          )}
          {connectedHere && focusTile && (
            <button className="icon-btn" title="Voltar à grade" onClick={() => setFocused(null)}>
              <IconGrid />
            </button>
          )}
          <button className={`icon-btn ${showChat ? "active" : ""}`} title="Chat do canal" onClick={() => setShowChat((v) => !v)}>
            <IconChat />
          </button>
        </header>

        {!connectedHere ? (
          <Lobby room={room} members={rtcMembers.map((m) => m.userId)} connecting={status === "connecting"} />
        ) : (
          <>
            {audioBlocked && (
              <div className="call-banner" onClick={resumeAudio}>
                O navegador bloqueou o áudio. Clique aqui para ouvir a chamada.
              </div>
            )}
            {status === "connecting" && <div className="call-banner neutral">Conectando ao servidor de mídia…</div>}
            {status === "error" && <div className="call-banner">{error}</div>}
        <div className={`call-stage ${focusTile ? "focus-mode" : ""}`}>
          {focusTile ? (
            <>
              <div className="focus-main">
                <Tile tile={focusTile} room={room} focused />
              </div>
              <div className="focus-strip">
                {visibleTiles
                  .filter((t) => t.key !== focusTile.key)
                  .map((t) => (
                    <Tile key={t.key} tile={t} room={room} small />
                  ))}
              </div>
            </>
          ) : visibleTiles.length + ghosts.length === 0 ? (
            <div className="call-empty">
              <IconVideoOff size={40} />
              <p>Ninguém está com câmera ou transmissão ligada agora.</p>
              <button className="btn secondary" onClick={() => setVoice({ hideNoVideo: false })}>
                Mostrar todos os participantes
              </button>
            </div>
          ) : (
            <FitGrid count={visibleTiles.length + ghosts.length}>
              {(avatarSize) => (
                <>
                  {visibleTiles.map((t) => (
                    <Tile key={t.key} tile={t} room={room} avatarSize={avatarSize} />
                  ))}
                  {ghosts.map((g) => (
                    <GhostTile key={g.userId} room={room} userId={g.userId} avatarSize={avatarSize} />
                  ))}
                </>
              )}
            </FitGrid>
          )}
          {debugStats && <CallStats />}
        </div>
            <CallControls />
          </>
        )}
      </div>
      {showChat && (
        <div className="call-chat">
          <ChatView room={room} embedded onClose={() => setShowChat(false)} />
        </div>
      )}
    </div>
  );
}

function Lobby({ room, members, connecting }: { room: Room; members: string[]; connecting: boolean }) {
  const c = getClient();
  return (
    <div className="lobby">
      <div className="lobby-avatars">
        {members.slice(0, 8).map((id) => {
          const m = room.getMember(id);
          return <Avatar key={id} mxc={m?.getMxcAvatarUrl()} name={m?.name ?? id} id={id} size={72} />;
        })}
      </div>
      <h2 className="lobby-title">
        <RoomIcon room={room} size={36} />
        <span>{room.name}</span>
      </h2>
      <p className="muted">
        {members.length === 0
          ? "Ninguém está aqui agora."
          : members.length === 1
            ? `${room.getMember(members[0])?.name ?? members[0]} está no canal.`
            : `${members.length} pessoas estão no canal.`}
      </p>
      <button className="btn primary big" disabled={connecting} onClick={() => joinVoice(room.roomId)}>
        {connecting ? "Conectando…" : "Entrar na chamada"}
      </button>
      <p className="muted tiny">Conectado como {c.getUser(c.getUserId()!)?.displayName ?? c.getUserId()}</p>
    </div>
  );
}

function VideoEl({ track, mirror, fit }: { track: Track; mirror?: boolean; fit: "cover" | "contain" }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={`tile-video ${mirror ? "mirror" : ""} fit-${fit}`} />;
}

function Tile({
  tile,
  room,
  focused,
  small,
  avatarSize,
}: {
  tile: TileData;
  room: Room;
  focused?: boolean;
  small?: boolean;
  /** tamanho do avatar quando a grade calcula o tamanho dos blocos */
  avatarSize?: number;
}) {
  const { p, kind, key } = tile;
  const c = getClient();
  const watching = useVoice((s) => s.watching[key]);
  const deafened = useVoice((s) => s.deafened);
  const cameraOn = useVoice((s) => s.cameraOn);
  const volume = useSettings((s) => (kind === "screen" ? s.voice.streamVolumes : s.voice.userVolumes)[p.userId] ?? 100);
  const mutedForMe = useSettings((s) => !!(kind === "screen" ? s.voice.streamMuted : s.voice.userMuted)?.[p.userId]);
  const openModal = useAppStore((s) => s.openModal);
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const member = room.getMember(p.userId);
  const name = member?.name ?? c.getUser(p.userId)?.displayName ?? p.userId;
  const callColor = useCallColor(p.userId);
  const pub = kind === "screen" ? p.screen : p.camera;
  const hasVideo = !!pub && !pub.isMuted;
  const isWatching = p.isLocal || !!watching;
  const track = pub?.track;
  const showVideo = hasVideo && isWatching && !!track;
  const avatar = avatarSize ?? (small ? 48 : focused ? 128 : 88);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen();
  };
  const pip = async () => {
    const v = ref.current?.querySelector("video");
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v?.requestPictureInPicture();
    } catch {
      /* não suportado */
    }
  };
  const openProfile = (anchor: ProfileAnchor) => openModal({ type: "userProfile", userId: p.userId, roomId: room.roomId, anchor });
  const sendMessage = async () => {
    const rid = await startDm(p.userId);
    useAppStore.getState().selectSpace(null);
    useAppStore.getState().selectRoom(rid);
  };

  /** Itens do menu de botão direito (como no Discord). */
  const menuItems = (at: { x: number; y: number }): MenuItem[] => {
    const items: MenuItem[] = [];
    const header = (
      <>
        <Avatar mxc={member?.getMxcAvatarUrl()} name={name} id={p.userId} size={28} />
        <span className="ellipsis">
          {kind === "screen" ? (p.isLocal ? "Sua transmissão" : `Transmissão de ${name}`) : p.isLocal ? `${name} (você)` : name}
        </span>
      </>
    );
    items.push({ type: "header", content: header });
    const videoItems: MenuItem[] = [];
    if (showVideo) {
      videoItems.push(
        { type: "item", label: focused ? "Sair do foco" : "Focar", onClick: () => setFocused(focused ? null : key) },
        { type: "item", label: "Tela cheia", onClick: fullscreen },
        { type: "item", label: "Picture-in-picture", onClick: () => void pip() },
      );
    }

    if (kind === "screen") {
      if (p.isLocal) {
        items.push({ type: "item", label: "Parar transmissão", danger: true, onClick: () => void toggleScreenShare(false) });
      } else {
        items.push(
          { type: "slider", label: "Volume da transmissão", value: volume, min: 0, max: 200, format: (v) => `${v}%`, onChange: (v) => setStreamVolume(p.userId, v) },
          { type: "check", label: "Silenciar transmissão", checked: mutedForMe, onChange: (v) => setStreamMuted(p.userId, v) },
          { type: "separator" },
          isWatching
            ? { type: "item", label: "Parar de assistir", onClick: () => setWatching(p.identity, "screen", false) }
            : { type: "item", label: "Assistir transmissão", onClick: () => setWatching(p.identity, "screen", true) },
        );
      }
      if (videoItems.length) items.push(...videoItems);
      if (!p.isLocal) items.push({ type: "separator" }, { type: "item", label: `Ver perfil de ${name}`, onClick: () => openProfile({ ...at, w: 0, h: 0 }) });
      return items;
    }

    // Bloco de pessoa (câmera/avatar)
    items.push({ type: "item", label: "Ver perfil", onClick: () => openProfile({ ...at, w: 0, h: 0 }) });
    if (p.isLocal) {
      items.push({ type: "item", label: cameraOn ? "Desligar câmera" : "Ligar câmera", onClick: () => void toggleCamera() });
      if (videoItems.length) items.push({ type: "separator" }, ...videoItems);
      return items;
    }
    items.push(
      { type: "item", label: "Enviar mensagem", onClick: () => void sendMessage() },
      { type: "item", label: "Mencionar", onClick: () => insertIntoComposer(`${p.userId} `) },
      { type: "separator" },
      { type: "slider", label: "Volume do usuário", value: volume, min: 0, max: 200, format: (v) => `${v}%`, onChange: (v) => setUserVolume(p.userId, v) },
      { type: "check", label: "Silenciar", checked: mutedForMe, danger: true, onChange: (v) => setUserMuted(p.userId, v) },
    );
    if (hasVideo) {
      items.push(
        { type: "separator" },
        isWatching
          ? { type: "item", label: "Ocultar câmera", onClick: () => setWatching(p.identity, "camera", false) }
          : { type: "item", label: "Ver câmera", onClick: () => setWatching(p.identity, "camera", true) },
      );
      if (videoItems.length) items.push(...videoItems);
    }
    items.push({ type: "separator" }, { type: "item", label: "Copiar ID do usuário", onClick: () => void navigator.clipboard.writeText(p.userId) });
    return items;
  };

  return (
    <div
      ref={ref}
      className={`tile ${kind} ${p.speaking && kind === "camera" ? "speaking" : ""} ${focused ? "focused" : ""} ${small ? "small" : ""} ${menu ? "menu-open" : ""}`}
      style={{ ["--tile-color" as string]: callColor ?? colorFor(p.userId) }}
      // Dois cliques: foca o bloco; dois cliques no bloco em foco: desfoca
      onDoubleClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        setFocused(focused ? null : key);
      }}
      // Na faixa de miniaturas (modo foco), um clique troca o bloco em foco
      onClick={() => {
        if (small) setFocused(key);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {showVideo ? (
        <VideoEl track={track!} mirror={p.isLocal && kind === "camera"} fit={kind === "screen" || focused ? "contain" : "cover"} />
      ) : kind === "screen" ? (
        <div className="tile-stream-placeholder">
          <div className="tile-stream-bg">
            <Avatar mxc={member?.getMxcAvatarUrl()} name={name} id={p.userId} size={small ? 40 : Math.round(avatar * 0.9)} />
          </div>
          {!small && (
            <>
              <span className="live-badge big">AO VIVO</span>
              <div className="tile-stream-title">{name} está transmitindo</div>
            </>
          )}
          <button
            className="btn primary"
            onClick={(e) => {
              e.stopPropagation();
              setWatching(p.identity, "screen", true);
            }}
          >
            <IconEye size={18} /> {small ? "" : "Assistir transmissão"}
          </button>
        </div>
      ) : (
        <div className="tile-avatar">
          <Avatar mxc={member?.getMxcAvatarUrl()} name={name} id={p.userId} size={avatar} speaking={p.speaking} />
          {hasVideo && !isWatching && !small && (
            <button
              className="btn secondary small tile-watch-cam"
              onClick={(e) => {
                e.stopPropagation();
                setWatching(p.identity, "camera", true);
              }}
            >
              <IconVideo size={16} /> Ver câmera
            </button>
          )}
        </div>
      )}

      <div className="tile-label">
        {kind === "screen" && <span className="live-badge">AO VIVO</span>}
        {!p.isLocal && <QualityBadge identity={p.identity} />}
        {kind === "camera" && (p.micMuted || (p.isLocal && deafened)) && <IconMicOff size={14} className="danger" />}
        {mutedForMe && (
          <span className="tile-muted-for-me" title="Silenciado por você">
            <IconVolumeOff size={14} />
          </span>
        )}
        <span className="ellipsis">{p.isLocal && kind === "screen" ? "Sua transmissão" : name}</span>
      </div>

      {/* Só a seta do perfil; o resto fica no menu de botão direito */}
      {!p.isLocal && (
        <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn tiny" title="Perfil" onClick={(e) => openProfile(anchorOf(e.currentTarget))}>
            <IconChevronDown size={16} />
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Barrinhas de qualidade do downlink (estilo Discord), via ConnectionQualityChanged do LiveKit. */
function QualityBadge({ identity }: { identity: string }) {
  const level = useVoice((s) => s.quality[identity] ?? 0);
  if (!level) return null;
  const title = level >= 3 ? "Ótima conexão" : level === 2 ? "Boa conexão" : "Conexão ruim";
  return (
    <span className={`quality-badge q${level}`} title={title}>
      <i />
      <i />
      <i />
    </span>
  );
}

/** Painel de diagnóstico: estatísticas agregadas de recepção, atualizadas a cada 2s. */
function CallStats() {
  const [stats, setStats] = useState<DownlinkStats | null>(null);
  useEffect(() => {
    const tick = async () => setStats(await getDownlinkStats());
    void tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  if (!stats) return null;
  const level = (v: number, warn: number, bad: number) => (v >= bad ? "bad" : v >= warn ? "warn" : "");
  return (
    <div className="call-stats">
      <span>↓ {Math.round(stats.kbps)} kbps</span>
      <span className={level(stats.lossPct, 1, 5)}>perda {stats.lossPct.toFixed(1)}%</span>
      <span className={level(stats.jitterMs, 30, 60)}>jitter {Math.round(stats.jitterMs)} ms</span>
      {stats.framesDropped > 0 && <span>{stats.framesDropped} quadros descartados</span>}
      {stats.videoCodec && <span>{stats.videoCodec}</span>}
    </div>
  );
}

/**
 * Grade que ocupa o espaço disponível: mede a área e escolhe quantas colunas deixam
 * os blocos (16:9) o maior possível, centralizados — como no Discord.
 */
function FitGrid({ count, children }: { count: number; children(avatarSize: number): React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const GAP = 12;
  const RATIO = 16 / 9;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let best = { w: 0, h: 0 };
  if (box.w > 0 && box.h > 0 && count > 0) {
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      let w = (box.w - GAP * (cols - 1)) / cols;
      let h = w / RATIO;
      if (h * rows + GAP * (rows - 1) > box.h) {
        h = (box.h - GAP * (rows - 1)) / rows;
        w = h * RATIO;
      }
      if (w > best.w) best = { w, h };
    }
  }
  const tileW = Math.max(0, Math.floor(best.w));
  const tileH = Math.max(0, Math.floor(best.h));
  // Avatar acompanha o tamanho do bloco (com limites)
  const avatarSize = Math.round(Math.min(180, Math.max(48, tileH * 0.4)));

  return (
    <div ref={ref} className="fit-grid" style={{ ["--tile-w" as string]: `${tileW}px`, ["--tile-h" as string]: `${tileH}px`, gap: GAP }}>
      {tileW > 0 && children(avatarSize)}
    </div>
  );
}

function GhostTile({ room, userId, avatarSize = 88 }: { room: Room; userId: string; avatarSize?: number }) {
  const m = room.getMember(userId);
  const callColor = useCallColor(userId);
  return (
    <div className="tile camera ghost" style={{ ["--tile-color" as string]: callColor ?? colorFor(userId) }}>
      <div className="tile-avatar">
        <Avatar mxc={m?.getMxcAvatarUrl()} name={m?.name ?? userId} id={userId} size={avatarSize} />
      </div>
      <div className="tile-label">
        <span className="ellipsis">{m?.name ?? userId}</span>
        <span className="muted tiny">conectando…</span>
      </div>
    </div>
  );
}

function CallControls() {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const cameraOn = useVoice((s) => s.cameraOn);
  const screenOn = useVoice((s) => s.screenOn);
  const status = useVoice((s) => s.status);
  const voice = useSettings((s) => s.voice);
  const setVoice = useSettings((s) => s.setVoice);
  const [shareMenu, setShareMenu] = useState(false);
  const disabled = status !== "connected";

  return (
    <div className="call-controls">
      <button className={`call-btn ${cameraOn ? "on" : ""}`} disabled={disabled} title="Câmera" onClick={toggleCamera}>
        {cameraOn ? <IconVideo /> : <IconVideoOff />}
      </button>
      <div className="call-btn-group">
        <button
          className={`call-btn ${screenOn ? "on" : ""}`}
          disabled={disabled}
          title={screenOn ? "Parar transmissão" : "Transmitir tela"}
          onClick={() => toggleScreenShare()}
        >
          <IconScreenUp />
        </button>
        <button className="call-btn caret" disabled={disabled} title="Qualidade da transmissão" onClick={() => setShareMenu((v) => !v)}>
          <IconChevronDown size={14} />
        </button>
        {shareMenu && (
          <div className="share-menu" onMouseLeave={() => setShareMenu(false)}>
            <div className="section-label">Resolução</div>
            <div className="seg">
              {(["720p", "1080p", "1440p", "source"] as const).map((r) => (
                <button key={r} className={voice.screenResolution === r ? "active" : ""} onClick={() => setVoice({ screenResolution: r })}>
                  {r === "source" ? "Fonte" : r}
                </button>
              ))}
            </div>
            <div className="section-label">Taxa de quadros</div>
            <div className="seg">
              {([15, 30, 60] as const).map((f) => (
                <button key={f} className={voice.screenFps === f ? "active" : ""} onClick={() => setVoice({ screenFps: f })}>
                  {f} FPS
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={voice.screenAudio} onChange={(e) => setVoice({ screenAudio: e.target.checked })} />
              Transmitir áudio da tela/aba
            </label>
            {screenOn && (
              <button
                className="btn secondary small block"
                onClick={async () => {
                  await toggleScreenShare(false);
                  await toggleScreenShare(true);
                }}
              >
                Aplicar (reiniciar transmissão)
              </button>
            )}
          </div>
        )}
      </div>
      <button className={`call-btn ${muted ? "off" : ""}`} title={muted ? "Ativar microfone" : "Silenciar"} onClick={toggleMute}>
        {muted ? <IconMicOff /> : <IconMic />}
      </button>
      <button className={`call-btn ${deafened ? "off" : ""}`} title={deafened ? "Ativar áudio" : "Desativar áudio"} onClick={toggleDeafen}>
        {deafened ? <IconHeadphonesOff /> : <IconHeadphones />}
      </button>
      <button className="call-btn leave" title="Desconectar" onClick={() => leaveVoice()}>
        <IconPhoneOff />
      </button>
    </div>
  );
}
