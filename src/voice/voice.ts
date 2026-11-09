import {
  BaseKeyProvider,
  ConnectionState,
  ConnectionQuality,
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
import { ClientEvent, KnownMembership, type MatrixEvent } from "matrix-js-sdk";
import {
  MatrixRTCSessionEvent,
  type CallMembership,
  type MatrixRTCSession,
  type Transport,
} from "matrix-js-sdk/lib/matrixrtc";
import type { CallMembershipIdentityParts } from "matrix-js-sdk/lib/matrixrtc/EncryptionManager";
import { create } from "zustand";
import { getClient } from "../matrix/client";
import { getMyCallColor, useProfileStyles } from "../matrix/profileStyle";
import { serverName } from "../matrix/rooms";
import { useSettings } from "../store/settings";
import { sounds } from "./sounds";
import e2eeWorkerUrl from "livekit-client/e2ee-worker?worker&url";
import { nativeConnect, nativeLeave, nativeSetDeafened, nativeSetMicMuted, nativeSetVolumes, nativeVoiceAvailable } from "./native";

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
  /** mídia criptografada ponta a ponta (sala Matrix criptografada) */
  encrypted: boolean;
  /** qualidade do downlink por identidade (0 desconhecido, 1 ruim, 2 boa, 3 ótima) */
  quality: Record<string, number>;
}

/** Qualidade do downlink (LiveKit) -> nível numérico para os indicadores. */
export function qualityLevel(q: ConnectionQuality): number {
  switch (q) {
    case ConnectionQuality.Excellent:
      return 3;
    case ConnectionQuality.Good:
      return 2;
    case ConnectionQuality.Poor:
      return 1;
    default:
      return 0;
  }
}

export interface DownlinkStats {
  /** jitter médio em ms (áudio + vídeo) */
  jitterMs: number;
  /** perda de pacotes em % (áudio + vídeo) */
  lossPct: number;
  /** bitrate recebido total em kbps */
  kbps: number;
  /** quadros de vídeo descartados (acumulado) */
  framesDropped: number;
  /** codec de vídeo em uso, quando disponível */
  videoCodec: string | null;
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
  encrypted: false,
  quality: {},
}));

let lk: LkRoom | null = null;
let nativeActive = false;
let nativePrevIds: Set<string> | null = null;
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
/* E2EE de mídia (MSC4268) — interoperável com Element Call/Cinny      */
/*                                                                     */
/* Em salas criptografadas, quem publica cifra os frames no navegador  */
/* e distribui as chaves via eventos Matrix. O LiveKit recebe apenas   */
/* dados cifrados: sem isto, a mídia de clientes que cifram chega      */
/* "quebrada" (frames cifrados sendo decodificados como VP8/Opus).     */
/* ------------------------------------------------------------------ */

/** KeyProvider com uma chave por participante (o padrão do livekit só tem chave única compartilhada). */
class ParticipantKeyProvider extends BaseKeyProvider {
  constructor() {
    // Mesmos parâmetros do Element Call: o matrix-js-sdk usa índices de chave 0..255
    // (o keyring padrão do livekit tem só 16 posições).
    super({ sharedKey: false, ratchetWindowSize: 10, keyringSize: 256 });
  }

  /**
   * O worker de E2EE espera um CryptoKey HKDF (ele lê `material.algorithm.name`
   * para derivar a chave AES-GCM). Passar o Uint8Array cru faz a derivação
   * falhar e nenhum frame é cifrado/decifrado.
   */
  async setKey(key: Uint8Array, participantIdentity: string, keyIndex = 0) {
    const material = await crypto.subtle.importKey("raw", key as BufferSource, "HKDF", false, [
      "deriveBits",
      "deriveKey",
    ]);
    this.onSetEncryptionKey(material, participantIdentity, keyIndex);
  }
}

let keyProvider: ParticipantKeyProvider | null = null;

