/** Emojis padrão (emojibase, nomes em português), carregados sob demanda. */

export interface EmojiItem {
  e: string;
  label: string;
  /** texto de busca: nome + palavras-chave, sem acentos */
  search: string;
  group: number;
  /** variações de tom de pele (1 a 5) */
  skins?: string[];
}

export const EMOJI_GROUPS: { id: number; name: string; icon: string }[] = [
  { id: 0, name: "Rostos e emoções", icon: "😀" },
  { id: 1, name: "Pessoas", icon: "👋" },
  { id: 3, name: "Animais e natureza", icon: "🐻" },
  { id: 4, name: "Comida e bebida", icon: "🍔" },
  { id: 5, name: "Viagens e lugares", icon: "✈️" },
  { id: 6, name: "Atividades", icon: "⚽" },
  { id: 7, name: "Objetos", icon: "💡" },
  { id: 8, name: "Símbolos", icon: "❤️" },
  { id: 9, name: "Bandeiras", icon: "🏳️" },
];

/** Versão Unicode máxima: emojis mais novos ainda não aparecem nas fontes do Windows. */
const MAX_VERSION = 15;

export function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface RawEmoji {
  label: string;
  emoji: string;
  group?: number;
  order?: number;
  version?: number;
  tags?: string[];
  skins?: { emoji: string; tone?: number | number[] }[];
}

let cache: Promise<EmojiItem[]> | null = null;

export function loadEmojis(): Promise<EmojiItem[]> {
  if (!cache) {
    cache = import("emojibase-data/pt/data.json").then((mod) => {
      const raw = (mod.default ?? mod) as unknown as RawEmoji[];
      return raw
        .filter((r) => typeof r.group === "number" && r.group !== 2 && (r.version ?? 0) <= MAX_VERSION)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((r) => {
          const skins = r.skins
            ?.filter((s) => typeof s.tone === "number")
            .sort((a, b) => (a.tone as number) - (b.tone as number))
            .map((s) => s.emoji);
          return {
            e: r.emoji,
            label: r.label,
            search: normalize([r.label, ...(r.tags ?? [])].join(" ")),
            group: r.group!,
            skins: skins?.length === 5 ? skins : undefined,
          };
        });
    });
  }
  return cache;
}

/* ------------------------------------------------------------------ */
/* Recentes e tom de pele (por navegador)                              */
/* ------------------------------------------------------------------ */

const RECENT_KEY = "mc.recentEmoji";
const TONE_KEY = "mc.skinTone";

/** Recentes: emoji unicode ou "mxc://…|shortcode" para personalizados. */
export function getRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 32) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: string) {
  try {
    const list = [item, ...getRecent().filter((x) => x !== item)].slice(0, 32);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* sem armazenamento */
  }
}

export function getSkinTone(): number {
  try {
    const n = Number(localStorage.getItem(TONE_KEY) ?? 0);
    return n >= 0 && n <= 5 ? n : 0;
  } catch {
    return 0;
  }
}

export function setSkinTone(n: number) {
  try {
    localStorage.setItem(TONE_KEY, String(n));
  } catch {
    /* sem armazenamento */
  }
}

export function withTone(item: EmojiItem, tone: number) {
  return tone > 0 && item.skins ? item.skins[tone - 1] : item.e;
}
