import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ThemeColors {
  /** barra de servidores */
  bg3: string;
  /** barra de canais / membros */
  bg2: string;
  /** área de chat */
  bg1: string;
  /** menus, popups */
  floating: string;
  text: string;
  muted: string;
}

export const THEME_PRESETS: Record<string, { name: string; colors: ThemeColors; accent: string }> = {
  dark: {
    name: "Escuro",
    accent: "#5865f2",
    colors: { bg3: "#1e1f22", bg2: "#2b2d31", bg1: "#313338", floating: "#111214", text: "#dbdee1", muted: "#949ba4" },
  },
  midnight: {
    name: "Meia-noite",
    accent: "#7c83ff",
    colors: { bg3: "#000000", bg2: "#0b0b0d", bg1: "#121214", floating: "#000000", text: "#e3e5e8", muted: "#8a8e96" },
  },
  light: {
    name: "Claro",
    accent: "#5865f2",
    colors: { bg3: "#e3e5e8", bg2: "#f2f3f5", bg1: "#ffffff", floating: "#ffffff", text: "#2e3338", muted: "#5c5e66" },
  },
  grape: {
    name: "Uva",
    accent: "#c678dd",
    colors: { bg3: "#1a1625", bg2: "#231d33", bg1: "#2b2440", floating: "#140f1f", text: "#e8e3f5", muted: "#9d93b8" },
  },
  forest: {
    name: "Floresta",
    accent: "#3ba55d",
    colors: { bg3: "#141c17", bg2: "#1b261f", bg1: "#213027", floating: "#0e1410", text: "#dfe9e2", muted: "#8ea596" },
  },
  ocean: {
    name: "Oceano",
    accent: "#00a8fc",
    colors: { bg3: "#0d1a26", bg2: "#122333", bg1: "#172c40", floating: "#0a141d", text: "#dbe8f3", muted: "#86a0b8" },
  },
  sunset: {
    name: "Pôr do sol",
    accent: "#ff7a59",
    colors: { bg3: "#22161a", bg2: "#2d1d22", bg1: "#36242a", floating: "#1a1013", text: "#f3e3e0", muted: "#b39492" },
  },
};

export interface BackgroundImage {
  /** data URL da imagem já recortada/posicionada */
  image: string | null;
  dim: number;
  blur: number;
}

export interface AppBackground {
  /** data URL da imagem já recortada/posicionada */
  image: string | null;
  /** brilho da imagem (0.2 = bem escura, 1 = original, 1.5 = mais clara) */
  brightness: number;
  /** escurecimento das bordas (0–1) */
  vignette: number;
  blur: number;
}

export interface AppearanceSettings {
  theme: string; // chave de THEME_PRESETS ou "custom"
  accent: string;
  colors: ThemeColors;
  /** cores dos botões "Criar um servidor" e "Entrar em um servidor" (independem do tema) */
  railColors: { create: string; join: string };
  /** cor dos botões de parar câmera/transmissão (e outros "parar") */
  stopColor: string;
  fontScale: number;
  chatFont: "system" | "inter" | "serif" | "mono" | "rounded";
  density: "cozy" | "compact";
  radius: number;
  avatarShape: "circle" | "rounded" | "square";
  sidebarWidth: number;
  memberListWidth: number;
  showMemberList: boolean;
  chatBackground: BackgroundImage;
  appBackground: AppBackground;
  /** opacidade dos painéis (1 = opaco; transparência = 1 - opacidade) */
  panelOpacity: number;
  timeFormat: "24h" | "12h";
  showSeconds: boolean;
  animations: boolean;
  customCss: string;
}

export interface VoiceSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  videoDeviceId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  autoWatchCameras: boolean;
  autoWatchStreams: boolean;
  sounds: boolean;
  screenResolution: "720p" | "1080p" | "1440p" | "source";
  screenFps: 15 | 30 | 60;
  screenAudio: boolean;
  /** volume por usuário (0–200) */
  userVolumes: Record<string, number>;
  streamVolumes: Record<string, number>;
  /** silenciados só para você (mantém o volume escolhido para quando dessilenciar) */
  userMuted: Record<string, boolean>;
  streamMuted: Record<string, boolean>;
  /**
   * Mistura o áudio remoto via Web Audio (padrão do LiveKit). Em alguns sistemas
   * (Linux/Electron, sample rate do AudioContext diferente do hardware) gera áudio
   * "quebrado/robótico" — desligado, o áudio vai direto pelo elemento <audio>.
   */
  webAudioMix: boolean;
  /** Mostra perda de pacotes/jitter/bitrate da recepção durante a chamada */
  debugStats: boolean;
  /** Na chamada, mostra só os blocos com vídeo (câmera ligada ou transmissão de tela) */
  hideNoVideo: boolean;
  /** Na chamada, esconde as transmissões de tela que você não está assistindo */
  hideUnwatchedStreams: boolean;
}

export interface AdvancedSettings {
  /** URL do serviço JWT do LiveKit (sobrescreve a descoberta automática) */
  livekitServiceUrl: string;
}

/** Tema criado pelo usuário (fica junto dos temas prontos). */
export interface SavedTheme {
  id: string;
  name: string;
  accent: string;
  colors: ThemeColors;
  railColors: { create: string; join: string };
  stopColor: string;
}