const onEncryptionKeyChanged = (
  key: Uint8Array,
  encryptionKeyIndex: number,
  membership: CallMembershipIdentityParts,
  backendIdentity: string,
) => {
  if (!keyProvider) return;
  // O backendIdentity das memberships novas (sticky events) é um hash sha256
  // anonimizado, que pode não ser a identidade LiveKit real do participante
  // (formato legado: "@user:server:device"). Registra a chave sob todas as
  // identidades candidatas para garantir o casamento no worker de E2EE.
  const mem = session?.memberships.find(
    (m) => m.userId === membership.userId && m.deviceId === membership.deviceId,
  );
  const candidates = new Set<string>([backendIdentity, membership.memberId]);
  if (mem) {
    candidates.add(mem.memberId);
    mem.backendIdentities?.forEach((id) => candidates.add(id));
  }
  console.debug(
    `[e2ee] chave recebida idx=${encryptionKeyIndex} len=${key.length} identidades=`,
    [...candidates],
  );
  for (const id of candidates) {
    if (id)
      keyProvider
        .setKey(key, id, encryptionKeyIndex)
        .catch((e) => console.error("[e2ee] falha ao importar chave", id, e));
  }
};

function ensureKeyProvider(enabled: boolean) {
  keyProvider = enabled ? new ParticipantKeyProvider() : null;
  return keyProvider;
}

function wireEncryptionKeys(rtc: MatrixRTCSession) {
  rtc.on(MatrixRTCSessionEvent.EncryptionKeyChanged, onEncryptionKeyChanged);
}

const CALL_KEYS_TYPE = "io.element.call.encryption_keys";

/**
 * Compatibilidade com o Element Call embutido no Cinny.
 *
 * O matrix-js-sdk 45 só aceita uma chave quando (userId, deviceId, memberId) da
 * chave batem com uma membership. O Element Call do Cinny envia `member.id` com
 * um UUID interno, mas publica a membership com `membershipID = user:device`.
 * O SDK então estaciona a chave para sempre ("No matching RTC membership") e o
 * áudio/vídeo dele chega mudo para nós.
 *
 * Aqui aplicamos a mesma regra do próprio Element Call: casar só por
 * (userId, deviceId). Aceitamos apenas eventos que chegaram cifrados com Olm,
 * e o userId vem do remetente verificado pelo Olm, não do conteúdo.
 */
interface PendingKey {
  userId: string;
  deviceId: string;
  key: Uint8Array;
  index: number;
}
let pendingKeys: PendingKey[] = [];
let toDeviceListener: ((ev: MatrixEvent) => void) | null = null;
let membershipsListener: (() => void) | null = null;
let keyRtc: MatrixRTCSession | null = null;

