/**
 * Ponte com a voz nativa (Rust/Tauri).
 *
 * No build Tauri/Linux o WebKitGTK não expõe WebRTC, então o livekit-client não
 * funciona. O backend Rust (src-tauri/src/voice.rs) roda o SDK oficial do
 * LiveKit nativamente e repassa os eventos por "voice://evt".
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "../desktop";

export interface NativeParticipant {
  identity: string;
  speaking: boolean;
  micMuted: boolean;
  hasMic: boolean;
  camera: boolean;
  screen: boolean;
}

export type NativeEvent =
  | {
      type: "snapshot";
      status: "connected" | "reconnecting";
      local: NativeParticipant;
      participants: NativeParticipant[];
      quality: Record<string, number>;
    }
  | { type: "disconnected"; expected: boolean }
  | { type: "error"; message: string };

export const nativeVoiceAvailable = (): boolean => isTauri;

let listener: ((e: NativeEvent) => void) | null = null;
let unlisten: UnlistenFn | null = null;

async function ensureListener() {
  if (unlisten) return;
  unlisten = await listen<NativeEvent>("voice://evt", (e) => {
    listener?.(e.payload);
    if (e.payload.type === "disconnected") {
      // Sessão encerrada: solta o listener para a próxima chamada
      listener = null;
      unlisten?.();
      unlisten = null;
    }
  });
}

export async function nativeConnect(url: string, jwt: string, muted: boolean, onEvent: (e: NativeEvent) => void): Promise<void> {
  await ensureListener();
  listener = onEvent;
  await invoke("voice_connect", { url, jwt, muted });
}

export async function nativeLeave(): Promise<void> {
  await invoke("voice_leave").catch(() => undefined);
}

export async function nativeSetMicMuted(muted: boolean): Promise<void> {
  await invoke("voice_set_mic_muted", { muted });
}

export async function nativeSetDeafened(deafened: boolean): Promise<void> {
  await invoke("voice_set_deafened", { deafened });
}

export async function nativeSetVolumes(volumes: Record<string, number>): Promise<void> {
  await invoke("voice_set_volumes", { volumes });
}

export interface NativeDevices {
  inputs: Array<{ id: string; name: string }>;
  outputs: Array<{ id: string; name: string }>;
}

export async function nativeDevices(): Promise<NativeDevices> {
  const [inputs, outputs] = await invoke<[NativeDevices["inputs"], NativeDevices["outputs"]]>("voice_devices");
  return { inputs, outputs };
}

export async function nativeSetDevices(inputId?: string, outputId?: string): Promise<void> {
  await invoke("voice_set_devices", { inputId, outputId });
}
