import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Room } from "matrix-js-sdk";
import { getAvailablePacks, packsFor, type Pack, type PackImage } from "../../matrix/imagePacks";
import { useAppStore, useVersion } from "../../store/app";
import {
  EMOJI_GROUPS,
  getRecent,
  getSkinTone,
  loadEmojis,
  normalize,
  pushRecent,
  setSkinTone,
  withTone,
  type EmojiItem,
} from "./emojiData";
import CustomEmoji from "./CustomEmoji";
import { IconSettings } from "../icons";

export type PickedEmoji = { kind: "unicode"; text: string } | { kind: "custom"; shortcode: string; url: string };

interface Props {
  room?: Room | null;
  /** "composer" mostra a aba de figurinhas; "reaction" só emojis */
  mode: "composer" | "reaction";
  /** elemento que abriu a janela (para posicionar e ignorar o clique nele) */
  anchor: HTMLElement | null;
  onEmoji(e: PickedEmoji): void;
  onSticker?(img: PackImage): void;
  onClose(): void;
  initialTab?: "emoji" | "sticker";
}

const TONES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
const WIDTH = 420;
const HEIGHT = 460;

interface Hover {
  big: ReactNode;
  name: string;
  sub?: string;
}

export default function ExpressionPicker({ room, mode, anchor, onEmoji, onSticker, onClose, initialTab = "emoji" }: Props) {
  useVersion();
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [tab, setTab] = useState<"emoji" | "sticker">(mode === "reaction" ? "emoji" : initialTab);
  const [query, setQuery] = useState("");
  const [emojis, setEmojis] = useState<EmojiItem[] | null>(null);
  const [tone, setTone] = useState(getSkinTone);
  const [toneOpen, setToneOpen] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const recent = useMemo(getRecent, []);

  useEffect(() => {
    void loadEmojis().then(setEmojis);
  }, []);

  // Posição fixa junto ao botão: acima se couber, senão abaixo
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!r) return setPos({ left: Math.max(8, vw - WIDTH - 8), top: Math.max(8, vh - HEIGHT - 8) });
      const left = Math.min(Math.max(8, r.right - WIDTH), vw - WIDTH - 8);
      const above = r.top - HEIGHT - 8;
      const top = above >= 8 ? above : Math.min(r.bottom + 8, vh - HEIGHT - 8);
      setPos({ left, top: Math.max(8, top) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  // Fecha ao clicar fora ou com Esc
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose, anchor]);

  const packs = getAvailablePacks(room);
  const emotePacks = packsFor(packs, "emoticon");
  const stickerPacks = packsFor(packs, "sticker");
  const customByUrl = new Map(emotePacks.flatMap((p) => p.images.map((i) => [i.url, i] as const)));

  const pickUnicode = (text: string) => {
    pushRecent(text);
    onEmoji({ kind: "unicode", text });
  };
  const pickCustom = (img: PackImage) => {
    pushRecent(`${img.url}|${img.shortcode}`);
    onEmoji({ kind: "custom", shortcode: img.shortcode, url: img.url });
  };
  const pickSticker = (img: PackImage) => onSticker?.(img);

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id];
    if (el && scrollRef.current) scrollRef.current.scrollTo({ top: el.offsetTop - 4, behavior: "smooth" });
  };

  const q = normalize(query.trim());

  /* ------------------------- conteúdo das abas ------------------------- */

  const emojiButton = (item: EmojiItem) => {
    const ch = withTone(item, tone);
    return (
      <button
        key={item.e}
        className="xp-emoji"
        onClick={() => pickUnicode(ch)}
        onMouseEnter={() => setHover({ big: <span className="xp-preview-glyph">{ch}</span>, name: item.label })}
      >
        {ch}
      </button>
    );
  };

  const customButton = (img: PackImage, pack?: Pack) => (
    <button
      key={`${pack?.id ?? "r"}-${img.shortcode}`}
      className="xp-emoji"
      onClick={() => pickCustom(img)}
      onMouseEnter={() => setHover({ big: <CustomEmoji mxc={img.url} alt={img.shortcode} size={40} />, name: `:${img.shortcode}:`, sub: pack?.name })}
    >
      <CustomEmoji mxc={img.url} alt={`:${img.shortcode}:`} size={28} />
    </button>
  );

  let nav: { id: string; icon: ReactNode; title: string }[] = [];
  let body: ReactNode;

  if (tab === "emoji") {
    if (q) {
      const customHits = emotePacks.flatMap((p) =>
        p.images.filter((i) => normalize(i.shortcode).includes(q) || normalize(i.body ?? "").includes(q)).map((i) => customButton(i, p)),
      );
      const hits = (emojis ?? []).filter((e) => e.search.includes(q)).slice(0, 200);
      body =
        customHits.length || hits.length ? (
          <Section title="Resultados">
            {customHits}
            {hits.map(emojiButton)}
          </Section>
        ) : (
          <div className="xp-empty">{emojis ? "Nenhum emoji encontrado." : "Carregando…"}</div>
        );
    } else {
      const sections: ReactNode[] = [];
      if (recent.length) {
        nav.push({ id: "recent", icon: "🕘", title: "Recentes" });
        sections.push(
          <Section key="recent" id="recent" title="Recentes" refs={sectionRefs}>
            {recent.map((r) => {
              if (r.startsWith("mxc://")) {
                const [url, code] = r.split("|");
                const img = customByUrl.get(url) ?? ({ url, shortcode: code, uses: ["emoticon"] } as PackImage);
                return customButton(img);
              }
              return (
                <button
                  key={r}
                  className="xp-emoji"
                  onClick={() => pickUnicode(r)}
                  onMouseEnter={() => setHover({ big: <span className="xp-preview-glyph">{r}</span>, name: "Recente" })}
                >
                  {r}
                </button>
              );
            })}
          </Section>,
        );
      }
      for (const p of emotePacks) {
        nav.push({ id: p.id, icon: <CustomEmoji mxc={p.avatar ?? p.images[0].url} alt={p.name} size={22} />, title: p.name });
        sections.push(
          <Section key={p.id} id={p.id} title={p.name} refs={sectionRefs}>
            {p.images.map((i) => customButton(i, p))}
          </Section>,
        );
      }
      for (const g of EMOJI_GROUPS) {
        nav.push({ id: `g${g.id}`, icon: g.icon, title: g.name });
        const items = (emojis ?? []).filter((e) => e.group === g.id);
        sections.push(
          <Section key={g.id} id={`g${g.id}`} title={g.name} refs={sectionRefs}>
            {emojis ? items.map(emojiButton) : <span className="muted small">Carregando…</span>}
          </Section>,
        );
      }
      body = sections;
    }
  } else {
    const list = q
      ? stickerPacks
          .map((p) => ({ ...p, images: p.images.filter((i) => normalize(i.shortcode).includes(q) || normalize(i.body ?? "").includes(q)) }))
          .filter((p) => p.images.length)
      : stickerPacks;
    nav = list.map((p) => ({ id: p.id, icon: <CustomEmoji mxc={p.avatar ?? p.images[0].url} alt={p.name} size={22} />, title: p.name }));
    body = list.length ? (
      list.map((p) => (
        <Section key={p.id} id={p.id} title={p.name} refs={sectionRefs} grid="stickers">
          {p.images.map((img) => (
            <button
              key={img.shortcode}
              className="xp-sticker"
              onClick={() => pickSticker(img)}
              onMouseEnter={() => setHover({ big: <CustomEmoji mxc={img.url} alt={img.shortcode} size={40} />, name: img.body || img.shortcode, sub: p.name })}
            >
              <CustomEmoji mxc={img.url} alt={img.body || img.shortcode} className="xp-sticker-img" />
            </button>
          ))}
        </Section>
      ))
    ) : (
      <div className="xp-empty">
        <div className="xp-empty-icon">🗂️</div>
        {q ? "Nenhuma figurinha encontrada." : "Você ainda não tem figurinhas."}
        {!q && (
          <button
            className="btn primary small"
            onClick={() => {
              onClose();
              useAppStore.getState().openModal({ type: "userSettings", tab: "stickers" });
            }}
          >
            Criar um pacote
          </button>
        )}
      </div>
    );
  }

  if (!pos) return null;

  return createPortal(
    <div className="xpicker" ref={ref} style={{ left: pos.left, top: pos.top, width: WIDTH, height: HEIGHT }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="xp-top">
        {mode === "composer" && (
          <div className="xp-tabs">
            <button className={tab === "emoji" ? "active" : ""} onClick={() => setTab("emoji")}>
              Emojis
            </button>
            <button className={tab === "sticker" ? "active" : ""} onClick={() => setTab("sticker")}>
              Figurinhas
            </button>
          </div>
        )}
        <div className="xp-search-row">
          <input
            className="xp-search"
            autoFocus
            value={query}
            placeholder={tab === "emoji" ? "Buscar emoji" : "Buscar figurinha"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const first = scrollRef.current?.querySelector<HTMLButtonElement>(".xp-emoji, .xp-sticker");
              first?.click();
            }}
          />
          {tab === "emoji" && (
            <div className="xp-tone">
              <button className="xp-tone-btn" title="Tom de pele" onClick={() => setToneOpen((o) => !o)}>
                {TONES[tone]}
              </button>
              {toneOpen && (
                <div className="xp-tone-menu">
                  {TONES.map((t, i) => (
                    <button
                      key={t}
                      className={i === tone ? "active" : ""}
                      onClick={() => {
                        setTone(i);
                        setSkinTone(i);
                        setToneOpen(false);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            className="icon-btn tiny"
            title="Gerenciar pacotes"
            onClick={() => {
              onClose();
              useAppStore.getState().openModal({ type: "userSettings", tab: "stickers" });
            }}
          >
            <IconSettings size={16} />
          </button>
        </div>
      </div>

      <div className="xp-body">
        {nav.length > 1 && (
          <nav className="xp-nav">
            {nav.map((n) => (
              <button key={n.id} title={n.title} onClick={() => scrollTo(n.id)}>
                {n.icon}
              </button>
            ))}
          </nav>
        )}
        <div className="xp-scroll" ref={scrollRef} onMouseLeave={() => setHover(null)}>
          {body}
        </div>
      </div>

      <div className="xp-footer">
        {hover ? (
          <>
            <div className="xp-preview">{hover.big}</div>
            <div className="ellipsis">
              <div className="xp-preview-name ellipsis">{hover.name}</div>
              {hover.sub && <div className="muted tiny ellipsis">{hover.sub}</div>}
            </div>
          </>
        ) : (
          <span className="muted small">{tab === "emoji" ? "Passe o mouse sobre um emoji" : "Clique numa figurinha para enviar"}</span>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Section({
  id,
  title,
  children,
  refs,
  grid = "emoji",
}: {
  id?: string;
  title: string;
  children: ReactNode;
  refs?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  grid?: "emoji" | "stickers";
}) {
  return (
    <div
      className="xp-section"
      ref={(el) => {
        if (refs && id) refs.current[id] = el;
      }}
    >
      <div className="xp-section-title">{title}</div>
      <div className={grid === "stickers" ? "xp-sticker-grid" : "xp-grid"}>{children}</div>
    </div>
  );
}
