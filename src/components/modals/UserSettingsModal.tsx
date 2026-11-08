import { useEffect, useRef, useState } from "react";
import { getClient, logout } from "../../matrix/client";
import { uploadBlob, useMxc } from "../../matrix/media";
import { useAppStore, useVersion } from "../../store/app";
import { THEME_PRESETS, useSettings, type AppearanceSettings, type ThemeColors } from "../../store/settings";
import { switchDevice, useVoice } from "../../voice/voice";
import Avatar from "../Avatar";
import { ImageField } from "./Modal";
import { EscClose } from "./ServerSettingsModal";
import { IconShieldAlert, IconShieldCheck, IconX } from "../icons";
import { refreshStatus, startRestore, startSelfVerification, useVerification, verifyOtherDevice } from "../../matrix/verification";
import { RestoreStatus } from "./VerificationModal";

type Tab = "account" | "security" | "appearance" | "voice" | "advanced";

export default function UserSettingsModal({ onClose, initialTab }: { onClose(): void; initialTab?: string }) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? "account");
  return (
    <div className="settings-page">
      <nav className="settings-nav">
        <div className="settings-nav-inner">
          <div className="section-label">Configurações de usuário</div>
          <button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}>
            Minha conta
          </button>
          <button className={tab === "security" ? "active" : ""} onClick={() => setTab("security")}>
            Segurança
          </button>
          <div className="section-label">Configurações do app</div>
          <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>
            Aparência
          </button>
          <button className={tab === "voice" ? "active" : ""} onClick={() => setTab("voice")}>
            Voz e vídeo
          </button>
          <button className={tab === "advanced" ? "active" : ""} onClick={() => setTab("advanced")}>
            Avançado
          </button>
          <div className="dropdown-sep" />
          <button className="danger" onClick={() => confirm("Sair da conta neste dispositivo?") && logout()}>
            Sair
          </button>
        </div>
      </nav>
      <div className="settings-content">
        <div className="settings-content-inner">
          {tab === "account" && <Account />}
          {tab === "security" && <Security />}
          {tab === "appearance" && <Appearance />}
          {tab === "voice" && <VoiceVideo />}
          {tab === "advanced" && <Advanced />}
        </div>
        <button className="settings-close" onClick={onClose} title="Fechar (Esc)">
          <IconX />
          <span>ESC</span>
        </button>
      </div>
      <EscClose onClose={onClose} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Account() {
  useVersion();
  const c = getClient();
  const me = c.getUserId()!;
  const user = c.getUser(me);
  const [name, setName] = useState(user?.displayName ?? "");
  const [msg, setMsg] = useState("");
  const cryptoReady = useAppStore((s) => s.cryptoReady);
  const avatarUrl = useMxc(user?.avatarUrl, 256);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg("");
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg("Erro: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <>
      <h2>Minha conta</h2>
      <div className="account-card">
        <div className="account-banner" />
        <div className="account-row">
          <ImageField
            preview={avatarUrl}
            aspect={1}
            shape="circle"
            outputWidth={512}
            boxWidth={96}
            label="Avatar"
            onResult={(r) =>
              run(async () => {
                const url = await uploadBlob(r.blob, r.original ? "avatar.gif" : "avatar.png");
                await c.setAvatarUrl(url);
              }, "Avatar atualizado!")
            }
            onRemove={() => run(() => c.setAvatarUrl(""), "Avatar removido")}
            placeholder={<Avatar name={user?.displayName ?? me} id={me} size={96} />}
          />
        </div>
        <label className="field">
          <span>Nome de exibição</span>
          <div className="row gap">
            <input className="grow" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary small" onClick={() => run(() => c.setDisplayName(name), "Nome atualizado!")}>
              Salvar
            </button>
          </div>
        </label>
        <div className="kv">
          <span>ID de usuário</span>
          <span className="selectable">{me}</span>
          <span>Dispositivo</span>
          <span className="selectable">{c.getDeviceId()}</span>
          <span>Servidor</span>
          <span className="selectable">{c.getHomeserverUrl()}</span>
          <span>Criptografia</span>
          <span>{cryptoReady ? "Ativa (as chaves ficam neste navegador)" : "Indisponível"}</span>
        </div>
        {msg && <p className="small">{msg}</p>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Security() {
  const cryptoReady = useAppStore((s) => s.cryptoReady);
  const status = useVerification((s) => s.status);
  const restore = useVerification((s) => s.restore);

  useEffect(() => {
    void refreshStatus();
  }, []);

  if (!cryptoReady) {
    return (
      <>
        <h2>Segurança</h2>
        <p className="muted">A criptografia não pôde ser iniciada neste navegador.</p>
      </>
    );
  }

  return (
    <>
      <h2>Segurança</h2>

      <h3>Esta sessão</h3>
      <div className={`security-card ${status.thisDeviceVerified ? "ok" : "warn"}`}>
        <div className="security-card-icon">
          {status.thisDeviceVerified ? <IconShieldCheck size={28} /> : <IconShieldAlert size={28} />}
        </div>
        <div className="grow">
          <strong>{!status.loaded ? "Verificando…" : status.thisDeviceVerified ? "Sessão verificada" : "Sessão não verificada"}</strong>
          <p className="muted small">
            {status.thisDeviceVerified
              ? "Seus outros dispositivos e contatos confiam nesta sessão."
              : status.crossSigningSetUp
                ? "Compare emojis com outro dispositivo já conectado (como o Element) para copiar as chaves e ler suas mensagens criptografadas."
                : "Sua conta ainda não tem assinatura cruzada. Configure a criptografia uma vez pelo Element e depois verifique esta sessão aqui."}
          </p>
        </div>
        {status.loaded && !status.thisDeviceVerified && status.crossSigningSetUp && (
          <button className="btn primary small" onClick={() => void startSelfVerification()}>
            Verificar
          </button>
        )}
      </div>

      <h3>Backup de chaves</h3>
      <div className="kv">
        <span>Backup no servidor</span>
        <span>{status.backupVersion ? `Sim (versão ${status.backupVersion})` : "Não encontrado"}</span>
        <span>Chave neste dispositivo</span>
        <span>{status.backupKeyCached ? "Sim" : "Não — verifique a sessão para recebê-la"}</span>
        <span>Enviando chaves novas</span>
        <span>{status.backupActive ? "Sim" : "Não"}</span>
      </div>
      {status.backupKeyCached && status.backupVersion && (
        <div className="row gap" style={{ marginTop: 12 }}>
          <button className="btn secondary small" disabled={!!restore?.running} onClick={() => void startRestore()}>
            {restore?.running ? "Restaurando…" : "Restaurar chaves do backup"}
          </button>
        </div>
      )}
      {restore && <RestoreStatus />}

      <h3>Sessões</h3>
      <div className="device-list">
        {status.devices.map((d) => (
          <div className="device-row" key={d.deviceId}>
            <span className={`device-shield ${d.verified ? "ok" : "warn"}`} title={d.verified ? "Verificada" : "Não verificada"}>
              {d.verified ? <IconShieldCheck size={20} /> : <IconShieldAlert size={20} />}
            </span>
            <div className="grow">
              <div className="device-name">
                {d.name}
                {d.current && <span className="badge-inline">esta sessão</span>}
              </div>
              <div className="muted small">
                {d.deviceId}
                {d.lastSeen ? ` · visto em ${new Date(d.lastSeen).toLocaleString("pt-BR")}` : ""}
              </div>
            </div>
            {!d.current && !d.verified && status.thisDeviceVerified && status.canSignOthers && (
              <button className="btn secondary small" onClick={() => void verifyOtherDevice(d.deviceId)}>
                Verificar
              </button>
            )}
          </div>
        ))}
        {status.loaded && status.devices.length === 0 && <p className="muted small">Nenhuma sessão encontrada.</p>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v: number) => String(v),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?(v: number): string;
  onChange(v: number): void;
}) {
  return (
    <label className="field slider-field">
      <span>
        {label} <em>{format(value)}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

const COLOR_LABELS: [keyof ThemeColors, string][] = [
  ["bg1", "Fundo do chat"],
  ["bg2", "Barra lateral"],
  ["bg3", "Barra de servidores"],
  ["floating", "Menus"],
  ["text", "Texto"],
  ["muted", "Texto secundário"],
];

function chatAspect(a: AppearanceSettings) {
  const w = window.innerWidth - 72 - a.sidebarWidth - (a.showMemberList ? a.memberListWidth : 0);
  const h = window.innerHeight - 48 - 70;
  return Math.max(0.5, Math.min(4, w / Math.max(h, 1)));
}

function Appearance() {
  const a = useSettings((s) => s.appearance);
  const set = useSettings((s) => s.setAppearance);
  const applyPreset = useSettings((s) => s.applyPreset);
  const [importText, setImportText] = useState("");

  const setColor = (k: keyof ThemeColors, v: string) => set({ theme: "custom", colors: { ...a.colors, [k]: v } });

  const exportTheme = () => {
    const { customCss, accent, colors, radius, fontScale, chatFont, density, avatarShape, panelOpacity } = a;
    const json = JSON.stringify({ accent, colors, radius, fontScale, chatFont, density, avatarShape, panelOpacity, customCss });
    void navigator.clipboard.writeText(json);
    alert("Tema copiado para a área de transferência!");
  };
  const importTheme = () => {
    try {
      const p = JSON.parse(importText);
      set({ ...p, theme: "custom" });
      setImportText("");
    } catch {
      alert("JSON de tema inválido.");
    }
  };

  return (
    <>
      <h2>Aparência</h2>
      <div className="preview-msg">
        <Avatar name="Exemplo" id="@ex:matrix.org" size={40} />
        <div>
          <div>
            <strong style={{ color: "var(--accent)" }}>Exemplo</strong> <span className="muted tiny">Hoje às 12:00</span>
          </div>
          <div>Assim ficam as mensagens com o seu tema 🎨</div>
        </div>
      </div>

      <h3>Tema</h3>
      <div className="theme-swatches">
        {Object.entries(THEME_PRESETS).map(([k, p]) => (
          <button
            key={k}
            className={`theme-swatch ${a.theme === k ? "active" : ""}`}
            title={p.name}
            onClick={() => applyPreset(k)}
            style={{ background: `linear-gradient(135deg, ${p.colors.bg3} 0 33%, ${p.colors.bg2} 33% 66%, ${p.colors.bg1} 66%)` }}
          >
            <span style={{ background: p.accent }} />
            <em>{p.name}</em>
          </button>
        ))}
      </div>

      <h3>Cores personalizadas</h3>
      <div className="color-grid">
        <label className="color-field">
          <input type="color" value={a.accent} onChange={(e) => set({ accent: e.target.value })} />
          <span>Cor de destaque</span>
        </label>
        {COLOR_LABELS.map(([k, l]) => (
          <label className="color-field" key={k}>
            <input type="color" value={a.colors[k]} onChange={(e) => setColor(k, e.target.value)} />
            <span>{l}</span>
          </label>
        ))}
      </div>

      <h3>Texto e mensagens</h3>
      <div className="two-col">
        <label className="field">
          <span>Fonte</span>
          <select value={a.chatFont} onChange={(e) => set({ chatFont: e.target.value as AppearanceSettings["chatFont"] })}>
            <option value="system">Padrão do sistema</option>
            <option value="inter">Inter</option>
            <option value="rounded">Arredondada</option>
            <option value="serif">Serifada</option>
            <option value="mono">Monoespaçada</option>
          </select>
        </label>
        <Slider label="Tamanho da fonte" value={a.fontScale} min={0.8} max={1.3} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ fontScale: v })} />
      </div>
      <div className="field-label">Densidade das mensagens</div>
      <Seg value={a.density} options={[["cozy", "Confortável"], ["compact", "Compacta"]]} onChange={(v) => set({ density: v })} />
      <div className="field-label">Formato da hora</div>
      <Seg value={a.timeFormat} options={[["24h", "24 horas"], ["12h", "12 horas"]]} onChange={(v) => set({ timeFormat: v })} />
      <label className="check">
        <input type="checkbox" checked={a.showSeconds} onChange={(e) => set({ showSeconds: e.target.checked })} />
        Mostrar segundos
      </label>

      <h3>Formas e layout</h3>
      <div className="field-label">Formato dos avatares</div>
      <Seg
        value={a.avatarShape}
        options={[["circle", "Círculo"], ["rounded", "Arredondado"], ["square", "Quadrado"]]}
        onChange={(v) => set({ avatarShape: v })}
      />
      <div className="two-col">
        <Slider label="Arredondamento dos cantos" value={a.radius} min={0} max={20} format={(v) => `${v}px`} onChange={(v) => set({ radius: v })} />
        <Slider label="Largura da lista de canais" value={a.sidebarWidth} min={200} max={380} format={(v) => `${v}px`} onChange={(v) => set({ sidebarWidth: v })} />
        <Slider label="Largura da lista de membros" value={a.memberListWidth} min={200} max={340} format={(v) => `${v}px`} onChange={(v) => set({ memberListWidth: v })} />
      </div>
      <label className="check">
        <input type="checkbox" checked={a.animations} onChange={(e) => set({ animations: e.target.checked })} />
        Animações
      </label>

      <h3>Plano de fundo do chat</h3>
      <p className="muted small">Escolha uma imagem e posicione-a exatamente como quer que apareça atrás das mensagens.</p>
      <ImageField
        preview={a.chatBackground.image}
        aspect={chatAspect(a)}
        shape="rect"
        outputWidth={1920}
        mime="image/jpeg"
        boxWidth={280}
        label="Imagem do chat"
        onResult={(r) => set({ chatBackground: { ...a.chatBackground, image: r.dataUrl } })}
        onRemove={() => set({ chatBackground: { ...a.chatBackground, image: null } })}
      />
      {a.chatBackground.image && (
        <div className="two-col">
          <Slider label="Escurecer" value={a.chatBackground.dim} min={0} max={0.95} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ chatBackground: { ...a.chatBackground, dim: v } })} />
          <Slider label="Desfoque" value={a.chatBackground.blur} min={0} max={20} format={(v) => `${v}px`} onChange={(v) => set({ chatBackground: { ...a.chatBackground, blur: v } })} />
        </div>
      )}

      <h3>Plano de fundo do aplicativo</h3>
      <p className="muted small">Fica atrás de toda a interface; ajuste a opacidade dos painéis para vê-lo.</p>
      <ImageField
        preview={a.appBackground.image}
        aspect={window.innerWidth / window.innerHeight}
        shape="rect"
        outputWidth={1920}
        mime="image/jpeg"
        boxWidth={280}
        label="Imagem do app"
        onResult={(r) => set({ appBackground: { ...a.appBackground, image: r.dataUrl }, panelOpacity: Math.min(a.panelOpacity, 0.85) })}
        onRemove={() => set({ appBackground: { ...a.appBackground, image: null }, panelOpacity: 1 })}
      />
      {a.appBackground.image && (
        <div className="two-col">
          <Slider label="Opacidade dos painéis" value={a.panelOpacity} min={0.3} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ panelOpacity: v })} />
          <Slider label="Escurecer" value={a.appBackground.dim} min={0} max={0.95} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ appBackground: { ...a.appBackground, dim: v } })} />
          <Slider label="Desfoque" value={a.appBackground.blur} min={0} max={30} format={(v) => `${v}px`} onChange={(v) => set({ appBackground: { ...a.appBackground, blur: v } })} />
        </div>
      )}

      <h3>CSS personalizado</h3>
      <p className="muted small">
        Para quem quer ir além. Variáveis úteis: <code>--accent</code>, <code>--bg1</code>, <code>--bg2</code>, <code>--bg3</code>,{" "}
        <code>--text</code>, <code>--radius</code>.
      </p>
      <textarea
        className="code-input"
        rows={6}
        value={a.customCss}
        placeholder={".message-author { text-transform: uppercase; }"}
        onChange={(e) => set({ customCss: e.target.value })}
      />

      <h3>Compartilhar tema</h3>
      <div className="row gap wrap">
        <button className="btn secondary small" onClick={exportTheme}>
          Copiar tema (JSON)
        </button>
        <input className="grow" placeholder="Cole aqui um tema em JSON" value={importText} onChange={(e) => setImportText(e.target.value)} />
        <button className="btn secondary small" disabled={!importText} onClick={importTheme}>
          Importar
        </button>
      </div>
      <div className="divider" />
      <button
        className="btn danger-outline small"
        onClick={() => confirm("Restaurar todas as configurações de aparência, voz e avançadas?") && useSettings.getState().reset()}
      >
        Restaurar padrões
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ */

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = async () => setDevices(await navigator.mediaDevices.enumerateDevices());
  useEffect(() => {
    void refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);
  return { devices, refresh };
}

