import type { Room } from "matrix-js-sdk";
import { useMxc } from "../matrix/media";
import { getDirectRoomIds, getDmPartner, isVoiceRoom } from "../matrix/rooms";
import Avatar from "./Avatar";
import { IconAt, IconHash, IconSpeaker } from "./icons";

/**
 * Ícone de um canal: a imagem definida nas configurações da sala; sem imagem, o símbolo
 * do tipo (# texto, alto-falante voz). Em mensagens diretas, a foto da outra pessoa.
 */
export default function RoomIcon({ room, size = 24, className = "" }: { room: Room; size?: number; className?: string }) {
  const isDm = getDirectRoomIds().has(room.roomId);
  const partner = isDm ? getDmPartner(room) : null;
  const url = useMxc(isDm ? null : room.getMxcAvatarUrl(), Math.max(64, size * 2));

  if (isDm && partner) {
    return <Avatar mxc={partner.getMxcAvatarUrl()} name={partner.name} id={partner.userId} size={size} className={className} />;
  }
  if (url) {
    return <img className={`room-icon ${className}`} src={url} alt="" style={{ width: size, height: size }} draggable={false} />;
  }
  const glyph = Math.round(size * (size > 40 ? 0.55 : 0.9));
  return (
    <span className={`room-icon glyph ${className}`} style={{ width: size, height: size }} aria-hidden>
      {isDm ? <IconAt size={glyph} /> : isVoiceRoom(room) ? <IconSpeaker size={glyph} /> : <IconHash size={glyph} />}
    </span>
  );
}