interface SettingsState {
  appearance: AppearanceSettings;
  voice: VoiceSettings;
  advanced: AdvancedSettings;
  /** temas salvos pelo usuário (não são apagados por "Restaurar padrões") */
  savedThemes: SavedTheme[];
  setAppearance(p: Partial<AppearanceSettings>): void;
  setVoice(p: Partial<VoiceSettings>): void;
  setAdvanced(p: Partial<AdvancedSettings>): void;
  applyPreset(key: string): void;
  /** Salva as cores atuais como tema; mesmo nome substitui o existente. Devolve o id. */
  saveTheme(name: string): string;
  applySavedTheme(id: string): void;
  deleteSavedTheme(id: string): void;
  reset(): void;
}

/** Chave usada em appearance.theme para um tema salvo. */
export const savedThemeKey = (id: string) => `saved:${id}`;

const defaultAppearance: AppearanceSettings = {
  theme: "dark",
  accent: THEME_PRESETS.dark.accent,
  colors: { ...THEME_PRESETS.dark.colors },
  railColors: { create: "#23a55a", join: "#23a55a" },
  stopColor: "#da373c",
  fontScale: 1,
  chatFont: "system",
  density: "cozy",
  radius: 12,
  avatarShape: "circle",
  sidebarWidth: 240,
  memberListWidth: 240,
  showMemberList: true,
  chatBackground: { image: null, dim: 0.55, blur: 0 },
  appBackground: { image: null, brightness: 0.6, vignette: 0.35, blur: 0 },
  panelOpacity: 1,
  timeFormat: "24h",
  showSeconds: false,
  animations: true,
  customCss: "",
};

const defaultVoice: VoiceSettings = {
  inputDeviceId: "default",
  outputDeviceId: "default",
  videoDeviceId: "",
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  autoWatchCameras: true,
  autoWatchStreams: false,
  sounds: true,
  screenResolution: "1080p",
  screenFps: 30,
  screenAudio: true,
  userVolumes: {},
  streamVolumes: {},
  userMuted: {},
  streamMuted: {},
  webAudioMix: false,
  debugStats: false,
  hideNoVideo: false,
  hideUnwatchedStreams: false,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appearance: defaultAppearance,
      voice: defaultVoice,
      advanced: { livekitServiceUrl: "" },
      savedThemes: [],
      setAppearance: (p) => set((s) => ({ appearance: { ...s.appearance, ...p } })),
      setVoice: (p) => set((s) => ({ voice: { ...s.voice, ...p } })),
      setAdvanced: (p) => set((s) => ({ advanced: { ...s.advanced, ...p } })),
      applyPreset: (key) =>
        set((s) => {
          const p = THEME_PRESETS[key];
          if (!p) return s;
          return { appearance: { ...s.appearance, theme: key, accent: p.accent, colors: { ...p.colors } } };
        }),
      saveTheme: (name) => {
        const trimmed = name.trim().slice(0, 40) || "Meu tema";
        let id = "";
        set((s) => {
          const a = s.appearance;
          const existing = s.savedThemes.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
          id = existing?.id ?? `t${Date.now().toString(36)}`;
          const theme: SavedTheme = {
            id,
            name: trimmed,
            accent: a.accent,
            colors: { ...a.colors },
            railColors: { ...a.railColors },
            stopColor: a.stopColor,
          };
          const savedThemes = existing ? s.savedThemes.map((t) => (t.id === id ? theme : t)) : [...s.savedThemes, theme];
          return { savedThemes, appearance: { ...a, theme: savedThemeKey(id) } };
        });
        return id;
      },
      applySavedTheme: (id) =>
        set((s) => {
          const t = s.savedThemes.find((x) => x.id === id);
          if (!t) return s;
          return {
            appearance: {
              ...s.appearance,
              theme: savedThemeKey(id),
              accent: t.accent,
              colors: { ...t.colors },
              railColors: { ...t.railColors },
              stopColor: t.stopColor,
            },
          };
        }),
      deleteSavedTheme: (id) =>
        set((s) => ({
          savedThemes: s.savedThemes.filter((t) => t.id !== id),
          // As cores continuam aplicadas; só deixa de apontar para o tema apagado
          appearance: s.appearance.theme === savedThemeKey(id) ? { ...s.appearance, theme: "custom" } : s.appearance,
        })),
      reset: () => set({ appearance: defaultAppearance, voice: defaultVoice, advanced: { livekitServiceUrl: "" } }),
    }),
    {
      name: "mc.settings",
      version: 2,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as { appearance?: Record<string, unknown> };
        if (version < 2 && p.appearance) {
          // v2: visual mais arredondado (8px era o padrão antigo) e fundo com brilho/vinheta
          if (p.appearance.radius === 8) p.appearance.radius = 12;
          const old = p.appearance.appBackground as { image?: string | null; dim?: number; blur?: number } | undefined;
          if (old && !("brightness" in old)) {
            p.appearance.appBackground = {
              image: old.image ?? null,
              brightness: 1 - (old.dim ?? 0.4),
              vignette: 0.35,
              blur: old.blur ?? 0,
            };
          }
        }
        return p as unknown as SettingsState;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          appearance: {
            ...defaultAppearance,
            ...p.appearance,
            appBackground: { ...defaultAppearance.appBackground, ...p.appearance?.appBackground },
            railColors: { ...defaultAppearance.railColors, ...p.appearance?.railColors },
          },
          voice: { ...defaultVoice, ...p.voice },
          advanced: { ...current.advanced, ...p.advanced },
          savedThemes: Array.isArray(p.savedThemes)
            ? p.savedThemes
                .filter((t) => t && typeof t.id === "string" && t.colors)
                .map((t) => ({
                  ...t,
                  railColors: { ...defaultAppearance.railColors, ...t.railColors },
                  stopColor: t.stopColor ?? defaultAppearance.stopColor,
                }))
            : [],
        };
      },
    },
  ),
);
