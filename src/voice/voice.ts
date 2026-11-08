import {
  ConnectionState,
  Room as LkRoom,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
  type VideoResolution,
} from "livekit-client";
import { KnownMembership } from "matrix-js-sdk";
import type { MatrixRTCSession, Transport, CallMembership } from "matrix-js-sdk/lib/matrixrtc";
import { create } from "zustand";
import { getClient } from "../matrix/client";
import { serverName } from "../matrix/rooms";
import { useSettings } from "../store/settings";
import { sounds } from "./sounds";

export const VOICE_STATE_KEY = "com.matrixcord.voice";
const SLOT_ID = "m.call#ROOM";

export interface VParticipant {
  identity: string;
  userId: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  camera?: TrackPublication;
  screen?: TrackPublication;
  screenAudio?: TrackPublication;
}

export type TileKind = "camera" | "screen";
export const tileKey = (identity: string, kind: TileKind) => `${identity}|${kind}`;

interface VoiceStore {
  status: "idle" | "connecting" | "connected" | "error";
  roomId: string | null;
  error: string | null;
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  participants: VParticipant[];
  watching: Record<string, boolean>;
  focused: string | null;
  audioBlocked: boolean;
  ping: number | null;
}

export const useVoice = create<VoiceStore>(() => ({
  status: "idle",
  roomId: null,
  error: null,
  muted: false,
  deafened: false,
  cameraOn: false,
  screenOn: false,
  participants: [],
  watching: {},
  focused: null,
  audioBlocked: false,
  ping: null,
}));

let lk: LkRoom | null = null;
let session: MatrixRTCSession | null = null;
let audioHost: HTMLDivElement | null = null;
let mutedBeforeDeafen = false;
let appDataTimer: number | undefined;
let joinSeq = 0;

/* ------------------------------------------------------------------ */
/* Descoberta do SFU (LiveKit) e tokens                                 */
/* ------------------------------------------------------------------ */

async function discoverTransports(): Promise<Transport[]> {
  const override = useSettings.getState().advanced.livekitServiceUrl.trim();
  if (override) return [{ type: "livekit", livekit_service_url: override.replace(/\/+$/, "") }];

  const c = getClient();
  try {
    const t = await c._unstable_getRTCTransports();
    if (t?.length) return t;
  } catch {
    /* servidor sem MSC4143 /transports */
  }
  const fromWk = (wk: Record<string, unknown> | undefined) => {
    const foci = wk?.["org.matrix.msc4143.rtc_foci"];
    return Array.isArray(foci) ? (foci as Transport[]) : [];
  };
  const cached = fromWk(c.getClientWellKnown() as Record<string, unknown> | undefined);
  if (cached.length) return cached;
  try {
    const r = await fetch(`https://${serverName()}/.well-known/matrix/client`);
    if (r.ok) {
      const list = fromWk(await r.json());
      if (list.length) return list;
    }
  } catch {
    /* ignora */
  }
  throw new Error(
    "Seu servidor Matrix não anuncia um serviço de chamadas (LiveKit). Informe a URL em Configurações › Avançado.",
  );
}

interface SfuConfig {
  url: string;
  jwt: string;
}

async function getSfuConfig(transport: Transport, roomId: string): Promise<SfuConfig> {
  const c = getClient();
  const userId = c.getUserId()!;
  const deviceId = c.getDeviceId()!;
  const memberId = `${userId}:${deviceId}`;

  if (typeof transport.livekit_service_url === "string") {
    const base = transport.livekit_service_url.replace(/\/+$/, "");
    const openid = await c.getOpenIdToken();
    let r = await fetch(`${base}/sfu/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: roomId, openid_token: openid, device_id: deviceId }),
    });
    if (!r.ok) {
      r = await fetch(`${base}/get_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          slot_id: SLOT_ID,
          openid_token: openid,
          member: { id: memberId, claimed_user_id: userId, claimed_device_id: deviceId },
        }),
      });
    }
    if (!r.ok) throw new Error(`O serviço de chamadas recusou o acesso (HTTP ${r.status}).`);
    const j = await r.json();
    return { url: j.url, jwt: j.jwt };
  }
  if (typeof transport.url === "string") {
    const res = await c._unstable_getLivekitToken({
      url: transport.url,
      room_id: roomId,
      slot_id: SLOT_ID,
      member_id: memberId,
    });
    return { url: transport.url, jwt: res.jwt };
  }
  throw new Error("Transporte de chamada não suportado.");
}

