import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { type: "header"; content: ReactNode }
  | { type: "separator" }
  | { type: "item"; label: string; icon?: ReactNode; onClick(): void; danger?: boolean; disabled?: boolean }
  | { type: "check"; label: string; checked: boolean; onChange(v: boolean): void; danger?: boolean }
  | { type: "slider"; label: string; value: number; min: number; max: number; format?(v: number): string; onChange(v: number): void };

/**
 * Menu de contexto (botão direito) no estilo do app: abre na posição do mouse,
 * fecha ao clicar fora, com Esc ou ao rolar a página.
 */
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(x, window.innerWidth - w - 8);
    const top = y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y;
    setPos({ left: Math.max(8, left), top });
  }, [x, y, items.length]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const scroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        switch (it.type) {
          case "header":
            return (
              <div key={i} className="ctx-header">
                {it.content}
              </div>
            );
          case "separator":
            return <div key={i} className="ctx-sep" />;
          case "slider":
            return (
              <div key={i} className="ctx-slider">
                <div className="ctx-slider-label">
                  <span>{it.label}</span>
                  <span className="muted">{it.format ? it.format(it.value) : it.value}</span>
                </div>
                <input type="range" min={it.min} max={it.max} value={it.value} onChange={(e) => it.onChange(Number(e.target.value))} />
              </div>
            );
          case "check":
            return (
              <button
                key={i}
                role="menuitemcheckbox"
                aria-checked={it.checked}
                className={`ctx-item ${it.danger ? "danger" : ""}`}
                onClick={() => it.onChange(!it.checked)}
              >
                <span>{it.label}</span>
                <span className={`ctx-check ${it.checked ? "on" : ""}`} />
              </button>
            );
          default:
            return (
              <button
                key={i}
                role="menuitem"
                className={`ctx-item ${it.danger ? "danger" : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  onClose();
                  it.onClick();
                }}
              >
                <span>{it.label}</span>
                {it.icon && <span className="ctx-icon">{it.icon}</span>}
              </button>
            );
        }
      })}
    </div>,
    document.body,
  );
}