function VoiceVideo() {
  const v = useSettings((s) => s.voice);
  const set = useSettings((s) => s.setVoice);
  const { devices, refresh } = useDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const cams = devices.filter((d) => d.kind === "videoinput");
  const noLabels = devices.length > 0 && devices.every((d) => !d.label);
  const connected = useVoice((s) => s.status === "connected");

  const requestAccess = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() =>
        navigator.mediaDevices.getUserMedia({ audio: true }),
      );
      s.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch {
      alert("Permissão negada pelo navegador.");
    }
  };

  const pick = (kind: MediaDeviceKind, id: string) => {
    if (kind === "audioinput") set({ inputDeviceId: id });
    if (kind === "audiooutput") set({ outputDeviceId: id });
    if (kind === "videoinput") set({ videoDeviceId: id });
    if (connected) void switchDevice(kind, id);
  };

  return (
    <>
      <h2>Voz e vídeo</h2>
      {noLabels && (
        <div className="notice">
          O navegador ainda não liberou os nomes dos dispositivos.{" "}
          <button className="btn small primary" onClick={requestAccess}>
            Permitir acesso
          </button>
        </div>
      )}
      <div className="two-col">
        <label className="field">
          <span>Dispositivo de entrada</span>
          <select value={v.inputDeviceId} onChange={(e) => pick("audioinput", e.target.value)}>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microfone"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Dispositivo de saída</span>
          <select value={v.outputDeviceId} onChange={(e) => pick("audiooutput", e.target.value)}>
            {outputs.length === 0 && <option value="default">Padrão</option>}
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Alto-falante"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <MicTest deviceId={v.inputDeviceId} />

      <h3>Processamento de voz</h3>
      <label className="check">
        <input type="checkbox" checked={v.noiseSuppression} onChange={(e) => set({ noiseSuppression: e.target.checked })} />
        Supressão de ruído
      </label>
      <label className="check">
        <input type="checkbox" checked={v.echoCancellation} onChange={(e) => set({ echoCancellation: e.target.checked })} />
        Cancelamento de eco
      </label>
      <label className="check">
        <input type="checkbox" checked={v.autoGainControl} onChange={(e) => set({ autoGainControl: e.target.checked })} />
        Controle automático de ganho
      </label>
      <p className="muted tiny">Mudanças de processamento valem a partir da próxima conexão.</p>

      <h3>Vídeo</h3>
      <label className="field">
        <span>Câmera</span>
        <select value={v.videoDeviceId} onChange={(e) => pick("videoinput", e.target.value)}>
          <option value="">Padrão</option>
          {cams.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Câmera"}
            </option>
          ))}
        </select>
      </label>
      <CameraPreview deviceId={v.videoDeviceId} />

      <h3>Transmissões e câmeras de outras pessoas</h3>
      <label className="check">
        <input type="checkbox" checked={v.autoWatchCameras} onChange={(e) => set({ autoWatchCameras: e.target.checked })} />
        Mostrar câmeras automaticamente
      </label>
      <label className="check">
        <input type="checkbox" checked={v.autoWatchStreams} onChange={(e) => set({ autoWatchStreams: e.target.checked })} />
        Assistir transmissões de tela automaticamente (desligado = você escolhe quais assistir)
      </label>

      <h3>Sua transmissão de tela</h3>
      <div className="field-label">Resolução</div>
      <Seg
        value={v.screenResolution}
        options={[["720p", "720p"], ["1080p", "1080p"], ["1440p", "1440p"], ["source", "Fonte"]]}
        onChange={(r) => set({ screenResolution: r })}
      />
      <div className="field-label">Taxa de quadros</div>
      <Seg
        value={String(v.screenFps) as "15" | "30" | "60"}
        options={[["15", "15 FPS"], ["30", "30 FPS"], ["60", "60 FPS"]]}
        onChange={(f) => set({ screenFps: Number(f) as 15 | 30 | 60 })}
      />
      <label className="check">
        <input type="checkbox" checked={v.screenAudio} onChange={(e) => set({ screenAudio: e.target.checked })} />
        Incluir áudio da tela/aba
      </label>

      <h3>Sons</h3>
      <label className="check">
        <input type="checkbox" checked={v.sounds} onChange={(e) => set({ sounds: e.target.checked })} />
        Sons de entrar/sair e silenciar
      </label>
    </>
  );
}