/* ------------------------------------------------------------------ */
/* Mapeamento identidade LiveKit -> usuário Matrix                      */
/* ------------------------------------------------------------------ */

function resolveUserId(identity: string): string {
  const mem = session?.memberships.find(
    (m) => m.backendIdentities?.includes(identity) || m.memberId === identity,
  );
  if (mem) return mem.userId;
  // Formato legado: "@user:server:DEVICE"
  if (identity.startsWith("@")) {
    const idx = identity.lastIndexOf(":");
    if (idx > identity.indexOf(":")) return identity.slice(0, idx);
  }
  return identity;
}

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

function pubBySource(p: Participant, src: Track.Source): TrackPublication | undefined {
  return p.getTrackPublication(src);
}

function snapshot(p: Participant, isLocal: boolean): VParticipant {
  const mic = pubBySource(p, Track.Source.Microphone);
  return {
    identity: p.identity,
    userId: isLocal ? getClient().getUserId()! : resolveUserId(p.identity),
    isLocal,
    speaking: p.isSpeaking,
    micMuted: !mic || mic.isMuted,
    camera: pubBySource(p, Track.Source.Camera),
    screen: pubBySource(p, Track.Source.ScreenShare),
    screenAudio: pubBySource(p, Track.Source.ScreenShareAudio),
  };
}

function refresh() {
  if (!lk) return;
  const list: VParticipant[] = [snapshot(lk.localParticipant, true)];
  for (const p of lk.remoteParticipants.values()) list.push(snapshot(p, false));
  useVoice.setState({ participants: list });
}

function applyVolumes() {
  if (!lk) return;
  const { deafened } = useVoice.getState();
  const { userVolumes, streamVolumes } = useSettings.getState().voice;
  for (const p of lk.remoteParticipants.values()) {
    const uid = resolveUserId(p.identity);
    p.setVolume(deafened ? 0 : (userVolumes[uid] ?? 100) / 100, Track.Source.Microphone);
    p.setVolume(deafened ? 0 : (streamVolumes[uid] ?? 100) / 100, Track.Source.ScreenShareAudio);
  }
}

/** Decide quais faixas remotas assinar (é aqui que "assistir ou não" acontece). */
function applySubscriptions(p: RemoteParticipant) {
  const { watching } = useVoice.getState();
  for (const pub of p.trackPublications.values()) {
    const rp = pub as RemoteTrackPublication;
    let want = false;
    switch (rp.source) {
      case Track.Source.Microphone:
        want = true;
        break;
      case Track.Source.Camera:
        want = !!watching[tileKey(p.identity, "camera")];
        break;
      case Track.Source.ScreenShare:
      case Track.Source.ScreenShareAudio:
        want = !!watching[tileKey(p.identity, "screen")];
        break;
      default:
        want = rp.kind === Track.Kind.Audio;
    }
    if (rp.isSubscribed !== want) rp.setSubscribed(want);
  }
}

function applyAllSubscriptions() {
  if (!lk) return;
  for (const p of lk.remoteParticipants.values()) applySubscriptions(p);
}

function scheduleAppDataUpdate() {
  window.clearTimeout(appDataTimer);
  appDataTimer = window.setTimeout(() => {
    const s = useVoice.getState();
    if (!session || s.status !== "connected") return;
    session
      .updateApplicationData({
        [VOICE_STATE_KEY]: { muted: s.muted, deafened: s.deafened, video: s.cameraOn, streaming: s.screenOn },
      })
      .catch((e) => console.warn("Falha ao atualizar estado de voz", e));
  }, 700);
}

