import { useEffect, useRef, useState } from "react";
import type { Room } from "matrix-js-sdk";
import type { Track } from "livekit-client";
import { getClient } from "../../matrix/client";
import { useSettings } from "../../store/settings";
import { useAppStore } from "../../store/app";
import {
  joinVoice,
  leaveVoice,
  resumeAudio,
  setFocused,
  setStreamVolume,
  setUserVolume,
  setWatching,
  tileKey,
  toggleCamera,
  toggleDeafen,
  toggleMute,
  toggleScreenShare,
  useVoice,
  type TileKind,
  type VParticipant,
} from "../../voice/voice";
import { useRtcMembers } from "../../voice/useRtcMembers";
import Avatar, { colorFor } from "../Avatar";
import ChatView from "../chat/ChatView";
import {
  IconChat,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconFocus,
  IconFullscreen,
  IconGrid,
  IconHeadphones,
  IconHeadphonesOff,
  IconMic,
  IconMicOff,
  IconPhoneOff,
  IconPip,
  IconScreenUp,
  IconSpeaker,
  IconVideo,
  IconVideoOff,
  IconVolume,
} from "../icons";

interface TileData {
  key: string;
  kind: TileKind;
  p: VParticipant;
}

export default function CallView({ room }: { room: Room }) {
  const status = useVoice((s) => s.status);
  const voiceRoomId = useVoice((s) => s.roomId);
  const participants = useVoice((s) => s.participants);
  const focused = useVoice((s) => s.focused);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const error = useVoice((s) => s.error);
  const rtcMembers = useRtcMembers(room);
  const [showChat, setShowChat] = useState(false);
  const connectedHere = voiceRoomId === room.roomId && status !== "idle";

  const tiles: TileData[] = [];
  for (const p of participants) {
    if (p.screen) tiles.push({ key: tileKey(p.identity, "screen"), kind: "screen", p });
  }
  for (const p of participants) tiles.push({ key: tileKey(p.identity, "camera"), kind: "camera", p });
  const liveUsers = new Set(participants.map((p) => p.userId));
  const ghosts = rtcMembers.filter((m) => !liveUsers.has(m.userId));
  const focusTile = focused ? tiles.find((t) => t.key === focused) : undefined;

  return (
    <div className="call-layout">
      <div className="call">
        <header className="chat-header call-header">
          <IconSpeaker size={22} className="muted" />
          <span className="chat-title ellipsis">{room.name}</span>
          <span className="flex-spacer" />
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
                    {tiles
                      .filter((t) => t.key !== focusTile.key)
                      .map((t) => (
                        <Tile key={t.key} tile={t} room={room} small />
                      ))}
                  </div>
                </>
              ) : (
                <div className={`tile-grid n${Math.min(tiles.length + ghosts.length, 9)}`}>
                  {tiles.map((t) => (
                    <Tile key={t.key} tile={t} room={room} />
                  ))}
                  {ghosts.map((g) => (
                    <GhostTile key={g.userId} room={room} userId={g.userId} />
                  ))}
                </div>
              )}
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
      <h2>{room.name}</h2>
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

function Tile({ tile, room, focused, small }: { tile: TileData; room: Room; focused?: boolean; small?: boolean }) {
  const { p, kind, key } = tile;
  const c = getClient();
  const watching = useVoice((s) => s.watching[key]);
  const deafened = useVoice((s) => s.deafened);
  const userVolume = useSettings((s) => (kind === "screen" ? s.voice.streamVolumes : s.voice.userVolumes)[p.userId] ?? 100);
  const openModal = useAppStore((s) => s.openModal);
  const ref = useRef<HTMLDivElement>(null);
  const [volOpen, setVolOpen] = useState(false);
  const member = room.getMember(p.userId);
  const name = member?.name ?? c.getUser(p.userId)?.displayName ?? p.userId;
  const pub = kind === "screen" ? p.screen : p.camera;
  const hasVideo = !!pub && !pub.isMuted;
  const isWatching = p.isLocal || !!watching;
  const track = pub?.track;
  const showVideo = hasVideo && isWatching && !!track;

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

  return (
    <div
      ref={ref}
      className={`tile ${kind} ${p.speaking && kind === "camera" ? "speaking" : ""} ${focused ? "focused" : ""} ${small ? "small" : ""}`}
      style={{ ["--tile-color" as string]: colorFor(p.userId) }}
      onDoubleClick={fullscreen}
      onClick={() => {
        if (small || (!focused && showVideo)) setFocused(key);
      }}
    >
      {showVideo ? (
        <VideoEl track={track!} mirror={p.isLocal && kind === "camera"} fit={kind === "screen" || focused ? "contain" : "cover"} />
      ) : kind === "screen" ? (
        <div className="tile-stream-placeholder">
          <div className="tile-stream-bg">
            <Avatar mxc={member?.getMxcAvatarUrl()} name={name} id={p.userId} size={small ? 40 : 80} />
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
          <Avatar mxc={member?.getMxcAvatarUrl()} name={name} id={p.userId} size={small ? 48 : focused ? 128 : 88} speaking={p.speaking} />
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
        {kind === "camera" && (p.micMuted || (p.isLocal && deafened)) && <IconMicOff size={14} className="danger" />}
        <span className="ellipsis">{p.isLocal && kind === "screen" ? "Sua transmissão" : name}</span>
      </div>

      <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
        {!p.isLocal && (
          <div className="tile-vol">
            <button className="icon-btn tiny" title="Volume" onClick={() => setVolOpen((v) => !v)}>
              <IconVolume size={16} />
            </button>
            {volOpen && (
              <div className="tile-vol-pop">
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={userVolume}
                  onChange={(e) =>
                    kind === "screen"
                      ? setStreamVolume(p.userId, Number(e.target.value))
                      : setUserVolume(p.userId, Number(e.target.value))
                  }
                />
                <span>{userVolume}%</span>
              </div>
            )}
          </div>
        )}
        {showVideo && (
          <button className="icon-btn tiny" title="Picture-in-picture" onClick={pip}>
            <IconPip size={16} />
          </button>
        )}
        {showVideo && (
          <button className="icon-btn tiny" title={focused ? "Sair do foco" : "Focar"} onClick={() => setFocused(focused ? null : key)}>
            <IconFocus size={16} />
          </button>
        )}
        <button className="icon-btn tiny" title="Tela cheia" onClick={fullscreen}>
          <IconFullscreen size={16} />
        </button>
        {!p.isLocal && hasVideo && isWatching && (
          <button
            className="icon-btn tiny"
            title={kind === "screen" ? "Parar de assistir" : "Ocultar câmera"}
            onClick={() => setWatching(p.identity, kind, false)}
          >
            <IconEyeOff size={16} />
          </button>
        )}
        {!p.isLocal && (
          <button className="icon-btn tiny" title="Perfil" onClick={() => openModal({ type: "userProfile", userId: p.userId, roomId: room.roomId })}>
            <IconChevronDown size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function GhostTile({ room, userId }: { room: Room; userId: string }) {
  const m = room.getMember(userId);
  return (
    <div className="tile camera ghost" style={{ ["--tile-color" as string]: colorFor(userId) }}>
      <div className="tile-avatar">
        <Avatar mxc={m?.getMxcAvatarUrl()} name={m?.name ?? userId} id={userId} size={88} />
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