function MicTest({ deviceId }: { deviceId: string }) {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let ctx: AudioContext | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : true });
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const data = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(data);
          let sum = 0;
          for (const x of data) sum += ((x - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setOn(false);
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setLevel(0);
    };
  }, [on, deviceId]);
  return (
    <div className="mic-test">
      <button className="btn small primary" onClick={() => setOn((o) => !o)}>
        {on ? "Parar teste" : "Testar microfone"}
      </button>
      <div className="meter">
        <div className="meter-fill" style={{ width: `${level * 100}%` }} />
      </div>
    </div>
  );
}

function CameraPreview({ deviceId }: { deviceId: string }) {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((s) => {
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      })
      .catch(() => setOn(false));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [on, deviceId]);
  return (
    <div className="camera-preview">
      {on ? <video ref={ref} autoPlay playsInline muted className="mirror" /> : <div className="camera-off">Câmera desligada</div>}
      <button className="btn small secondary" onClick={() => setOn((o) => !o)}>
        {on ? "Desligar prévia" : "Testar vídeo"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Advanced() {
  const adv = useSettings((s) => s.advanced);
  const set = useSettings((s) => s.setAdvanced);
  const [info, setInfo] = useState<string>("");

  const discover = async () => {
    setInfo("Procurando…");
    const c = getClient();
    const out: string[] = [];
    try {
      const t = await c._unstable_getRTCTransports();
      out.push("MSC4143 /rtc/transports: " + JSON.stringify(t));
    } catch {
      out.push("MSC4143 /rtc/transports: não suportado");
    }
    const wk = c.getClientWellKnown() as Record<string, unknown> | undefined;
    out.push("well-known rtc_foci: " + JSON.stringify(wk?.["org.matrix.msc4143.rtc_foci"] ?? "não encontrado"));
    setInfo(out.join("\n"));
  };

  return (
    <>
      <h2>Avançado</h2>
      <h3>Servidor de chamadas (LiveKit)</h3>
      <p className="muted small">
        As chamadas usam MatrixRTC com um SFU LiveKit — o mesmo sistema do Element Call. O endereço é descoberto
        automaticamente pelo seu servidor Matrix. Se o seu servidor não anunciar um, informe aqui a URL do{" "}
        <code>lk-jwt-service</code> (ex.: <code>https://livekit-jwt.call.matrix.org</code>).
      </p>
      <label className="field">
        <span>URL do serviço JWT do LiveKit (opcional)</span>
        <input value={adv.livekitServiceUrl} placeholder="Automático" onChange={(e) => set({ livekitServiceUrl: e.target.value })} />
      </label>
      <button className="btn secondary small" onClick={discover}>
        Verificar descoberta automática
      </button>
      {info && <pre className="code-block">{info}</pre>}
    </>
  );
}
