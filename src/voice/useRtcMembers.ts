import { useEffect, useState } from "react";
import { MatrixRTCSessionEvent } from "matrix-js-sdk/lib/matrixrtc";
import type { Room } from "matrix-js-sdk";
import { getClient } from "../matrix/client";
import { VOICE_STATE_KEY } from "./voice";

export interface RtcMember {
  userId: string;
  deviceId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  streaming: boolean;
}

function read(room: Room): RtcMember[] {
  const session = getClient().matrixRTC.getRoomSession(room);
  const seen = new Set<string>();
  const out: RtcMember[] = [];
  for (const m of session.memberships) {
    if (m.isExpired()) continue;
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    const st = (m.applicationData?.[VOICE_STATE_KEY] ?? {}) as Partial<RtcMember>;
    out.push({
      userId: m.userId,
      deviceId: m.deviceId,
      muted: !!st.muted,
      deafened: !!st.deafened,
      video: !!st.video,
      streaming: !!st.streaming,
    });
  }
  return out;
}

/** Quem está conectado no canal de voz (lido das memberships MatrixRTC, sem precisar entrar). */
export function useRtcMembers(room: Room | null | undefined): RtcMember[] {
  const [members, setMembers] = useState<RtcMember[]>(() => (room ? read(room) : []));
  useEffect(() => {
    if (!room) {
      setMembers([]);
      return;
    }
    const session = getClient().matrixRTC.getRoomSession(room);
    const update = () => setMembers(read(room));
    update();
    session.on(MatrixRTCSessionEvent.MembershipsChanged, update);
    // As memberships podem expirar sem evento; reavalia periodicamente.
    const t = window.setInterval(update, 15000);
    return () => {
      session.off(MatrixRTCSessionEvent.MembershipsChanged, update);
      window.clearInterval(t);
    };
  }, [room]);
  return members;
}
