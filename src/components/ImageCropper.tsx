import { useCallback, useEffect, useRef, useState } from "react";
import { IconImage, IconRotate } from "./icons";

export interface CropResult {
  blob: Blob;
  dataUrl: string;
  /** true quando o arquivo original foi usado sem recorte (ex.: GIF animado) */
  original?: boolean;
}

interface Props {
  file: File;
  /** largura / altura da área final */
  aspect: number;
  shape: "circle" | "rect";
  /** largura da imagem final em pixels */
  outputWidth: number;
  mime?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;
  title?: string;
  onCancel(): void;
  onConfirm(r: CropResult): void;
}

const STAGE_W = 520;
const STAGE_H = 380;
const MARGIN = 40;

/**
 * Permite arrastar, dar zoom e girar a imagem antes de aplicá-la
 * (como o editor de avatar do Discord).
 */
export default function ImageCropper({
  file,
  aspect,
  shape,
  outputWidth,
  mime = "image/png",
  quality = 0.9,
  title = "Editar imagem",
  onCancel,
  onConfirm,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const isGif = file.type === "image/gif";

  // Tamanho da moldura de recorte dentro do palco
  const maxW = STAGE_W - MARGIN * 2;
  const maxH = STAGE_H - MARGIN * 2;
  const cw = Math.min(maxW, maxH * aspect);
  const ch = cw / aspect;

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    if (!src) return;
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setZoom(1);
      setOff({ x: 0, y: 0 });
    };
    i.src = src;
  }, [src]);

  const base = img ? Math.max(cw / img.naturalWidth, ch / img.naturalHeight) : 1;
  const scale = base * zoom;
  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;

  const clamp = useCallback(
    (x: number, y: number, z = zoom) => {
      if (!img) return { x, y };
      const s = base * z;
      const mx = Math.max(0, (img.naturalWidth * s - cw) / 2);
      const my = Math.max(0, (img.naturalHeight * s - ch) / 2);
      return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
    },
    [img, base, cw, ch, zoom],
  );

  const setZoomClamped = (z: number) => {
    const nz = Math.max(1, Math.min(5, z));
    setZoom(nz);
    setOff((o) => clamp(o.x, o.y, nz));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOff(clamp(d.ox + e.clientX - d.x, d.oy + e.clientY - d.y));
  };
  const onPointerUp = () => (drag.current = null);

  const rotate = () => {
    if (!img) return;
    const cv = document.createElement("canvas");
    cv.width = img.naturalHeight;
    cv.height = img.naturalWidth;
    const ctx = cv.getContext("2d")!;
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    setSrc(cv.toDataURL("image/png"));
  };

  const confirm = async () => {
    if (!img) return;
    setBusy(true);
    const outW = Math.round(outputWidth);
    const outH = Math.round(outputWidth / aspect);
    const cv = document.createElement("canvas");
    cv.width = outW;
    cv.height = outH;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
    }
    const sx = img.naturalWidth / 2 + (-cw / 2 - off.x) / scale;
    const sy = img.naturalHeight / 2 + (-ch / 2 - off.y) / scale;
    ctx.drawImage(img, sx, sy, cw / scale, ch / scale, 0, 0, outW, outH);
    const blob = await new Promise<Blob>((res) => cv.toBlob((b) => res(b!), mime, quality));
    onConfirm({ blob, dataUrl: cv.toDataURL(mime, quality) });
  };

  const useOriginal = async () => {
    const dataUrl = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(file);
    });
    onConfirm({ blob: file, dataUrl, original: true });
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onCancel]);

  return (
    <div className="modal-backdrop cropper-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal cropper-modal">
        <h2>{title}</h2>
        <p className="muted small">Arraste para posicionar • role ou use o controle para dar zoom</p>
        <div
          className="cropper-stage"
          style={{ width: STAGE_W, height: STAGE_H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        >
          {img && (
            <img
              src={src!}
              alt=""
              draggable={false}
              className="cropper-img"
              style={{
                width: dw,
                height: dh,
                left: STAGE_W / 2 - dw / 2 + off.x,
                top: STAGE_H / 2 - dh / 2 + off.y,
              }}
            />
          )}
          <div
            className={`cropper-frame ${shape}`}
            style={{ width: cw, height: ch, left: (STAGE_W - cw) / 2, top: (STAGE_H - ch) / 2 }}
          />
        </div>
        <div className="cropper-controls">
          <IconImage size={14} />
          <input
            type="range"
            min={1}
            max={5}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoomClamped(Number(e.target.value))}
          />
          <IconImage size={22} />
          <button className="icon-btn" title="Girar 90°" onClick={rotate} disabled={isGif}>
            <IconRotate size={18} />
          </button>
          <button
            className="btn link small"
            onClick={() => {
              setZoom(1);
              setOff({ x: 0, y: 0 });
            }}
          >
            Redefinir
          </button>
        </div>
        {isGif && <p className="muted tiny">GIFs perdem a animação ao recortar. Use “Usar original” para mantê-la.</p>}
        <div className="modal-footer">
          <button className="btn link" onClick={onCancel}>
            Cancelar
          </button>
          {isGif && (
            <button className="btn secondary" onClick={useOriginal}>
              Usar original
            </button>
          )}
          <button className="btn primary" onClick={confirm} disabled={!img || busy}>
            {busy ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Abre o seletor de arquivo do sistema e devolve a imagem escolhida. */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
