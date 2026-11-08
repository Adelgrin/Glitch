/**
 * Verificação de sessões por comparação de emojis (SAS), compatível com o Element.
 *
 * Fluxo típico numa sessão nova:
 *  1. requestOwnUserVerification() → os outros dispositivos recebem o pedido
 *  2. o outro dispositivo aceita (fase Ready) → iniciamos o SAS (m.sas.v1)
 *  3. os dois lados mostram os mesmos 7 emojis → o usuário confirma
 *  4. a sessão fica assinada (cross-signing) e o outro dispositivo envia por
 *     "secret sharing" a chave do backup → baixamos as chaves das mensagens antigas.
 */
import { create } from "zustand";
import {
  CryptoEvent,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from "matrix-js-sdk/lib/crypto-api/index.js";
import type { MatrixClient } from "matrix-js-sdk";

export const SAS_METHOD = "m.sas.v1";

export interface OwnDevice {
  deviceId: string;
  name: string;
  verified: boolean;
  current: boolean;
  lastSeen?: number;
}

export interface SecurityStatus {
  loaded: boolean;
  /** a conta tem chaves de assinatura cruzada publicadas */
  crossSigningSetUp: boolean;
  /** esta sessão está verificada (assinada pela identidade da conta) */
  thisDeviceVerified: boolean;
  /** temos as chaves privadas de cross-signing (podemos verificar outras sessões) */
  canSignOthers: boolean;
  backupVersion: string | null;
  backupKeyCached: boolean;
  backupActive: boolean;
  devices: OwnDevice[];
}

export interface RestoreProgress {
  running: boolean;
  done: number;
  total: number;
  imported?: number;
  error?: string;
}

interface VerificationState {
  status: SecurityStatus;
  /** pedido em andamento (enviado ou recebido) */
  request: VerificationRequest | null;
  phase: VerificationPhase | null;
  sas: ShowSasCallbacks | null;
  /** já confirmamos os emojis e esperamos o outro lado */
  confirmed: boolean;
  error: string | null;
  /** modal aberto */
  open: boolean;
  restore: RestoreProgress | null;
  /** esta sessão era nova e está recebendo as chaves do outro dispositivo */
  receivingKeys: boolean;
  /** força re-render quando o objeto do pedido muda internamente */
  tick: number;
}

const EMPTY_STATUS: SecurityStatus = {
  loaded: false,
  crossSigningSetUp: false,
  thisDeviceVerified: false,
  canSignOthers: false,
  backupVersion: null,
  backupKeyCached: false,
  backupActive: false,
  devices: [],
};

export const useVerification = create<VerificationState>(() => ({
  status: EMPTY_STATUS,
  request: null,
  phase: null,
  sas: null,
  confirmed: false,
  error: null,
  open: false,
  restore: null,
  receivingKeys: false,
  tick: 0,
}));

let client: MatrixClient | null = null;
let attachedVerifier: Verifier | null = null;
let detachRequest: (() => void) | null = null;
/** depois de uma auto-verificação concluída, restaura o backup assim que a chave chegar */
let restoreAfterKey = false;

const set = useVerification.setState;
const get = useVerification.getState;

function crypto() {
  return client?.getCrypto() ?? null;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshStatus(), 300);
}

