import { useEffect, useState, type ReactNode } from "react";
import ImageCropper, { pickImage, type CropResult } from "../ImageCropper";
import { IconImage, IconX } from "../icons";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`}>
        <button className="icon-btn modal-close" onClick={onClose} title="Fechar">
          <IconX />
        </button>
        {title && <h2>{title}</h2>}
        {subtitle && <p className="muted center">{subtitle}</p>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Campo de imagem com pré-visualização: escolher arquivo → posicionar/recortar → aplicar.
 */
export function ImageField({
  preview,
  aspect,
  shape,
  outputWidth,
  label,
  mime,
  onResult,
  onRemove,
  boxWidth = 96,
  placeholder,
}: {
  preview?: string | null;
  aspect: number;
  shape: "circle" | "rect";
  outputWidth: number;
  label: string;
  mime?: "image/png" | "image/jpeg" | "image/webp";
  onResult(r: CropResult): void | Promise<void>;
  onRemove?: () => void;
  boxWidth?: number;
  placeholder?: ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    const f = await pickImage();
    if (f) setFile(f);
  };
  return (
    <div className="image-field">
      <div
        className={`image-field-box ${shape}`}
        style={{ width: Math.min(boxWidth, 180 * aspect), height: Math.min(boxWidth, 180 * aspect) / aspect }}
        onClick={choose}
        title="Escolher imagem"
      >
        {preview ? <img src={preview} alt="" /> : placeholder ?? <IconImage size={28} />}
        <div className="image-field-hover">{busy ? "Enviando…" : "Alterar"}</div>
      </div>
      <div className="image-field-side">
        <div className="field-label">{label}</div>
        <div className="row gap">
          <button type="button" className="btn small primary" onClick={choose} disabled={busy}>
            Escolher imagem
          </button>
          {preview && onRemove && (
            <button type="button" className="btn small link" onClick={onRemove} disabled={busy}>
              Remover
            </button>
          )}
        </div>
      </div>
      {file && (
        <ImageCropper
          file={file}
          aspect={aspect}
          shape={shape}
          outputWidth={outputWidth}
          mime={mime}
          quality={0.85}
          title={label}
          onCancel={() => setFile(null)}
          onConfirm={async (r) => {
            setFile(null);
            setBusy(true);
            try {
              await onResult(r);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
