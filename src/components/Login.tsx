import { useState } from "react";
import { getLoginFlows, loginWithPassword, startSsoLogin, type StoredSession } from "../matrix/client";

interface Props {
  initialError?: string;
  onLoggedIn(s: StoredSession): void;
}

export default function Login({ initialError, onLoggedIn }: Props) {
  const [homeserver, setHomeserver] = useState("matrix.org");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await loginWithPassword(homeserver, username, password);
      onLoggedIn(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /M_FORBIDDEN|Invalid/i.test(msg)
          ? "Usuário ou senha incorretos."
          : /Unrecognized|M_UNRECOGNIZED|M_UNKNOWN/i.test(msg)
            ? "Este servidor não aceita login por senha. Tente “Entrar com SSO”."
            : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const sso = async () => {
    setBusy(true);
    setError("");
    try {
      const { flows } = await getLoginFlows(homeserver);
      if (!flows.some((f) => f.type === "m.login.sso" || f.type === "m.login.cas")) {
        throw new Error("Este servidor não oferece login SSO.");
      }
      await startSsoLogin(homeserver);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="splash-logo small" />
          <div>
            <h1>Boas-vindas de volta!</h1>
            <p className="muted">Entre com sua conta Matrix para continuar.</p>
          </div>
        </div>

        <label className="field">
          <span>Servidor (homeserver)</span>
          <input value={homeserver} onChange={(e) => setHomeserver(e.target.value)} placeholder="matrix.org" />
        </label>
        <label className="field">
          <span>Usuário</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="seunome ou @seunome:servidor"
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <button type="button" className="btn secondary block" onClick={sso} disabled={busy}>
          Entrar com SSO
        </button>
        <p className="muted small center">
          Funciona com qualquer servidor Matrix (Synapse, Conduit, Dendrite…). Chamadas de voz usam MatrixRTC + LiveKit,
          compatíveis com o Element Call.
        </p>
      </form>
    </div>
  );
}
