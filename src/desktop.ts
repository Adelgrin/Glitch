/**
 * Integração com o app de desktop em Tauri. No navegador (e no Electron) não faz nada.
 */

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Links externos (target=_blank) abrem no navegador padrão, não numa janela nova do app. */
function interceptExternalLinks() {
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.href;
      const external = /^(https?:|mailto:)/i.test(href) && (a.target === "_blank" || new URL(href, location.href).origin !== location.origin);
      if (!external) return;
      e.preventDefault();
      void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch((err) => console.warn("Falha ao abrir link", err));
    },
    true,
  );
}

export function initDesktop() {
  if (!isTauri) return;
  document.documentElement.dataset.desktop = "tauri";
  interceptExternalLinks();
}
