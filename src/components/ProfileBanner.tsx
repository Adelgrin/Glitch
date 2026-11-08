import { useMxc } from "../matrix/media";
import { useProfileStyle, type ProfileStyle } from "../matrix/profileStyle";
import { colorFor } from "./Avatar";

/** Banner do perfil: imagem, cor escolhida ou a cor automática do usuário. */
export default function ProfileBanner({
  userId,
  className = "profile-banner",
  draft,
}: {
  userId: string;
  className?: string;
  /** estilo ainda não salvo (prévia nas configurações) */
  draft?: ProfileStyle;
}) {
  const saved = useProfileStyle(userId);
  const st = draft ?? saved;
  const img = useMxc(st.bannerImage);
  return (
    <div
      className={className}
      style={{
        backgroundColor: st.bannerColor ?? colorFor(userId),
        backgroundImage: st.bannerImage && img ? `url(${img})` : undefined,
      }}
    />
  );
}