function ensureAudioHost() {
  if (!audioHost) {
    audioHost = document.createElement("div");
    audioHost.style.display = "none";
    audioHost.id = "mc-audio";
    document.body.appendChild(audioHost);
  }
  return audioHost;
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

export async function joinVoice(roomId: string) {
  const current = useVoice.getState();
  if (current.roomId === roomId && (current.status === "connected" || current.status === "connecting")) return;
  if (current.status !== "idle") await leaveVoice(true);

  const seq = ++joinSeq;
  useVoice.setState({
    status: "connecting",
    roomId,
    error: null,
    participants: [],
    watching: {},
    focused: null,
    cameraOn: false,
    screenOn: false,
  });

  const c = getClient();
  try {
    let room = c.getRoom(roomId);
    if (!room || room.getMyMembership() !== KnownMembership.Join) {
      await c.joinRoom(roomId);
      room = c.getRoom(roomId);
    }
    if (!room) throw new Error("Sala não encontrada");

    const rtc = c.matrixRTC.getRoomSession(room);
    await rtc.initialMembershipCalculated.catch(() => undefined);

    // Usa o SFU de quem já está na chamada (compatível com Element Call); se falhar, o nosso.
    const ours = (await discoverTransports()).filter((t) => t.type === "livekit");
    const existing = rtc.memberships
      .map((m: CallMembership) => m.getTransport())
      .filter((t): t is Transport => !!t && t.type === "livekit");
    const candidates = [...existing.slice(0, 1), ...ours];
    if (!candidates.length) throw new Error("Nenhum SFU LiveKit disponível.");

    let transport: Transport | null = null;
    let cfg: SfuConfig | null = null;
    let lastErr: unknown;
    for (const t of candidates) {
      try {
        cfg = await getSfuConfig(t, roomId);
        transport = t;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!cfg || !transport) throw lastErr ?? new Error("Não foi possível obter acesso à chamada.");
    if (seq !== joinSeq) return;

    const v = useSettings.getState().voice;
    const r = new LkRoom({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: true,
      audioCaptureDefaults: {
        deviceId: v.inputDeviceId || "default",
        echoCancellation: v.echoCancellation,
        noiseSuppression: v.noiseSuppression,
        autoGainControl: v.autoGainControl,
      },
      audioOutput: { deviceId: v.outputDeviceId || "default" },
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    });
    lk = r;
    session = rtc;
    wireRoom(r);

    await r.connect(cfg.url, cfg.jwt, { autoSubscribe: false });
    if (seq !== joinSeq) {
      r.disconnect();
      return;
    }

    const { muted } = useVoice.getState();
    try {
      await r.localParticipant.setMicrophoneEnabled(!muted);
    } catch (e) {
      console.warn("Microfone indisponível", e);
      useVoice.setState({ muted: true });
    }

    rtc.join(
      { userId: c.getUserId()!, deviceId: c.getDeviceId()!, memberId: `${c.getUserId()}:${c.getDeviceId()}` },
      [{ ...transport, ...(transport.livekit_service_url ? { livekit_alias: roomId } : {}) }],
      {
        callIntent: "audio",
        manageMediaKeys: false,
        applicationData: {
          [VOICE_STATE_KEY]: { muted: useVoice.getState().muted, deafened: useVoice.getState().deafened, video: false, streaming: false },
        },
      },
    );

    for (const p of r.remoteParticipants.values()) initRemote(p);
    useVoice.setState({ status: "connected", audioBlocked: !r.canPlaybackAudio });
    refresh();
    applyVolumes();
    sounds.join();
  } catch (e) {
    console.error(e);
    if (seq !== joinSeq) return;
    lk?.disconnect();
    lk = null;
    session = null;
    useVoice.setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

function initRemote(p: RemoteParticipant) {
  const { voice } = useSettings.getState();
  const watching = { ...useVoice.getState().watching };
  if (voice.autoWatchCameras && watching[tileKey(p.identity, "camera")] === undefined) {
    watching[tileKey(p.identity, "camera")] = true;
  }
  if (voice.autoWatchStreams && watching[tileKey(p.identity, "screen")] === undefined) {
    watching[tileKey(p.identity, "screen")] = true;
  }
  useVoice.setState({ watching });
  applySubscriptions(p);
}

function wireRoom(r: LkRoom) {
  r.on(RoomEvent.ParticipantConnected, (p) => {
    initRemote(p);
    applyVolumes();
    refresh();
    sounds.otherJoin();
  })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      const w = { ...useVoice.getState().watching };
      delete w[tileKey(p.identity, "camera")];
      delete w[tileKey(p.identity, "screen")];
      const f = useVoice.getState().focused;
      useVoice.setState({ watching: w, focused: f?.startsWith(p.identity + "|") ? null : f });
      refresh();
      sounds.otherLeave();
    })
    .on(RoomEvent.TrackPublished, (pub, p) => {
      if (pub.source === Track.Source.ScreenShare) sounds.streamStart();
      initRemote(p);
      refresh();
    })
    .on(RoomEvent.TrackUnpublished, (pub, p) => {
      if (pub.source === Track.Source.ScreenShare) {
        const f = useVoice.getState().focused;
        if (f === tileKey(p.identity, "screen")) useVoice.setState({ focused: null });
      }
      refresh();
    })
    .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        ensureAudioHost().appendChild(el);
        applyVolumes();
      }
      refresh();
    })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
      refresh();
    })
    .on(RoomEvent.TrackMuted, refresh)
    .on(RoomEvent.TrackUnmuted, refresh)
    .on(RoomEvent.LocalTrackPublished, () => {
      syncLocalFlags();
      refresh();
    })
    .on(RoomEvent.LocalTrackUnpublished, () => {
      syncLocalFlags();
      refresh();
    })
    .on(RoomEvent.ActiveSpeakersChanged, refresh)
    .on(RoomEvent.AudioPlaybackStatusChanged, () => useVoice.setState({ audioBlocked: !r.canPlaybackAudio }))
    .on(RoomEvent.ConnectionStateChanged, (st) => {
      if (st === ConnectionState.Reconnecting) useVoice.setState({ error: "Reconectando…" });
      if (st === ConnectionState.Connected) useVoice.setState({ error: null });
    })
    .on(RoomEvent.Disconnected, () => {
      if (lk === r) void leaveVoice(true);
    });
}

