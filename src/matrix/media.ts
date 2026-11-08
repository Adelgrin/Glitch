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