export async function refreshStatus() {
  const c = client;
  const cr = crypto();
  if (!c || !cr) return;
  const me = c.getUserId()!;
  const myDevice = c.getDeviceId()!;
  try {
    const [crossSigningSetUp, ownStatus, csStatus, backupInfo, backupKey, activeBackup] = await Promise.all([
      cr.userHasCrossSigningKeys(me, true),
      cr.getDeviceVerificationStatus(me, myDevice),
      cr.getCrossSigningStatus(),
      cr.getKeyBackupInfo().catch(() => null),
      cr.getSessionBackupPrivateKey().catch(() => null),
      cr.getActiveSessionBackupVersion().catch(() => null),
    ]);

    // Lista de sessões: nomes vêm do /devices, chaves/verificação do crypto
    const devices: OwnDevice[] = [];
    try {
      const [{ devices: serverDevices }, deviceMap] = await Promise.all([c.getDevices(), cr.getUserDeviceInfo([me], true)]);
      const cryptoDevices = deviceMap.get(me);
      for (const d of serverDevices) {
        const st = cryptoDevices?.has(d.device_id) ? await cr.getDeviceVerificationStatus(me, d.device_id) : null;
        devices.push({
          deviceId: d.device_id,
          name: d.display_name || d.device_id,
          verified: !!st?.crossSigningVerified,
          current: d.device_id === myDevice,
          lastSeen: d.last_seen_ts,
        });
      }
      devices.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    } catch {
      /* lista de dispositivos é opcional */
    }

    set({
      status: {
        loaded: true,
        crossSigningSetUp,
        thisDeviceVerified: !!ownStatus?.crossSigningVerified,
        canSignOthers: csStatus.privateKeysCachedLocally.selfSigningKey && csStatus.privateKeysCachedLocally.masterKey,
        backupVersion: backupInfo?.version ?? null,
        backupKeyCached: !!backupKey,
        backupActive: !!activeBackup,
        devices,
      },
    });
  } catch (e) {
    console.warn("Falha ao ler o status de segurança", e);
  }
}

/* ------------------------------------------------------------------ */
/* Pedido de verificação                                               */
/* ------------------------------------------------------------------ */

function track(req: VerificationRequest) {
  detachRequest?.();
  attachedVerifier = null;
  // Se esta sessão ainda não é confiável, é ela quem vai receber as chaves no fim
  const wasUnverified = !get().status.thisDeviceVerified;
  let finished = false;
  set({ request: req, phase: req.phase, sas: null, confirmed: false, error: null, open: true, receivingKeys: false });

  const onChange = () => {
    if (get().request !== req) return;
    set((s) => ({ phase: req.phase, tick: s.tick + 1 }));

    // Quem pediu inicia a comparação de emojis assim que o outro lado aceita
    if (req.phase === VerificationPhase.Ready && req.initiatedByMe && !req.verifier) {
      void beginSas();
    }
    // O outro lado iniciou (ou nós iniciamos): conecta ao verificador
    if (req.verifier && req.verifier !== attachedVerifier) attachVerifier(req.verifier);

    if (req.phase === VerificationPhase.Done && !finished) {
      finished = true;
      onDone(req, wasUnverified);
    }
    if (req.phase === VerificationPhase.Cancelled) {
      set({ sas: null, error: cancelReason(req) });
    }
  };
  req.on(VerificationRequestEvent.Change, onChange);
  detachRequest = () => req.off(VerificationRequestEvent.Change, onChange);
  onChange();
}

function attachVerifier(v: Verifier) {
  attachedVerifier = v;
  v.on(VerifierEvent.ShowSas, (sas) => {
    if (attachedVerifier === v) set({ sas });
  });
  v.on(VerifierEvent.Cancel, () => {
    if (attachedVerifier === v) set({ sas: null });
  });
  const existing = v.getShowSasCallbacks();
  if (existing) set({ sas: existing });
  // verify() envia o "accept" se o outro lado começou, ou aguarda o fim
  v.verify().catch(() => {
    /* o motivo aparece via VerificationPhase.Cancelled */
  });
}

function cancelReason(req: VerificationRequest): string {
  const byMe = req.cancellingUserId === client?.getUserId() && !req.isSelfVerification;
  switch (req.cancellationCode) {
    case "m.mismatched_sas":
      return "Os emojis não combinaram. Por segurança, a verificação foi cancelada.";
    case "m.timeout":
      return "O tempo para concluir a verificação acabou.";
    case "m.user":
      return byMe ? "Você cancelou a verificação." : "A verificação foi cancelada.";
    case "m.accepted":
      return "O pedido foi aceito por outro dispositivo.";
    case "m.unknown_method":
    case "m.unexpected_message":
      return "O outro dispositivo não suporta a verificação por emojis.";
    default:
      return "A verificação foi cancelada" + (req.cancellationCode ? ` (${req.cancellationCode}).` : ".");
  }
}

