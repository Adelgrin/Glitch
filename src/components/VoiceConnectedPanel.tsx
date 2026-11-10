import { getClient } from "../matrix/client";
import { useAppStore } from "../store/app";
import { leaveVoice, toggleCamera, toggleScreenShare, useVoice, joinVoice } from "../voice/voice";
import { IconPhoneOff, IconScreenUp, IconSignal, IconVideo, IconVideoOff } from "./icons";

export default function VoiceConnectedPanel() {
  const status = useVoice((s) => s.status);
  const roomId = useVoice((s) => s.roomId);
  const error = useVoice((s) => s.error);
  const cameraOn = useVoice((s) => s.cameraOn);
  const screenOn = useVoice((s) => s.screenOn);
  if (status === "idle") return null;

  const c = getClient();
  const room = roomId ? c.getRoom(roomId) : null;
  const parentId = room?.currentState.getStateEvents("m.space.parent")?.[0]?.getStateKey();
  const parent = parentId ? c.getRoom(parentId) : null;

  const goTo = () => {
    if (!roomId) return;
    const st = useAppStore.getState();
    // encontra o servidor raiz para selecionar
    let top = parent;
    const grand = top?.currentState.getStateEvents("m.space.parent")?.[0]?.getStateKey();
    if (grand && c.getRoom(grand)) top = c.getRoom(grand);
    st.selectSpace(top?.roomId ?? null);
    st.selectRoom(roomId);
  };

  return (
    <div className="voice-panel">
      <div className="voice-panel-top">
        <div className="voice-panel-status">
          <div className={`voice-status-line ${status}`}>
            <IconSignal size={16} />
            {status === "connecting" && "Conectando…"}
            {status === "connected" && (error ?? "Voz conectada")}
            {status === "error" && "Falha na conexão"}
          </div>
          <div className="voice-panel-where ellipsis" onClick={goTo} title={error ?? undefined}>
            {status === "error" ? error : `${room?.name ?? "Canal"}${parent ? ` / ${parent.name}` : ""}`}
          </div>
        </div>
        {status === "error" && roomId && (
          <button className="btn tiny secondary" onClick={() => joinVoice(roomId)}>
            Tentar de novo
          </button>
        )}
        <button className="icon-btn" title="Desconectar" onClick={() => leaveVoice()}>
          <IconPhoneOff />
        </button>
      </div>
      {status === "connected" && (
        <div className="voice-panel-actions">
          <button
            className={`btn small ${cameraOn ? "active" : "secondary"}`}
            title={cameraOn ? "Desligar câmera" : "Ligar câmera"}
            onClick={toggleCamera}
          >
            {cameraOn ? <IconVideoOff size={18} /> : <IconVideo size={18} />}
            <span className="btn-label">Câmera</span>
          </button>
          <button
            className={`btn small ${screenOn ? "active" : "secondary"}`}
            title={screenOn ? "Parar transmissão" : "Transmitir a tela"}
            onClick={() => toggleScreenShare()}
          >
            <IconScreenUp size={18} />
            <span className="btn-label">{screenOn ? "Parar" : "Transmitir"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
