import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "./icons";

export interface SelectOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** texto usado na busca por digitação (padrão: label se for string) */
  text?: string;
  disabled?: boolean;
  /** bolinha colorida antes do texto (ex.: cor do cargo) */
  color?: string;
  hint?: ReactNode;
}

interface Props<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange(v: T): void;
  disabled?: boolean;
  className?: string;
  title?: string;
  /** texto quando o valor não está nas opções */
  placeholder?: ReactNode;
  "aria-label"?: string;
}

/**
 * Lista de seleção no estilo do app (a lista nativa do <select> é desenhada pelo
 * sistema e não segue o tema nem os cantos arredondados).
 */
export default function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  className = "",
  title,
  placeholder = "Selecionar…",
  ...aria
}: Props<T>) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean } | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const current = options.find((o) => o.value === value);

  const openMenu = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
    // O teclado (setas, Enter, Esc) é tratado no botão: garante o foco nele
    btn.current?.focus();
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    close();
    if (o.value !== value) onChange(o.value);
  };
  const move = (dir: 1 | -1) => {
    setActive((cur) => {
      let i = cur;
      for (let n = 0; n < options.length; n++) {
        i = (i + dir + options.length) % options.length;
        if (!options[i].disabled) return i;
      }
      return cur;
    });
  };

  // Posição: abaixo do botão, ou acima se não couber
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const vh = window.innerHeight;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const wanted = Math.min(300, options.length * 40 + 12);
      const up = below < Math.min(wanted, 160) && above > below;
      const maxH = Math.max(120, Math.min(300, up ? above : below));
      const width = Math.max(r.width, 180);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPos({ left, top: up ? r.top - 6 : r.bottom + 6, width, maxH, up });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, options.length]);

  // Fecha ao clicar fora ou ao rolar a página por trás
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || btn.current?.contains(t)) return;
      close(false);
    };
    const scroll = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);

  // Mantém a opção ativa visível
  useEffect(() => {
    if (!open || active < 0) return;
    menu.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(options.findIndex((o) => !o.disabled));
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return setActive(i);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1) {
      // Busca por digitação
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const q = typed.current.text;
      const i = options.findIndex((o) => !o.disabled && (o.text ?? (typeof o.label === "string" ? o.label : String(o.value))).toLowerCase().startsWith(q));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`select ${open ? "open" : ""} ${className}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={aria["aria-label"]}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        {current?.color && <span className="select-dot" style={{ background: current.color }} />}
        <span className="select-value ellipsis">{current ? current.label : placeholder}</span>
        <IconChevronDown size={16} className="select-caret" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            className={`select-menu ${pos.up ? "up" : ""}`}
            role="listbox"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxH,
              ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <div
                key={String(o.value)}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled}
                className={`select-option ${o.value === value ? "selected" : ""} ${i === active ? "active" : ""} ${o.disabled ? "disabled" : ""}`}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => choose(i)}
              >
                {o.color && <span className="select-dot" style={{ background: o.color }} />}
                <span className="select-option-label">
                  <span className="ellipsis">{o.label}</span>
                  {o.hint && <span className="select-hint">{o.hint}</span>}
                </span>
                {o.value === value && <CheckIcon />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function CheckIcon() {
  return (
    <svg className="select-check" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Opções de cargo padronizadas (com a cor de cada cargo). */
export function roleOptions(current: number, maxLevel: number): SelectOption<number | "custom">[] {
  const base: SelectOption<number | "custom">[] = [
    { value: 100, label: "Administrador", color: "var(--admin-color)", disabled: 100 > maxLevel },
    { value: 50, label: "Moderador", color: "var(--mod-color)", disabled: 50 > maxLevel },
    { value: 0, label: "Membro", color: "var(--muted)" },
  ];
  if (![0, 50, 100].includes(current)) {
    base.push({ value: current, label: `Personalizado (${current})`, color: "var(--accent)", disabled: current > maxLevel });
  }
  base.push({ value: "custom", label: "Personalizado…", hint: "Escolher um nível numérico" });
  return base;
}
