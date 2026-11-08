import { useState } from "react";
import { EventType } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import { createCategory, createChannel, createServer, isVoiceRoom, removeChild } from "../../matrix/rooms";
import { uploadBlob } from "../../matrix/media";
import { useAppStore } from "../../store/app";
import { leaveVoice, useVoice } from "../../voice/voice";
import type { CropResult } from "../ImageCropper";
import { IconHash, IconPlus, IconSpeaker } from "../icons";
import { ImageField, Modal } from "./Modal";

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function CreateServerModal({ onClose }: { onClose(): void }) {
  const me = getClient().getUser(getClient().getUserId()!);
  const [name, setName] = useState(`Servidor de ${me?.displayName ?? "alguém"}`);
  const [isPublic, setPublic] = useState(false);
  const [icon, setIcon] = useState<CropResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const avatarUrl = icon ? await uploadBlob(icon.blob, "icon.png") : undefined;
      const id = await createServer({ name: name.trim(), isPublic, avatarUrl });
      useAppStore.getState().selectSpace(id);
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Personalize seu servidor"
      subtitle="Dê uma personalidade ao seu novo servidor com um nome e um ícone. Você pode mudar depois."
      onClose={onClose}
      footer={
        <>
          <button className="btn link" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={submit}>
            {busy ? "Criando…" : "Criar"}
          </button>
        </>
      }
    >
      <div className="center-col">
        <ImageField
          preview={icon?.dataUrl}
          aspect={1}
          shape="circle"
          outputWidth={512}
          label="Ícone do servidor"
          onResult={setIcon}
          onRemove={() => setIcon(null)}
          placeholder={
            <div className="upload-placeholder">
              <IconPlus size={22} />
              <span>ENVIAR</span>
            </div>
          }
        />
      </div>
      <label className="field">
        <span>Nome do servidor</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="check">
        <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
        Servidor público (qualquer pessoa pode entrar pelo endereço)
      </label>
      <p className="muted tiny">
        Criaremos os canais <strong>#geral</strong> e <strong>🔊 Geral</strong>. Membros do servidor entram nos canais sem
        precisar de convite.
      </p>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

export function JoinServerModal({ onClose }: { onClose(): void }) {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      let a = addr.trim();
      const m = /matrix\.to\/#\/([^?]+)/.exec(a);
      if (m) a = decodeURIComponent(m[1]);
      const room = await getClient().joinRoom(a);
      if (room.isSpaceRoom()) useAppStore.getState().selectSpace(room.roomId);
      else {
        useAppStore.getState().selectSpace(null);
        useAppStore.getState().selectRoom(room.roomId);
      }
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Entrar em um servidor"
      subtitle="Cole o endereço ou link de convite abaixo."
      onClose={onClose}
      footer={
        <>
          <button className="btn link" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" disabled={busy || !addr.trim()} onClick={submit}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Endereço ou link</span>
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="#meuservidor:matrix.org ou https://matrix.to/#/…"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

export function CreateChannelModal({
  onClose,
  spaceId,
  parentId,
  voice: initialVoice,
}: {
  onClose(): void;
  spaceId: string;
  parentId?: string;
  voice?: boolean;
}) {
  const [voice, setVoice] = useState(!!initialVoice);
  const [name, setName] = useState("");
  const [encrypted, setEncrypted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const space = getClient().getRoom(spaceId);
  const isPublic = space?.getJoinRule() === "public";

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const n = voice ? name.trim() : name.trim().toLowerCase().replace(/\s+/g, "-");
      const id = await createChannel({ spaceId, parentId, name: n, voice, encrypted, isPublic });
      useAppStore.getState().selectRoom(id);
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Criar canal"
      onClose={onClose}
      footer={
        <>
          <button className="btn link" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={submit}>
            {busy ? "Criando…" : "Criar canal"}
          </button>
        </>
      }
    >
      <div className="field-label">Tipo de canal</div>
      <div className={`radio-card ${!voice ? "active" : ""}`} onClick={() => setVoice(false)}>
        <IconHash size={24} />
        <div>
          <strong>Texto</strong>
          <div className="muted small">Envie mensagens, imagens, GIFs, opiniões e piadas</div>
        </div>
        <span className="radio-dot" />
      </div>
      <div className={`radio-card ${voice ? "active" : ""}`} onClick={() => setVoice(true)}>
        <IconSpeaker size={24} />
        <div>
          <strong>Voz</strong>
          <div className="muted small">Converse por voz, vídeo e compartilhe a tela</div>
        </div>
        <span className="radio-dot" />
      </div>
      <label className="field">
        <span>Nome do canal</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={voice ? "Sala de jogos" : "novo-canal"}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
        />
      </label>
      {!voice && (
        <label className="check">
          <input type="checkbox" checked={encrypted} onChange={(e) => setEncrypted(e.target.checked)} />
          Criptografia de ponta a ponta (não pode ser desativada depois)
        </label>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

export function CreateCategoryModal({ onClose, spaceId }: { onClose(): void; spaceId: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    try {
      await createCategory(spaceId, name.trim());
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Criar categoria"
      onClose={onClose}
      footer={
        <>
          <button className="btn link" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={submit}>
            Criar categoria
          </button>
        </>
      }
    >
      <label className="field">
        <span>Nome da categoria</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova categoria" autoFocus />
      </label>
      <p className="muted tiny">Categorias são sub-espaços Matrix. Outros clientes as mostram como espaços aninhados.</p>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

export function ChannelSettingsModal({ onClose, roomId, spaceId }: { onClose(): void; roomId: string; spaceId?: string }) {
  const c = getClient();
  const room = c.getRoom(roomId);
  const [name, setName] = useState(room?.name ?? "");
  const [topic, setTopic] = useState(
    (room?.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic as string) ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!room) return null;
  const me = c.getUserId()!;
  const canEdit = room.currentState.maySendStateEvent(EventType.RoomName, me);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (name !== room.name) await c.setRoomName(roomId, name);
      const oldTopic = room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic ?? "";
      if (topic !== oldTopic) await c.setRoomTopic(roomId, topic);
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remover o canal "${room.name}" do servidor? Os membros continuarão com o histórico.`)) return;
    try {
      const parent = room.currentState.getStateEvents(EventType.SpaceParent)?.[0]?.getStateKey() ?? spaceId;
      if (parent) await removeChild(parent, roomId);
      if (useVoice.getState().roomId === roomId) await leaveVoice();
      await c.leave(roomId);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Modal
      title={`${isVoiceRoom(room) ? "🔊" : "#"} ${room.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn danger-outline" onClick={remove}>
            Remover canal
          </button>
          <span className="flex-spacer" />
          <button className="btn link" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !canEdit} onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <label className="field">
        <span>Nome do canal</span>
        <input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Tópico</span>
        <textarea value={topic} disabled={!canEdit} rows={3} onChange={(e) => setTopic(e.target.value)} />
      </label>
      <div className="muted tiny selectable">ID: {roomId}</div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
