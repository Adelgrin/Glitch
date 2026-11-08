import { useMxc } from "../matrix/media";

const PALETTE = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#00a8fc", "#9b59b6", "#1abc9c"];

export function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function initials(name: string) {
  const clean = name.replace(/^[@#!+]/, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}

interface Props {
  mxc?: string | null;
  name: string;
  id: string;
  size?: number;
  className?: string;
  speaking?: boolean;
  status?: "online" | "unavailable" | "offline" | null;
  shape?: "circle" | "server";
  onClick?: (e: React.MouseEvent) => void;
}

export default function Avatar({ mxc, name, id, size = 40, className = "", speaking, status, shape, onClick }: Props) {
  const url = useMxc(mxc, size > 64 ? 256 : 96);
  return (
    <div
      className={`avatar ${shape === "server" ? "server-shape" : ""} ${speaking ? "speaking" : ""} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      onClick={onClick}
      title={name}
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <div className="avatar-fallback" style={{ background: colorFor(id) }}>
          {initials(name)}
        </div>
      )}
      {status && <span className={`status-dot ${status}`} />}
    </div>
  );
}
