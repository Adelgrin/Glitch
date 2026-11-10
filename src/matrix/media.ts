import { useEffect, useState } from "react";
import { getClient, maybeClient } from "./client";

/** Informações de arquivo criptografado (EncryptedFile do spec). */
export interface EncryptedFileInfo {
  url: string;
  key: JsonWebKey;
  iv: string;
  hashes?: Record<string, string>;
  v?: string;
}

const cache = new Map<string, Promise<string | null>>();

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  let s = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decryptAttachment(data: ArrayBuffer, info: EncryptedFileInfo): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("jwk", info.key, { name: "AES-CTR" }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: b64ToBytes(info.iv), length: 64 }, key, data);
}

async function authedFetch(url: string): Promise<Response> {
  const c = getClient();
  return fetch(url, { headers: { Authorization: `Bearer ${c.getAccessToken()}` } });
}

async function download(mxc: string, size?: number, method: "crop" | "scale" = "crop"): Promise<Blob | null> {
  const c = getClient();
  // Mídia autenticada (Matrix 1.11+) e, se falhar, o endpoint antigo.
  const authUrl = size
    ? c.mxcUrlToHttp(mxc, size, size, method, false, true, true)
    : c.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
  if (authUrl) {
    try {
      const r = await authedFetch(authUrl);
      if (r.ok) return await r.blob();
    } catch {
      /* tenta o legado */
    }
  }
  const legacy = size
    ? c.mxcUrlToHttp(mxc, size, size, method, false, true, false)
    : c.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, false);
  if (legacy) {
    const r = await fetch(legacy);
    if (r.ok) return await r.blob();
  }
  return null;
}

export function fetchMxc(mxc: string, size?: number, method: "crop" | "scale" = "crop"): Promise<string | null> {
  const key = `${mxc}|${size ?? "full"}|${method}`;
  let p = cache.get(key);
  if (!p) {
    p = download(mxc, size, method)
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

export function fetchEncrypted(file: EncryptedFileInfo, mime?: string): Promise<string | null> {
  const key = `enc|${file.url}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const blob = await download(file.url);
      if (!blob) return null;
      const plain = await decryptAttachment(await blob.arrayBuffer(), file);
      return URL.createObjectURL(new Blob([plain], { type: mime || "application/octet-stream" }));
    })().catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** Campos de mídia do conteúdo de uma mensagem (m.image, m.sticker…). */
export interface MediaContent {
  body?: unknown;
  url?: string;
  file?: EncryptedFileInfo;
  info?: { mimetype?: string; w?: number; h?: number; size?: number };
}

/** URL blob: do arquivo original de uma mensagem de mídia (descriptografa se precisar). */
export function contentBlobUrl(content: MediaContent): Promise<string | null> {
  if (content.file) return fetchEncrypted(content.file, content.info?.mimetype);
  if (content.url) return fetchMxc(content.url);
  return Promise.resolve(null);
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** Nome de arquivo seguro para salvar, com extensão a partir do tipo quando faltar. */
export function mediaFilename(body: unknown, mime?: string, fallback = "imagem") {
  let name = (typeof body === "string" && body.trim()) || fallback;
  name = name.replace(/[\\/:*?"<>|\n\r]+/g, "_").slice(0, 120);
  if (!/\.[a-z0-9]{2,5}$/i.test(name) && mime) name += `.${EXT[mime] ?? mime.split("/")[1]?.split("+")[0] ?? "bin"}`;
  return name;
}

/** Salva uma URL (blob:) como arquivo — o navegador/app pergunta onde salvar ou usa Downloads. */
export function saveUrlAs(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Copia uma imagem (URL blob:) para a área de transferência. A área de transferência
 * só aceita PNG de forma confiável, então outros formatos são convertidos.
 */
export async function copyImageToClipboard(url: string) {
  const blob = await (await fetch(url)).blob();
  let png = blob;
  if (blob.type !== "image/png") {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível converter a imagem."))), "image/png"),
    );
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** Baixa o arquivo original de uma mensagem de mídia. */
export async function downloadContent(content: MediaContent) {
  const url = await contentBlobUrl(content);
  if (!url) throw new Error("Não foi possível baixar o arquivo.");
  saveUrlAs(url, mediaFilename(content.body, content.info?.mimetype));
}

/** Hook: devolve uma URL blob: para um mxc:// (com autenticação). */
export function useMxc(mxc?: string | null, size?: number, method: "crop" | "scale" = "crop"): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (!mxc || !mxc.startsWith("mxc://") || !maybeClient()) return;
    fetchMxc(mxc, size, method).then((u) => {
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [mxc, size, method]);
  return url;
}

export function useEncryptedMedia(file?: EncryptedFileInfo, mime?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (!file) return;
    fetchEncrypted(file, mime).then((u) => {
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [file?.url, mime]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

export async function uploadBlob(blob: Blob, name: string): Promise<string> {
  const res = await getClient().uploadContent(blob, { name, type: blob.type });
  return res.content_uri;
}