function b64ToBytes(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Tenta aplicar a chave; devolve false se ainda não há membership para o dispositivo. */
function applyKeyByDevice(k: PendingKey): boolean {
  if (!keyProvider || !keyRtc) return true;
  const mem = keyRtc.memberships.find((m) => m.userId === k.userId && m.deviceId === k.deviceId);
  if (!mem) return false;
  const ids = new Set<string>([`${k.userId}:${k.deviceId}`, ...(mem.backendIdentities ?? [])]);
  for (const id of ids) {
    keyProvider
      .setKey(k.key, id, k.index)
      .catch((e) => console.error("[e2ee] falha ao importar chave", id, e));
  }
  console.debug(`[e2ee] chave de ${k.userId}:${k.deviceId} idx=${k.index} aplicada em`, [...ids]);
  return true;
}

function wireKeyCompat(rtc: MatrixRTCSession) {
  unwireKeyCompat();
  keyRtc = rtc;
  const roomId = rtc.room.roomId;
  const myUser = getClient().getUserId();
  const myDevice = getClient().getDeviceId();

  toDeviceListener = (ev: MatrixEvent) => {
    if (ev.getType() !== CALL_KEYS_TYPE) return;
    const sender = ev.getSender();
    const c = ev.getContent();
    const deviceId = c.member?.claimed_device_id;
    const mk = c.media_key ?? c.keys;
    // Só metadados no log, nunca o material da chave.
    console.debug("[e2ee] to-device de chave:", {
      de: sender,
      wire: ev.getWireType(),
      member_id: c.member_id ?? c.member?.id,
      device: deviceId,
      indice: mk?.index,
    });
    if (ev.getWireType() !== "m.room.encrypted") {
      console.warn("[e2ee] chave de chamada SEM criptografia Olm de", sender, "— ignorada");
      return;
    }
    if (!sender || c.room_id !== roomId || typeof deviceId !== "string") return;
    if (sender === myUser && deviceId === myDevice) return;
    if (!mk || typeof mk.key !== "string" || typeof mk.index !== "number") return;
    const k: PendingKey = { userId: sender, deviceId, key: b64ToBytes(mk.key), index: mk.index };
    if (!applyKeyByDevice(k)) pendingKeys.push(k);
  };
  getClient().on(ClientEvent.ToDeviceEvent, toDeviceListener);

  membershipsListener = () => {
    if (!pendingKeys.length) return;
    const left = pendingKeys;
    pendingKeys = [];
    for (const k of left) if (!applyKeyByDevice(k)) pendingKeys.push(k);
  };
  rtc.on(MatrixRTCSessionEvent.MembershipsChanged, membershipsListener);
}

function unwireKeyCompat() {
  if (toDeviceListener) getClient().off(ClientEvent.ToDeviceEvent, toDeviceListener);
  if (membershipsListener) keyRtc?.off(MatrixRTCSessionEvent.MembershipsChanged, membershipsListener);
  toDeviceListener = null;
  membershipsListener = null;
  keyRtc = null;
  pendingKeys = [];
}

function unwireEncryptionKeys(rtc: MatrixRTCSession | null) {
  rtc?.off(MatrixRTCSessionEvent.EncryptionKeyChanged, onEncryptionKeyChanged);
  unwireKeyCompat();
  keyProvider = null;
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
  if (nativeActive) {
    const { participants, deafened } = useVoice.getState();
    const { userVolumes } = useSettings.getState().voice;
    const volumes: Record<string, number> = {};
    for (const p of participants) {
      if (p.isLocal) continue;
      volumes[p.identity] = deafened ? 0 : (userVolumes[p.userId] ?? 100) / 100;
    }
    void nativeSetVolumes(volumes);
    return;
  }
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

/** Estado publicado na membership da chamada (visto por quem está fora dela também). */
function voiceAppData() {
  const s = useVoice.getState();
  const color = getMyCallColor();
  return {
    [VOICE_STATE_KEY]: {
      muted: s.muted,
      deafened: s.deafened,
      video: s.cameraOn,
      streaming: s.screenOn,
      ...(color ? { color } : {}),
    },
  };
}

function scheduleAppDataUpdate() {
  window.clearTimeout(appDataTimer);
  appDataTimer = window.setTimeout(() => {
    const s = useVoice.getState();
    if (!session || s.status !== "connected") return;
    session.updateApplicationData(voiceAppData()).catch((e) => console.warn("Falha ao atualizar estado de voz", e));
  }, 700);
}

// Mudou a cor do bloco na chamada → republica para os outros verem
useProfileStyles.subscribe((s, prev) => {
  if (s.mine.callColor !== prev.mine.callColor) scheduleAppDataUpdate();
});

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
    encrypted: false,
    quality: {},
  });

  const c = getClient();
  let rtc: MatrixRTCSession | null = null;
  try {
    let room = c.getRoom(roomId);
    if (!room || room.getMyMembership() !== KnownMembership.Join) {
      await c.joinRoom(roomId);
      room = c.getRoom(roomId);
    }
    if (!room) throw new Error("Sala não encontrada");

    rtc = c.matrixRTC.getRoomSession(room);
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

    // WebKitGTK (Tauri/Linux) não tem WebRTC: usa o cliente nativo em Rust
    if (nativeVoiceAvailable()) {
      await joinNative(rtc, roomId, transport, cfg, seq);
      return;
    }

    const v = useSettings.getState().voice;

    // Mídia criptografada ponta a ponta quando a sala Matrix é criptografada
    // (mesmo critério de Element Call/Cinny — MSC4268).
    const e2ee = room.hasEncryptionStateEvent();
    ensureKeyProvider(e2ee);
    wireEncryptionKeys(rtc);
    if (e2ee) wireKeyCompat(rtc);

    const r = new LkRoom({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: v.webAudioMix,
      audioCaptureDefaults: {
        deviceId: v.inputDeviceId || "default",
        echoCancellation: v.echoCancellation,
        noiseSuppression: v.noiseSuppression,
        autoGainControl: v.autoGainControl,
      },
      audioOutput: { deviceId: v.outputDeviceId || "default" },
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      e2ee: e2ee
        ? { keyProvider: keyProvider!, worker: new Worker(e2eeWorkerUrl, { type: "module" }) }
        : undefined,
    });
    lk = r;
    session = rtc;
    wireRoom(r);

    await r.connect(cfg.url, cfg.jwt, { autoSubscribe: false });
    if (seq !== joinSeq) {
      r.disconnect();
      return;
    }

    // Sem isto o LiveKit publica nossas faixas SEM criptografia (Encryption_Type.NONE),
    // mesmo com o keyProvider configurado: as opções de e2ee só preparam o worker.
    if (e2ee) await r.setE2EEEnabled(true);

    rtc.join(
      { userId: c.getUserId()!, deviceId: c.getDeviceId()!, memberId: `${c.getUserId()}:${c.getDeviceId()}` },
      [{ ...transport, ...(transport.livekit_service_url ? { livekit_alias: roomId } : {}) }],
      {
        callIntent: "audio",
        manageMediaKeys: e2ee,
        applicationData: voiceAppData(),
      },
    );
    // Chaves distribuídas/recebidas antes deste ponto do fluxo
    if (e2ee) rtc.reemitEncryptionKeys();

    const { muted } = useVoice.getState();
    try {
      await r.localParticipant.setMicrophoneEnabled(!muted);
    } catch (e) {
      console.warn("Microfone indisponível", e);
      useVoice.setState({ muted: true });
    }

    if (e2ee) {
      console.debug(
        "[e2ee] identidades livekit: local=%s remotas=",
        r.localParticipant.identity,
        [...r.remoteParticipants.keys()],
      );
    }

    for (const p of r.remoteParticipants.values()) initRemote(p);
    useVoice.setState({ status: "connected", audioBlocked: !r.canPlaybackAudio, encrypted: e2ee });
    refresh();
    applyVolumes();
    sounds.join();
  } catch (e) {
    console.error(e);
    if (seq !== joinSeq) return;
    unwireEncryptionKeys(rtc);
    lk?.disconnect();
    lk = null;
    session = null;
    useVoice.setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Caminho nativo (Tauri/Linux): o SDK Rust do LiveKit cuida da mídia
 * (microfone + áudio remoto) e o front só mantém a membership MatrixRTC
 * e reflete o estado recebido via eventos.
 */
async function joinNative(
  rtc: MatrixRTCSession,
  roomId: string,
  transport: Transport,
  cfg: SfuConfig,
  seq: number,
) {
  nativeActive = true;
  nativePrevIds = null;
  session = rtc;
  const c = getClient();
  try {
    const { muted } = useVoice.getState();
    await nativeConnect(cfg.url, cfg.jwt, muted, (e) => {
      if (e.type === "snapshot") {
        const participants: VParticipant[] = [];
        if (e.local.identity) {
          participants.push({
            identity: e.local.identity,
            userId: c.getUserId()!,
            isLocal: true,
            speaking: e.local.speaking,
            micMuted: e.local.micMuted,
          });
        }
        for (const np of e.participants) {
          participants.push({
            identity: np.identity,
            userId: resolveUserId(np.identity),
            isLocal: false,
            speaking: np.speaking,
            micMuted: np.micMuted,
          });
        }
        // Sons de entrada/saída (diff com o snapshot anterior)
        const ids = new Set(e.participants.map((np) => np.identity));
        if (nativePrevIds) {
          for (const id of ids) if (!nativePrevIds.has(id)) sounds.otherJoin();
          for (const id of nativePrevIds) if (!ids.has(id)) sounds.otherLeave();
        }
        nativePrevIds = ids;
        useVoice.setState({
          participants,
          quality: e.quality,
          error: e.status === "reconnecting" ? "Reconectando…" : null,
        });
      } else if (e.type === "disconnected") {
        if (!e.expected) void leaveVoice(true);
      } else {
        useVoice.setState({ error: e.message });
      }
    });
    if (seq !== joinSeq) {
      nativeActive = false;
      void nativeLeave();
      return;
    }

    rtc.join(
      { userId: c.getUserId()!, deviceId: c.getDeviceId()!, memberId: `${c.getUserId()}:${c.getDeviceId()}` },
      [{ ...transport, ...(transport.livekit_service_url ? { livekit_alias: roomId } : {}) }],
      {
        callIntent: "audio",
        manageMediaKeys: false,
        applicationData: voiceAppData(),
      },
    );

    useVoice.setState({ status: "connected", audioBlocked: false, error: null });
    sounds.join();
    applyVolumes();
  } catch (e) {
    console.error(e);
    if (seq !== joinSeq) return;
    nativeActive = false;
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
    .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
      useVoice.setState({ quality: { ...useVoice.getState().quality, [p.identity]: qualityLevel(q) } });
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => useVoice.setState({ audioBlocked: !r.canPlaybackAudio }))
    .on(RoomEvent.ConnectionStateChanged, (st) => {
      if (st === ConnectionState.Reconnecting) useVoice.setState({ error: "Reconectando…" });
      if (st === ConnectionState.Connected) useVoice.setState({ error: null });
    })
    .on(RoomEvent.Disconnected, () => {
      if (lk === r) void leaveVoice(true);
    })
    .on(RoomEvent.EncryptionError, (err, p) => {
      console.error("[e2ee] erro de criptografia de mídia", p?.identity ?? "(local)", err);
    })
    .on(RoomEvent.ParticipantEncryptionStatusChanged, (enabled, p) => {
      console.debug("[e2ee] criptografia", enabled ? "ativa" : "inativa", "para", p?.identity);
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
  if (nativeActive) {
    nativeActive = false;
    nativePrevIds = null;
    void nativeLeave();
  }
  const r = lk;
  const s = session;
  lk = null;
  session = null;
  window.clearTimeout(appDataTimer);
  unwireEncryptionKeys(s);
  useVoice.setState({
    status: "idle",
    roomId: null,
    participants: [],
    watching: {},
    focused: null,
    cameraOn: false,
    screenOn: false,
    error: null,
    encrypted: false,
    quality: {},
  });
  prevStats = null;
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
  if (nativeActive) {
    try {
      await nativeSetMicMuted(muted);
    } catch (e) {
      console.warn(e);
      useVoice.setState({ muted: true });
    }
    refresh();
    scheduleAppDataUpdate();
    return;
  }
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
  if (nativeActive) {
    await nativeSetDeafened(deafened).catch(() => undefined);
    return;
  }
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
  if (nativeActive) {
    alert("Câmera ainda não é suportada no modo nativo de chamada.");
    return;
  }
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
  if (nativeActive) {
    alert("Compartilhar a tela ainda não é suportado no modo nativo de chamada.");
    return;
  }
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
  if (nativeActive) {
    // IDs da webview (enumerateDevices) não correspondem aos do áudio nativo
    console.warn("Troca de dispositivo ainda não suportada no modo nativo de chamada");
    return;
  }
  if (!lk) return;
  try {
    await lk.switchActiveDevice(kind, deviceId);
  } catch (e) {
    console.warn("Falha ao trocar dispositivo", e);
  }
}

export async function resumeAudio() {
  if (nativeActive) return; // não há autoplay block fora da webview
  await lk?.startAudio();
  useVoice.setState({ audioBlocked: false });
}

let prevStats: { time: number; bytes: number } | null = null;

/**
 * Estatísticas agregadas do downlink (SFU -> este cliente), lidas do RTCPeerConnection
 * de recepção. Perda alta/jitter alto aqui = problema de rede entre o SFU e você.
 */
export async function getDownlinkStats(): Promise<DownlinkStats | null> {
  if (!lk) return null;
  try {
    const report = await lk.engine?.pcManager?.subscriber?.getStats?.();
    if (!report) return null;

    let jitterSum = 0;
    let jitterCount = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let bytes = 0;
    let framesDropped = 0;
    let videoCodec: string | null = null;
    const codecs = new Map<string, string>();
    for (const raw of report.values()) {
      const s = raw as Record<string, any>;
      if (s.type === "codec") {
        if (typeof s.mimeType === "string") codecs.set(s.id, s.mimeType);
      } else if (s.type === "inbound-rtp" && !s.isRemote) {
        jitterSum += s.jitter ?? 0;
        jitterCount++;
        packetsLost += Math.max(0, s.packetsLost ?? 0);
        packetsReceived += s.packetsReceived ?? 0;
        bytes += s.bytesReceived ?? 0;
        if (s.kind === "video") {
          framesDropped += s.framesDropped ?? 0;
          if (s.codecId) {
            const mime = codecs.get(s.codecId) ?? "";
            if (mime) videoCodec = mime.split("/")[1] ?? mime;
          }
        }
      }
    }

    const now = performance.now();
    let kbps = 0;
    if (prevStats && now > prevStats.time) {
      kbps = Math.max(0, (bytes - prevStats.bytes) / ((now - prevStats.time) / 1000) / 125);
    }
    prevStats = { time: now, bytes };

    return {
      jitterMs: jitterCount ? (jitterSum / jitterCount) * 1000 : 0,
      lossPct: packetsReceived + packetsLost ? (packetsLost / (packetsReceived + packetsLost)) * 100 : 0,
      kbps,
      framesDropped,
      videoCodec,
    };
  } catch {
    return null;
  }
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
  if (nativeActive) void nativeLeave();
  lk?.disconnect();
});

export { applyAllSubscriptions };
