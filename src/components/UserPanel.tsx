import { getClient } from "../matrix/client";
import { useAppStore, useVersion } from "../store/app";
import { toggleDeafen, toggleMute, useVoice } from "../voice/voice";
import Avatar from "./Avatar";
import { IconHeadphones, IconHeadphonesOff, IconMic, IconMicOff, IconSettings } from "./icons";

export default function UserPanel() {
  useVersion();
  const c = getClient();
  const me = c.getUserId()!;
  const user = c.getUser(me);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const speaking = useVoice((s) => s.participants.find((p) => p.isLocal)?.speaking);
  const openModal = useAppStore((s) => s.openModal);
  const name = user?.displayName || me;

  return (
    <div className="user-panel">
      <div className="user-panel-info" onClick={() => openModal({ type: "userSettings", tab: "account" })}>
        <Avatar mxc={user?.avatarUrl} name={name} id={me} size={32} status="online" speaking={speaking} />
        <div className="user-panel-names">
          <div className="ellipsis strong">{name}</div>
          <div className="ellipsis muted tiny">{me}</div>
        </div>
      </div>
      <button className={`icon-btn ${muted ? "danger" : ""}`} title={muted ? "Ativar microfone" : "Silenciar"} onClick={toggleMute}>
        {muted ? <IconMicOff /> : <IconMic />}
      </button>
      <button
        className={`icon-btn ${deafened ? "danger" : ""}`}
        title={deafened ? "Ativar áudio" : "Desativar áudio"}
        onClick={toggleDeafen}
      >
        {deafened ? <IconHeadphonesOff /> : <IconHeadphones />}
      </button>
      <button className="icon-btn" title="Configurações de usuário" onClick={() => openModal({ type: "userSettings" })}>
        <IconSettings />
      </button>
    </div>
  );
}
