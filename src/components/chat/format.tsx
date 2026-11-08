import type { ReactNode } from "react";
import CustomEmoji from "./CustomEmoji";

/** Remove o fallback de resposta ("> <@fulano> texto") do corpo da mensagem. */
export function stripReplyFallback(body: string): string {
  if (!body.startsWith("> ")) return body;
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("> ")) i++;
  if (lines[i] === "") i++;
  return lines.slice(i).join("\n");
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]"'])/g;
const MENTION_RE = /(@[a-z0-9._=\-/]+:[a-z0-9.\-]+(?::\d+)?)/gi;

function inline(text: string, keyBase: string, myId: string): ReactNode[] {
  // Ordem: código inline > negrito > itálico > riscado > links > menções
  const out: ReactNode[] = [];
  const tokens = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|\|\|[^|\n]+\|\|)/g);
  tokens.forEach((tok, i) => {
    const k = `${keyBase}-${i}`;
    if (!tok) return;
    if (/^`[^`]+`$/.test(tok)) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (/^\*\*.+\*\*$/.test(tok) || /^__.+__$/.test(tok)) out.push(<strong key={k}>{inline(tok.slice(2, -2), k, myId)}</strong>);
    else if (/^\*.+\*$/.test(tok) || /^_.+_$/.test(tok)) out.push(<em key={k}>{inline(tok.slice(1, -1), k, myId)}</em>);
    else if (/^~~.+~~$/.test(tok)) out.push(<s key={k}>{inline(tok.slice(2, -2), k, myId)}</s>);
    else if (/^\|\|.+\|\|$/.test(tok)) out.push(<Spoiler key={k}>{tok.slice(2, -2)}</Spoiler>);
    else out.push(...linkify(tok, k, myId));
  });
  return out;
}

function linkify(text: string, keyBase: string, myId: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(URL_RE).forEach((part, i) => {
    if (!part) return;
    if (/^https?:\/\/\S+$/.test(part)) {
      out.push(
        <a key={`${keyBase}-u${i}`} href={part} target="_blank" rel="noreferrer noopener">
          {part}
        </a>,
      );
    } else {
      part.split(MENTION_RE).forEach((p, j) => {
        if (!p) return;
        if (/^@[^:]+:.+$/.test(p)) {
          out.push(
            <span key={`${keyBase}-m${i}-${j}`} className={`mention ${p === myId ? "me" : ""}`}>
              {p}
            </span>,
          );
        } else out.push(p);
      });
    }
  });
  return out;
}

function Spoiler({ children }: { children: ReactNode }) {
  return (
    <span className="spoiler" onClick={(e) => e.currentTarget.classList.add("revealed")}>
      {children}
    </span>
  );
}

/** Renderização leve estilo Discord (markdown básico). */
export function renderBody(body: string, myId: string): ReactNode {
  const parts = body.split(/```(?:[a-zA-Z0-9]*\n)?([\s\S]*?)```/g);
  return parts.map((p, i) => {
    if (i % 2 === 1) return <pre key={i} className="code-block">{p.replace(/\n$/, "")}</pre>;
    const lines = p.split("\n");
    return lines.map((line, j) => {
      const k = `${i}-${j}`;
      const isQuote = line.startsWith("> ");
      const content = inline(isQuote ? line.slice(2) : line, k, myId);
      return (
        <span key={k}>
          {isQuote ? <span className="quote">{content}</span> : content}
          {j < lines.length - 1 && <br />}
        </span>
      );
    });
  });
}

/* ------------------------------------------------------------------ */
/* HTML com emojis personalizados (<img data-mx-emoticon>)             */
/* ------------------------------------------------------------------ */

export function hasEmotes(html: string) {
  return html.includes("data-mx-emoticon");
}

function parseHtml(html: string): Element {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild!;
  root.querySelectorAll("mx-reply").forEach((n) => n.remove());
  return root;
}

/** Só emojis (personalizados ou não) → exibe maior, como no Discord. */
export function isOnlyEmotes(html: string) {
  const root = parseHtml(html);
  const imgs = root.querySelectorAll("img[data-mx-emoticon]").length;
  const text = (root.textContent ?? "").trim();
  return imgs > 0 && imgs <= 12 && (text === "" || isOnlyEmoji(text));
}

const BLOCK_TAGS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol"]);

/**
 * Renderiza o formatted_body de forma segura: só uma lista fechada de tags vira
 * elemento; o resto vira texto. Imagens só aparecem se forem emojis mxc://.
 */
export function renderEmoteHtml(html: string, myId: string): ReactNode {
  const root = parseHtml(html);
  let n = 0;
  const walk = (node: Node): ReactNode => {
    const k = `h${n++}`;
    if (node.nodeType === Node.TEXT_NODE) return <span key={k}>{inline(node.textContent ?? "", k, myId)}</span>;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const kids = () => Array.from(el.childNodes).map(walk);
    switch (tag) {
      case "img": {
        const src = el.getAttribute("src") ?? "";
        const alt = el.getAttribute("alt") ?? el.getAttribute("title") ?? "";
        return src.startsWith("mxc://") ? <CustomEmoji key={k} mxc={src} alt={alt} className="custom-emoji inline" /> : alt;
      }
      case "br":
        return <br key={k} />;
      case "strong":
      case "b":
        return <strong key={k}>{kids()}</strong>;
      case "em":
      case "i":
        return <em key={k}>{kids()}</em>;
      case "del":
      case "s":
      case "strike":
        return <s key={k}>{kids()}</s>;
      case "u":
        return <u key={k}>{kids()}</u>;
      case "code":
        return <code key={k}>{el.textContent}</code>;
      case "pre":
        return (
          <pre key={k} className="code-block">
            {el.textContent}
          </pre>
        );
      case "blockquote":
        return (
          <span key={k} className="quote">
            {kids()}
          </span>
        );
      case "a": {
        const href = el.getAttribute("href") ?? "";
        return /^https?:\/\//i.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noreferrer noopener">
            {kids()}
          </a>
        ) : (
          <span key={k}>{kids()}</span>
        );
      }
      case "span":
        return el.hasAttribute("data-mx-spoiler") ? <Spoiler key={k}>{kids()}</Spoiler> : <span key={k}>{kids()}</span>;
      default:
        if (BLOCK_TAGS.has(tag)) {
          return (
            <span key={k}>
              {kids()}
              {el.nextSibling && <br />}
            </span>
          );
        }
        return <span key={k}>{kids()}</span>;
    }
  };
  return Array.from(root.childNodes).map(walk);
}

export function isOnlyEmoji(body: string): boolean {
  const t = body.trim();
  return t.length > 0 && t.length <= 24 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}

export function formatTime(ts: number, fmt: "24h" | "12h", seconds: boolean) {
  return new Date(ts).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: fmt === "12h",
  });
}

export function formatDay(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yest.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function formatBytes(n?: number) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
