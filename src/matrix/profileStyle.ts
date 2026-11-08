/**
 * Aparência do perfil: banner (cor ou imagem) e cor do bloco nas chamadas.
 *
 * Onde fica salvo:
 *  - account data `com.matrixcord.profile` (sempre; sincroniza entre os seus dispositivos)
 *  - perfil estendido MSC4133, quando o servidor suporta → os outros veem o seu banner
 *  - a cor da chamada também vai no estado da chamada (applicationData), então quem
 *    está na chamada com o MatrixCord vê a cor mesmo sem MSC4133.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { ClientEvent, type MatrixEvent } from "matrix-js-sdk";
import { getClient, maybeClient } from "./client";

export const PROFILE_STYLE_KEY = "com.matrixcord.profile";

export interface ProfileStyle {
  /** cor do banner (#rrggbb) */
  bannerColor?: string | null;
  /** imagem do banner (mxc://), tem prioridade sobre a cor */
  bannerImage?: string | null;
  /** cor do fundo do seu bloco nas chamadas */
  callColor?: string | null;
}

interface State {
  /** estilos conhecidos de outras pessoas (perfil estendido ou chamada) */
  others: Record<string, ProfileStyle>;
  mine: ProfileStyle;
  /** o servidor suporta perfis estendidos? null = ainda não sabemos */
  extended: boolean | null;
}

const EMPTY: ProfileStyle = {};

export const useProfileStyles = create<State>(() => ({ others: {}, mine: {}, extended: null }));

function clean(v: unknown): ProfileStyle {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const color = (x: unknown) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : null);
  return {
    bannerColor: color(o.bannerColor),
    bannerImage: typeof o.bannerImage === "string" && o.bannerImage.startsWith("mxc://") ? o.bannerImage : null,
    callColor: color(o.callColor),
  };
}

let extendedCheck: Promise<boolean> | null = null;
function supportsExtended(): Promise<boolean> {
  if (!extendedCheck) {
    extendedCheck = getClient()
      .doesServerSupportExtendedProfiles()
      .catch(() => false)
      .then((ok) => {
        useProfileStyles.setState({ extended: ok });
        return ok;
      });
  }
  return extendedCheck;
}

/** Inicia: lê o seu estilo da account data e acompanha mudanças. */
export function initProfileStyle() {
  const c = getClient();
  const load = () => {
    const ev = c.getAccountData(PROFILE_STYLE_KEY as never);
    useProfileStyles.setState({ mine: clean(ev?.getContent()) });
  };
  load();
  c.on(ClientEvent.AccountData, (ev: MatrixEvent) => {
    if (ev.getType() === PROFILE_STYLE_KEY) load();
  });
  void supportsExtended();
}

/** Salva o seu estilo (account data + perfil estendido, se houver). */
export async function saveMyStyle(patch: Partial<ProfileStyle>) {
  const c = getClient();
  const next = { ...useProfileStyles.getState().mine, ...patch };
  useProfileStyles.setState({ mine: next });
  await c.setAccountData(PROFILE_STYLE_KEY as never, next as never);
  if (await supportsExtended()) {
    try {
      await c.setExtendedProfileProperty(PROFILE_STYLE_KEY, next);
    } catch (e) {
      console.warn("Servidor recusou o perfil estendido", e);
    }
  }
  // A cor da chamada é republicada pelo módulo de voz (ele observa `mine.callColor`)
}

/** Registra o estilo de alguém visto em outro lugar (ex.: estado da chamada). */
export function rememberStyle(userId: string, style: ProfileStyle) {
  const cur = useProfileStyles.getState().others[userId] ?? {};
  const merged = { ...cur };
  let changed = false;
  for (const [k, v] of Object.entries(style) as [keyof ProfileStyle, string | null | undefined][]) {
    if (v && merged[k] !== v) {
      merged[k] = v;
      changed = true;
    }
  }
  if (changed) useProfileStyles.setState((s) => ({ others: { ...s.others, [userId]: merged } }));
}

const fetching = new Set<string>();
/** Busca o perfil estendido de alguém (uma vez por sessão). */
export function fetchStyle(userId: string) {
  const c = maybeClient();
  if (!c || userId === c.getUserId() || fetching.has(userId)) return;
  fetching.add(userId);
  void (async () => {
    if (!(await supportsExtended())) return;
    try {
      const v = await c.getExtendedProfileProperty(userId, PROFILE_STYLE_KEY);
      const st = clean(v);
      // Os dados do perfil têm prioridade, mas não apagam a cor vista na chamada
      useProfileStyles.setState((s) => ({ others: { ...s.others, [userId]: { ...s.others[userId], ...stripEmpty(st) } } }));
    } catch {
      /* a pessoa não definiu nada */
    }
  })();
}

function stripEmpty(st: ProfileStyle): ProfileStyle {
  return Object.fromEntries(Object.entries(st).filter(([, v]) => !!v)) as ProfileStyle;
}

/** Estilo de um usuário (o seu vem da account data). */
export function useProfileStyle(userId: string | undefined): ProfileStyle {
  const isMe = !!userId && userId === maybeClient()?.getUserId();
  const style = useProfileStyles((s) => (!userId ? undefined : isMe ? s.mine : s.others[userId]));
  useEffect(() => {
    if (userId && !isMe) fetchStyle(userId);
  }, [userId, isMe]);
  return style ?? EMPTY;
}

/** Cor escolhida para o bloco de alguém na chamada (null = automática). */
export function useCallColor(userId: string): string | null {
  const isMe = userId === maybeClient()?.getUserId();
  return useProfileStyles((s) => (isMe ? s.mine.callColor : s.others[userId]?.callColor) ?? null);
}

export function getMyCallColor(): string | null {
  return useProfileStyles.getState().mine.callColor ?? null;
}
