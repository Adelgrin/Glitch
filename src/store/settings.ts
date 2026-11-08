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

export interface AppearanceSettings {
  theme: string; // chave de THEME_PRESETS ou "custom"
  accent: string;
  colors: ThemeColors;
  fontScale: number;
  chatFont: "system" | "inter" | "serif" | "mono" | "rounded";
  density: "cozy" | "compact";
  radius: number;
  avatarShape: "circle" | "rounded" | "square";
  sidebarWidth: number;
  memberListWidth: number;
  showMemberList: boolean;
  chatBackground: BackgroundImage;
  appBackground: BackgroundImage;
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
}

export interface AdvancedSettings {
  /** URL do serviço JWT do LiveKit (sobrescreve a descoberta automática) */
  livekitServiceUrl: string;
}

interface SettingsState {
  appearance: AppearanceSettings;
  voice: VoiceSettings;
  advanced: AdvancedSettings;
  setAppearance(p: Partial<AppearanceSettings>): void;
  setVoice(p: Partial<VoiceSettings>): void;
  setAdvanced(p: Partial<AdvancedSettings>): void;
  applyPreset(key: string): void;
  reset(): void;
}

const defaultAppearance: AppearanceSettings = {
  theme: "dark",
  accent: THEME_PRESETS.dark.accent,
  colors: { ...THEME_PRESETS.dark.colors },
  fontScale: 1,
  chatFont: "system",
  density: "cozy",
  radius: 8,
  avatarShape: "circle",
  sidebarWidth: 240,
  memberListWidth: 240,
  showMemberList: true,
  chatBackground: { image: null, dim: 0.55, blur: 0 },
  appBackground: { image: null, dim: 0.6, blur: 0 },
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
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appearance: defaultAppearance,
      voice: defaultVoice,
      advanced: { livekitServiceUrl: "" },
      setAppearance: (p) => set((s) => ({ appearance: { ...s.appearance, ...p } })),
      setVoice: (p) => set((s) => ({ voice: { ...s.voice, ...p } })),
      setAdvanced: (p) => set((s) => ({ advanced: { ...s.advanced, ...p } })),
      applyPreset: (key) =>
        set((s) => {
          const p = THEME_PRESETS[key];
          if (!p) return s;
          return { appearance: { ...s.appearance, theme: key, accent: p.accent, colors: { ...p.colors } } };
        }),
      reset: () => set({ appearance: defaultAppearance, voice: defaultVoice, advanced: { livekitServiceUrl: "" } }),
    }),
    {
      name: "mc.settings",
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          appearance: { ...defaultAppearance, ...p.appearance },
          voice: { ...defaultVoice, ...p.voice },
          advanced: { ...current.advanced, ...p.advanced },
        };
      },
    },
  ),
);