function onDone(req: VerificationRequest, wasUnverified: boolean) {
  scheduleRefresh();
  if (req.isSelfVerification && wasUnverified) {
    set({ receivingKeys: true });
    restoreAfterKey = true;
    // A chave do backup chega logo depois por secret sharing; se já estiver aqui, restaura já
    void (async () => {
      for (let i = 0; i < 20 && restoreAfterKey; i++) {
        const key = await crypto()?.getSessionBackupPrivateKey().catch(() => null);
        if (key) return void startRestore();
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!restoreAfterKey) return;
      restoreAfterKey = false;
      const info = await crypto()?.getKeyBackupInfo().catch(() => null);
      set({
        restore: {
          running: false,
          done: 0,
          total: 0,
          error: info
            ? "o outro dispositivo não enviou a chave do backup. Tente “Restaurar chaves” em Configurações › Segurança mais tarde."
            : "sua conta não tem backup de chaves no servidor. Mensagens novas funcionam normalmente; as antigas só podem ser lidas em sessões que já as tinham.",
        },
      });
      scheduleRefresh();
    })();
  }
}

export async function startSelfVerification() {
  const cr = crypto();
  if (!cr) return;
  set({ open: true, error: null, request: null, phase: null, sas: null, restore: null });
  try {
    const req = await cr.requestOwnUserVerification();
    track(req);
  } catch (e) {
    set({ error: "Não foi possível enviar o pedido: " + errMsg(e) });
  }
}

/** Verifica outra sessão minha a partir desta (esta precisa estar verificada). */
export async function verifyOtherDevice(deviceId: string) {
  const cr = crypto();
  const c = client;
  if (!cr || !c) return;
  set({ open: true, error: null, request: null, phase: null, sas: null, restore: null });
  try {
    const req = await cr.requestDeviceVerification(c.getUserId()!, deviceId);
    track(req);
  } catch (e) {
    set({ error: "Não foi possível enviar o pedido: " + errMsg(e) });
  }
}

export async function beginSas() {
  const req = get().request;
  if (!req || req.verifier) return;
  try {
    const v = await req.startVerification(SAS_METHOD);
    if (get().request === req && v !== attachedVerifier) attachVerifier(v);
  } catch (e) {
    // Colisão (os dois lados começaram ao mesmo tempo) é resolvida pelo SDK
    if (!req.verifier) set({ error: "Falha ao iniciar a comparação: " + errMsg(e) });
  }
}

export async function acceptIncoming() {
  const req = get().request;
  if (!req) return;
  try {
    await req.accept();
  } catch (e) {
    set({ error: "Falha ao aceitar: " + errMsg(e) });
  }
}

export async function confirmSas() {
  const sas = get().sas;
  if (!sas) return;
  set({ confirmed: true });
  try {
    await sas.confirm();
  } catch (e) {
    set({ confirmed: false, error: "Falha ao confirmar: " + errMsg(e) });
  }
}

export function mismatchSas() {
  get().sas?.mismatch();
  set({ sas: null });
}

/** Fecha o modal; cancela o pedido se ainda estiver em andamento. */
export function closeVerification() {
  const req = get().request;
  if (req && req.phase !== VerificationPhase.Done && req.phase !== VerificationPhase.Cancelled) {
    req.cancel().catch(() => undefined);
  }
  detachRequest?.();
  detachRequest = null;
  attachedVerifier = null;
  set({ open: false, request: null, phase: null, sas: null, confirmed: false, error: null, receivingKeys: false });
}

export function openVerification() {
  set({ open: true });
}

/* ------------------------------------------------------------------ */
/* Backup de chaves                                                    */
/* ------------------------------------------------------------------ */

export async function startRestore() {
  restoreAfterKey = false;
  const cr = crypto();
  if (!cr || get().restore?.running) return;
  set({ restore: { running: true, done: 0, total: 0 } });
  try {
    await cr.checkKeyBackupAndEnable();
    const res = await cr.restoreKeyBackup({
      progressCallback: (p) => {
        if ("successes" in p) {
          set({ restore: { running: true, done: p.successes + p.failures, total: p.total } });
        }
      },
    });
    set({ restore: { running: false, done: res.total, total: res.total, imported: res.imported } });
  } catch (e) {
    set({ restore: { running: false, done: 0, total: 0, error: errMsg(e) } });
  }
  scheduleRefresh();
}

