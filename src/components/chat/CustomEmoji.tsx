import { useMxc } from "../../matrix/media";

/** Emoji/figurinha personalizada (mxc://). */
export default function CustomEmoji({
  mxc,
  alt,
  size,
  className = "custom-emoji",
}: {
  mxc: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  const url = useMxc(mxc);
  const style = size ? { width: size, height: size } : undefined;
  return url ? (
    <img className={className} src={url} alt={alt} title={alt} style={style} draggable={false} />
  ) : (
    <span className={`${className} loading`} style={style} title={alt} />
  );
}
