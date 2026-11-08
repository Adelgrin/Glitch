import { useEffect } from "react";
import { useSettings } from "../store/settings";

const FONTS: Record<string, string> = {
  system: `"gg sans", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`,
  inter: `Inter, "Segoe UI", system-ui, sans-serif`,
  serif: `Georgia, "Times New Roman", serif`,
  mono: `"Cascadia Code", Consolas, "Fira Code", monospace`,
  rounded: `"Nunito", "Varela Round", "Segoe UI", system-ui, sans-serif`,
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Aplica as configurações de aparência como variáveis CSS no :root. */
export default function ThemeApplier() {
  const a = useSettings((s) => s.appearance);

  useEffect(() => {
    const root = document.documentElement;
    const set = (k: string, v: string) => root.style.setProperty(k, v);
    const { colors } = a;
    const isLight = luminance(colors.bg1) > 0.5;
    set("--bg1", colors.bg1);
    set("--bg2", colors.bg2);
    set("--bg3", colors.bg3);
    set("--floating", colors.floating);
    set("--text", colors.text);
    set("--muted", colors.muted);
    set("--accent", a.accent);
    set("--accent-rgb", hexToRgb(a.accent).join(","));
    set("--on-accent", luminance(a.accent) > 0.55 ? "#111" : "#fff");
    set("--hover", isLight ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.06)");
    set("--active", isLight ? "rgba(0,0,0,.1)" : "rgba(255,255,255,.1)");
    set("--border", isLight ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.08)");
    set("--input", isLight ? "rgba(0,0,0,.06)" : "rgba(0,0,0,.25)");
    set("--radius", `${a.radius}px`);
    set("--font-scale", String(a.fontScale));
    set("--font", FONTS[a.chatFont] ?? FONTS.system);
    set("--sidebar-w", `${a.sidebarWidth}px`);
    set("--members-w", `${a.memberListWidth}px`);
    set("--panel-opacity", String(a.panelOpacity));
    set("--avatar-radius", a.avatarShape === "circle" ? "50%" : a.avatarShape === "rounded" ? "30%" : "6px");
    set("--chat-dim", String(a.chatBackground.dim));
    set("--chat-blur", `${a.chatBackground.blur}px`);
    set("--app-brightness", String(a.appBackground.brightness));
    set("--app-vignette", String(a.appBackground.vignette));
    set("--app-blur", `${a.appBackground.blur}px`);
    root.style.fontSize = `${16 * a.fontScale}px`;
    root.dataset.density = a.density;
    root.dataset.light = String(isLight);
    root.dataset.anim = String(a.animations);
    root.style.colorScheme = isLight ? "light" : "dark";
  }, [a]);

  return a.customCss ? <style id="mc-custom-css">{a.customCss}</style> : null;
}