function syncLocalFlags() {
  if (!lk) return;
  const lp = lk.localParticipant;
  const cameraOn = !!lp.getTrackPublication(Track.Source.Camera)?.track && !lp.getTrackPublication(Track.Source.Camera)?.isMuted;
  const screenOn = !!lp.getTrackPublication(Track.Source.ScreenShare)?.track;
  const prev = useVoice.getState();
  if (prev.cameraOn !== cameraOn || prev.screenOn !== screenOn) {
    useVoice.setState({ cameraOn, screenOn });
    scheduleAppDataUpdate();
  }
}

export async function leaveVoice(silent = false) {
  joinSeq++;
  const r = lk;
  const s = session;
  lk = null;
  session = null;
  window.clearTimeout(appDataTimer);
  useVoice.setState({
    status: "idle",
    roomId: null,
    participants: [],
    watching: {},
    focused: null,
    cameraOn: false,
    screenOn: false,
    error: null,
  });
  if (audioHost) audioHost.innerHTML = "";
  if (!silent) sounds.leave();
  try {
    await r?.disconnect();
  } catch {
    /* ignora */
  }
  try {
    await s?.leave(5000);
  } catch {
    /* ignora */
  }
}

export async function toggleMute() {
  const s = useVoice.getState();
  const muted = !s.muted;
  // Desmutar enquanto ensurdecido também tira o ensurdecer (como no Discord)
  if (!muted && s.deafened) {
    useVoice.setState({ deafened: false });
    applyVolumes();
  }
  useVoice.setState({ muted });
  muted ? sounds.mute() : sounds.unmute();
  if (lk) {
    try {
      await lk.localParticipant.setMicrophoneEnabled(!muted);
    } catch (e) {
      console.warn(e);
      useVoice.setState({ muted: true });
    }
    refresh();
  }
  scheduleAppDataUpdate();
}

export async function toggleDeafen() {
  const s = useVoice.getState();
  const deafened = !s.deafened;
  if (deafened) {
    mutedBeforeDeafen = s.muted;
    useVoice.setState({ deafened: true, muted: true });
    sounds.mute();
  } else {
    useVoice.setState({ deafened: false, muted: mutedBeforeDeafen });
    sounds.unmute();
  }
  applyVolumes();
  if (lk) {
    try {
      await lk.localParticipant.setMicrophoneEnabled(!useVoice.getState().muted);
    } catch {
      /* ignora */
    }
    refresh();
  }
  scheduleAppDataUpdate();
}

