import {
  AutoDiscovery,
  ClientEvent,
  createClient,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  SyncState,
  UserEvent,
  MatrixEventEvent,
  type MatrixClient,
} from "matrix-js-sdk";
import { useAppStore } from "../store/app";
import { initVerification, refreshStatus, SAS_METHOD } from "./verification";

const SESSION_KEY = "mc.session";
const PENDING_SSO_KEY = "mc.pendingSso";
const DEVICE_NAME = "MatrixCord Web";

export interface StoredSession {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
}

let client: MatrixClient | null = null;

export function getClient(): MatrixClient {
  if (!client) throw new Error("Cliente Matrix não iniciado");
  return client;
}

export function maybeClient(): MatrixClient | null {
  return client;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(s: StoredSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

/** Descobre a URL do homeserver a partir de um domínio (via .well-known). */
export async function resolveHomeserver(input: string): Promise<string> {
  let s = input.trim().replace(/\/+$/, "");
  if (!s) s = "matrix.org";
  if (/^https?:\/\//i.test(s)) return s;
  try {
    const cfg = await AutoDiscovery.findClientConfig(s);
    const hs = cfg["m.homeserver"];
    if (hs?.base_url && (hs.state === "SUCCESS" || hs.state === "PROMPT")) {
      return hs.base_url.replace(/\/+$/, "");
    }
  } catch {
    /* cai para https://dominio */
  }
  return `https://${s}`;
}

function splitUser(username: string, homeserver: string) {
  let user = username.trim();
  let server = homeserver.trim();
  const m = /^@([^:]+):(.+)$/.exec(user);
  if (m) {
    user = m[1];
    if (!server) server = m[2];
  }
  return { user, server };
}

export async function getLoginFlows(homeserver: string) {
  const baseUrl = await resolveHomeserver(homeserver);
  const tmp = createClient({ baseUrl });
  const flows = await tmp.loginFlows();
  return { baseUrl, flows: flows.flows };
}

export async function loginWithPassword(homeserver: string, username: string, password: string) {
  const { user, server } = splitUser(username, homeserver);
  const baseUrl = await resolveHomeserver(server);
  const tmp = createClient({ baseUrl });
  const res = await tmp.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user },
    password,
    initial_device_display_name: DEVICE_NAME,
  });
  const session: StoredSession = {
    baseUrl: res.well_known?.["m.homeserver"]?.base_url?.replace(/\/+$/, "") ?? baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
  };
  saveSession(session);
  return session;
}

/** Redireciona para o login SSO do servidor. */
export async function startSsoLogin(homeserver: string, idpId?: string) {
  const baseUrl = await resolveHomeserver(homeserver);
  const tmp = createClient({ baseUrl });
  sessionStorage.setItem(PENDING_SSO_KEY, baseUrl);
  const redirect = window.location.origin + window.location.pathname;
  window.location.href = tmp.getSsoLoginUrl(redirect, "sso", idpId);
}

/** Conclui o login SSO se a URL tiver ?loginToken=... */
export async function completeSsoLogin(): Promise<StoredSession | null> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("loginToken");
  const baseUrl = sessionStorage.getItem(PENDING_SSO_KEY);
  if (!token || !baseUrl) return null;
  sessionStorage.removeItem(PENDING_SSO_KEY);
  window.history.replaceState({}, "", window.location.pathname);
  const tmp = createClient({ baseUrl });
  const res = await tmp.loginRequest({
    type: "m.login.token",
    token,
    initial_device_display_name: DEVICE_NAME,
  });
  const session: StoredSession = {
    baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
  };
  saveSession(session);
  return session;
}

let bumpScheduled = false;
function scheduleBump() {
  if (bumpScheduled) return;
  bumpScheduled = true;
  requestAnimationFrame(() => {
    bumpScheduled = false;
    useAppStore.getState().bump();
  });
}

export async function startClient(session: StoredSession): Promise<MatrixClient> {
  const c = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    timelineSupport: true,
    useAuthorizationHeader: true,
    // Só comparação de emojis: assim o Element não oferece QR code, que ainda não suportamos
    verificationMethods: [SAS_METHOD],
  });
  client = c;

  try {
    await c.initRustCrypto();
    useAppStore.getState().setCryptoReady(true);
  } catch (e) {
    console.warn("Criptografia indisponível — salas criptografadas não serão lidas.", e);
    useAppStore.getState().setCryptoReady(false);
  }

  // Qualquer mudança relevante re-renderiza a interface (agrupado por frame).
  c.on(ClientEvent.Room, scheduleBump);
  c.on(ClientEvent.DeleteRoom, scheduleBump);
  c.on(ClientEvent.AccountData, scheduleBump);
  c.on(RoomEvent.Timeline, scheduleBump);
  c.on(RoomEvent.Redaction, scheduleBump);
  c.on(RoomEvent.Name, scheduleBump);
  c.on(RoomEvent.MyMembership, scheduleBump);
  c.on(RoomEvent.Receipt, scheduleBump);
  c.on(RoomEvent.LocalEchoUpdated, scheduleBump);
  c.on(RoomStateEvent.Events, scheduleBump);
  c.on(RoomStateEvent.Members, scheduleBump);
  c.on(RoomMemberEvent.Typing, scheduleBump);
  c.on(RoomMemberEvent.Membership, scheduleBump);
  c.on(RoomMemberEvent.Name, scheduleBump);
  c.on(UserEvent.Presence, scheduleBump);
  c.on(UserEvent.AvatarUrl, scheduleBump);
  c.on(UserEvent.DisplayName, scheduleBump);
  c.on(MatrixEventEvent.Decrypted, scheduleBump);
  c.on(MatrixEventEvent.Replaced, scheduleBump);

  const firstSync = new Promise<void>((resolve, reject) => {
    c.on(ClientEvent.Sync, (state, _prev, data) => {
      useAppStore.getState().setSyncState(state);
      if (state === SyncState.Prepared || state === SyncState.Syncing) {
        resolve();
      } else if (state === SyncState.Error && (data?.error as { errcode?: string } | undefined)?.errcode === "M_UNKNOWN_TOKEN") {
        reject(new Error("Sessão expirada. Faça login novamente."));
      }
    });
  });

  // Antes do primeiro sync, para não perder pedidos de verificação que chegam nele
  initVerification(c);
  await c.startClient({ initialSyncLimit: 30, lazyLoadMembers: true, threadSupport: false });
  await firstSync;
  void refreshStatus();
  scheduleBump();
  return c;
}

export async function logout() {
  const c = client;
  client = null;
  localStorage.removeItem(SESSION_KEY);
  if (c) {
    try {
      await c.logout(true);
    } catch {
      /* ignora */
    }
    c.stopClient();
    try {
      await c.clearStores();
    } catch {
      /* ignora */
    }
  }
  window.location.reload();
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