/* ------------------------------------------------------------------ */
/* Inicialização                                                       */
/* ------------------------------------------------------------------ */

export function initVerification(c: MatrixClient) {
  client = c;
  if (!c.getCrypto()) return;

  c.on(CryptoEvent.VerificationRequestReceived, (req) => {
    // Só mostramos pedidos para verificação interativa ainda pendentes
    if (req.phase !== VerificationPhase.Requested) return;
    const cur = get().request;
    if (cur && cur.phase !== VerificationPhase.Done && cur.phase !== VerificationPhase.Cancelled) {
      // Já há uma verificação em andamento; se for a "outra ponta" da mesma, o SDK a reaproveita
      if (cur !== req) req.cancel().catch(() => undefined);
      return;
    }
    track(req);
  });

  c.on(CryptoEvent.KeyBackupDecryptionKeyCached, () => {
    scheduleRefresh();
    if (restoreAfterKey) void startRestore();
  });
  c.on(CryptoEvent.UserTrustStatusChanged, (userId) => {
    if (userId === c.getUserId()) scheduleRefresh();
  });
  c.on(CryptoEvent.DevicesUpdated, (users) => {
    if (users.includes(c.getUserId()!)) scheduleRefresh();
  });
  c.on(CryptoEvent.KeysChanged, scheduleRefresh);
  c.on(CryptoEvent.KeyBackupStatus, scheduleRefresh);
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ */
/* Nomes dos emojis em português (lista fixa da especificação Matrix)  */
/* ------------------------------------------------------------------ */

const EMOJI_PT: Record<string, string> = {
  Dog: "Cachorro",
  Cat: "Gato",
  Lion: "Leão",
  Horse: "Cavalo",
  Unicorn: "Unicórnio",
  Pig: "Porco",
  Elephant: "Elefante",
  Rabbit: "Coelho",
  Panda: "Panda",
  Rooster: "Galo",
  Penguin: "Pinguim",
  Turtle: "Tartaruga",
  Fish: "Peixe",
  Octopus: "Polvo",
  Butterfly: "Borboleta",
  Flower: "Flor",
  Tree: "Árvore",
  Cactus: "Cacto",
  Mushroom: "Cogumelo",
  Globe: "Globo",
  Moon: "Lua",
  Cloud: "Nuvem",
  Fire: "Fogo",
  Banana: "Banana",
  Apple: "Maçã",
  Strawberry: "Morango",
  Corn: "Milho",
  Pizza: "Pizza",
  Cake: "Bolo",
  Heart: "Coração",
  Smiley: "Sorriso",
  Robot: "Robô",
  Hat: "Chapéu",
  Glasses: "Óculos",
  Spanner: "Chave inglesa",
  Wrench: "Chave inglesa",
  Santa: "Papai Noel",
  "Thumbs Up": "Joinha",
  "Thumbs up": "Joinha",
  Umbrella: "Guarda-chuva",
  Hourglass: "Ampulheta",
  Clock: "Relógio",
  Gift: "Presente",
  "Light Bulb": "Lâmpada",
  Book: "Livro",
  Pencil: "Lápis",
  Paperclip: "Clipe",
  Scissors: "Tesoura",
  Lock: "Cadeado",
  Key: "Chave",
  Hammer: "Martelo",
  Telephone: "Telefone",
  Flag: "Bandeira",
  Train: "Trem",
  Bicycle: "Bicicleta",
  Aeroplane: "Avião",
  Rocket: "Foguete",
  Trophy: "Troféu",
  Ball: "Bola",
  Guitar: "Guitarra",
  Trumpet: "Trompete",
  Bell: "Sino",
  Anchor: "Âncora",
  Headphones: "Fones de ouvido",
  Folder: "Pasta",
  Pin: "Alfinete",
};

export function emojiName(english: string) {
  return EMOJI_PT[english] ?? english;
}
