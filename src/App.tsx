import { useEffect, useState } from "react";
import { completeSsoLogin, loadSession, startClient, clearSession, type StoredSession } from "./matrix/client";
import Login from "./components/Login";
import MainLayout from "./components/MainLayout";
import ThemeApplier from "./components/ThemeApplier";
import UserSettingsModal from "./components/modals/UserSettingsModal";
import VerifyPreview from "./components/modals/VerifyPreview";

type Phase = { kind: "boot" } | { kind: "login"; error?: string } | { kind: "loading" } | { kind: "ready" };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });

  const begin = async (s: StoredSession) => {
    setPhase({ kind: "loading" });
    try {
      await startClient(s);
      setPhase({ kind: "ready" });
    } catch (e) {
      clearSession();
      setPhase({ kind: "login", error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Rotas só de desenvolvimento para testar telas sem login
  const previewParam = import.meta.env.DEV ? new URLSearchParams(location.search).get("preview") : null;
  const devPreview = previewParam === "appearance";

  useEffect(() => {
    if (previewParam) return;
    (async () => {
      try {
        const sso = await completeSsoLogin();
        if (sso) return begin(sso);
      } catch (e) {
        return setPhase({ kind: "login", error: "Falha no login SSO: " + (e instanceof Error ? e.message : e) });
      }
      const s = loadSession();
      if (s) begin(s);
      else setPhase({ kind: "login" });
    })();
  }, []);

  if (previewParam === "verify") return <VerifyPreview />;
  if (devPreview) {
    return (
      <>
        <ThemeApplier />
        <UserSettingsModal initialTab="appearance" onClose={() => location.assign("/")} />
      </>
    );
  }

  return (
    <>
      <ThemeApplier />
      {phase.kind === "ready" && <MainLayout />}
      {phase.kind === "login" && <Login initialError={phase.error} onLoggedIn={begin} />}
      {(phase.kind === "boot" || phase.kind === "loading") && (
        <div className="splash">
          <div className="splash-logo" />
          <div className="splash-text">{phase.kind === "loading" ? "Sincronizando com o servidor…" : "Carregando…"}</div>
        </div>
      )}
    </>
  );
}
