import { useEffect, useRef, useState } from "react";
import { maybeClient } from "../../matrix/client";
import { uploadBlob } from "../../matrix/media";
import { saveMyStyle, useProfileStyles, type ProfileStyle } from "../../matrix/profileStyle";
import Avatar, { colorFor } from "../Avatar";
import ImageCropper, { pickImage } from "../ImageCropper";
import ProfileBanner from "../ProfileBanner";
import { IconImage, IconTrash } from "../icons";

const SWATCHES = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#00a8fc", "#9b59b6", "#1abc9c", "#2b2d31", "#f5f5f5"];

/**
 * Rascunho do estilo do perfil. O seletor de cor dispara a cada movimento, então
 * as mudanças são juntadas e salvas com um pequeno atraso.
 */
function useProfileDraft() {
  const mine = useProfileStyles((s) => s.mine);
  const [draft, setDraft] = useState<ProfileStyle>(mine);
  const [error, setError] = useState("");
  const timer = useRef<number>(undefined);
  const pending = useRef<Partial<ProfileStyle>>({});

  useEffect(() => setDraft(mine), [mine]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = (patch: Partial<ProfileStyle>, delay = 500) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const all = pending.current;
      pending.current = {};
      setError("");
      saveMyStyle(all).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, delay);
  };
  return { draft, save, error, setError };
}

/** Banner clicável: abre um menu com imagem (posicionável) e cores. */
export function BannerEditor({ className = "account-banner" }: { className?: string }) {
  const c = maybeClient();
  const { draft, save, error, setError } = useProfileDraft();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!c) return null;
  const me = c.getUserId()!;

  const chooseImage = async () => {
    setOpen(false);
    const f = await pickImage();
    if (f) setFile(f);
  };

  return (
    <div className="banner-edit" ref={ref}>
      <button className="banner-edit-trigger" onClick={() => setOpen((o) => !o)} title="Alterar banner">
        <ProfileBanner userId={me} className={className} draft={draft} />
        <span className="banner-edit-hover">{busy ? "Enviando…" : "Alterar banner"}</span>
      </button>

      {open && (
        <div className="dropdown banner-menu">
          <button className="dropdown-item" onClick={() => void chooseImage()}>
            {draft.bannerImage ? "Trocar imagem" : "Enviar imagem"} <IconImage size={16} />
          </button>
          {draft.bannerImage && (
            <button
              className="dropdown-item danger"
              onClick={() => {
                save({ bannerImage: null }, 0);
                setOpen(false);
              }}
            >
              Remover imagem <IconTrash size={16} />
            </button>
          )}
          <div className="dropdown-sep" />
          <div className="banner-menu-label">{draft.bannerImage ? "Cor (aparece enquanto a imagem carrega)" : "Cor do banner"}</div>
          <ColorPicker value={draft.bannerColor ?? null} auto={colorFor(me)} onChange={(v) => save({ bannerColor: v })} />
        </div>
      )}

      {file && (
        <ImageCropper
          file={file}
          aspect={3}
          shape="rect"
          outputWidth={960}
          mime="image/jpeg"
          quality={0.85}
          title="Banner do perfil"
          onCancel={() => setFile(null)}
          onConfirm={async (r) => {
            setFile(null);
            setBusy(true);
            setError("");
            try {
              const url = await uploadBlob(r.blob, r.original ? "banner.gif" : "banner.jpg");
              save({ bannerImage: url }, 0);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {error && <div className="form-error banner-error">{error}</div>}
    </div>
  );
}

/** Cor do seu bloco nas chamadas, com prévia do bloco. */
export function CallColorEditor() {
  const c = maybeClient();
  const { draft, save, error } = useProfileDraft();
  const extended = useProfileStyles((s) => s.extended);
  if (!c) return null;
  const me = c.getUserId()!;
  const user = c.getUser(me);
  const name = user?.displayName ?? me;
  const auto = colorFor(me);
  const color = draft.callColor ?? null;

  return (
    <>
      <div className="call-color-editor">
        <div className="call-tile-preview" style={{ ["--tile-color" as string]: color ?? auto }}>
          <Avatar mxc={user?.avatarUrl} name={name} id={me} size={40} />
          <span className="call-tile-preview-label">{name}</span>
        </div>
        <div className="grow">
          <div className="field-label">Cor do seu bloco nas chamadas</div>
          <ColorPicker value={color} auto={auto} onChange={(v) => save({ callColor: v })} />
        </div>
      </div>
      <p className="muted tiny">
        {extended === false
          ? "Seu servidor não suporta perfis estendidos (MSC4133): o banner aparece só para você. A cor da chamada aparece para quem estiver na chamada com o MatrixCord."
          : "Banner e cor ficam no seu perfil Matrix: quem usa o MatrixCord vê os dois."}
      </p>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

function ColorPicker({ value, auto, onChange }: { value: string | null; auto: string; onChange(v: string | null): void }) {
  return (
    <div className="swatch-row">
      <button
        className={`swatch auto ${value === null ? "active" : ""}`}
        style={{ background: auto }}
        title="Automática (baseada no seu ID)"
        onClick={() => onChange(null)}
      >
        A
      </button>
      {SWATCHES.map((s) => (
        <button
          key={s}
          className={`swatch ${value?.toLowerCase() === s ? "active" : ""}`}
          style={{ background: s }}
          title={s}
          onClick={() => onChange(s)}
        />
      ))}
      <label className={`swatch custom ${value && !SWATCHES.includes(value.toLowerCase()) ? "active" : ""}`} title="Escolher outra cor">
        <input type="color" value={value ?? auto} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