export async function toggleCamera() {
  if (!lk) return;
  const on = !useVoice.getState().cameraOn;
  const v = useSettings.getState().voice;
  try {
    await lk.localParticipant.setCameraEnabled(on, {
      deviceId: v.videoDeviceId || undefined,
      resolution: VideoPresets.h720.resolution,
    });
  } catch (e) {
    alert("Não foi possível acessar a câmera: " + (e instanceof Error ? e.message : e));
  }
  syncLocalFlags();
  refresh();
}

const RESOLUTIONS: Record<string, VideoResolution> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  source: { width: 3840, height: 2160 },
};

export async function toggleScreenShare(force?: boolean) {
  if (!lk) return;
  const on = force ?? !useVoice.getState().screenOn;
  const v = useSettings.getState().voice;
  const res = RESOLUTIONS[v.screenResolution] ?? RESOLUTIONS["1080p"];
  const fps = v.screenFps;
  const bitrate = Math.round(res.width * res.height * fps * (fps > 30 ? 0.05 : 0.07));
  try {
    await lk.localParticipant.setScreenShareEnabled(
      on,
      {
        audio: v.screenAudio,
        resolution: { ...res, frameRate: fps },
        contentHint: fps >= 30 ? "motion" : "detail",
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      },
      { screenShareEncoding: { maxBitrate: Math.min(bitrate, 12_000_000), maxFramerate: fps } },
    );
    if (on) {
      // Transmissão própria aparece em foco automaticamente
      const key = tileKey(lk.localParticipant.identity, "screen");
      useVoice.setState({ watching: { ...useVoice.getState().watching, [key]: true } });
    }
  } catch (e) {
    if ((e as Error)?.name !== "NotAllowedError") {
      alert("Não foi possível compartilhar a tela: " + (e instanceof Error ? e.message : e));
    }
  }
  syncLocalFlags();
  refresh();
}

/** Começa/para de assistir a câmera ou a transmissão de alguém. */
export function setWatching(identity: string, kind: TileKind, watch: boolean) {
  const key = tileKey(identity, kind);
  const s = useVoice.getState();
  useVoice.setState({
    watching: { ...s.watching, [key]: watch },
    focused: !watch && s.focused === key ? null : s.focused,
  });
  const p = lk?.remoteParticipants.get(identity);
  if (p) applySubscriptions(p);
  refresh();
}

export function setFocused(key: string | null) {
  useVoice.setState({ focused: key });
}

export function setUserVolume(userId: string, vol: number) {
  const v = useSettings.getState().voice;
  useSettings.getState().setVoice({ userVolumes: { ...v.userVolumes, [userId]: vol } });
  applyVolumes();
}

export function setStreamVolume(userId: string, vol: number) {
  const v = useSettings.getState().voice;
  useSettings.getState().setVoice({ streamVolumes: { ...v.streamVolumes, [userId]: vol } });
  applyVolumes();
}

export async function switchDevice(kind: MediaDeviceKind, deviceId: string) {
  if (!lk) return;
  try {
    await lk.switchActiveDevice(kind, deviceId);
  } catch (e) {
    console.warn("Falha ao trocar dispositivo", e);
  }
}

export async function resumeAudio() {
  await lk?.startAudio();
  useVoice.setState({ audioBlocked: false });
}

export function getLocalIdentity(): string | undefined {
  return lk?.localParticipant.identity;
}

export function getLkRoom(): LkRoom | null {
  return lk;
}

/** Re-aplica política de assinatura quando as configurações mudam. */
useSettings.subscribe((s, prev) => {
  if (s.voice.userVolumes !== prev.voice.userVolumes || s.voice.streamVolumes !== prev.voice.streamVolumes) {
    applyVolumes();
  }
});

window.addEventListener("beforeunload", () => {
  if (session) void session.leave(1000);
  lk?.disconnect();
});

export { applyAllSubscriptions };
