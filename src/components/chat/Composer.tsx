import { useEffect, useRef, useState } from "react";
import { EventType, MsgType, RelationType, type Room } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import { encryptAttachment } from "../../matrix/encrypt";
import { useAppStore } from "../../store/app";
import EmojiPicker from "./EmojiPicker";
import { stripReplyFallback } from "./format";
import { IconPlus, IconSmile, IconX } from "../icons";

function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

export async function sendFile(room: Room, file: File, replyTo?: string) {
  const c = getClient();
  const encrypted = c.isRoomEncrypted(room.roomId);
  const size = await imageSize(file);
  const msgtype = file.type.startsWith("image/")
    ? MsgType.Image
    : file.type.startsWith("video/")
      ? MsgType.Video
      : file.type.startsWith("audio/")
        ? MsgType.Audio
        : MsgType.File;
  const info: Record<string, unknown> = { mimetype: file.type, size: file.size };
  if (size) Object.assign(info, size);
  const content: Record<string, unknown> = { msgtype, body: file.name, info };
  if (encrypted) {
    const { data, info: encInfo } = await encryptAttachment(await file.arrayBuffer());
    const up = await c.uploadContent(new Blob([data]), { type: "application/octet-stream", includeFilename: false });
    content.file = { ...encInfo, url: up.content_uri };
  } else {
    const up = await c.uploadContent(file, { name: file.name, type: file.type });
    content.url = up.content_uri;
  }
  if (replyTo) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo } };
  await c.sendMessage(room.roomId, content as never);
}

export default function Composer({ room, onSent }: { room: Room; onSent(): void }) {
  const c = getClient();
  const me = c.getUserId()!;
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const replyTo = useAppStore((s) => s.replyTo[room.roomId]);
  const editing = useAppStore((s) => s.editing[room.roomId]);
  const setReplyTo = useAppStore((s) => s.setReplyTo);
  const setEditing = useAppStore((s) => s.setEditing);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const drafts = useRef<Record<string, string>>({});

  // Rascunho por sala
  useEffect(() => {
    setText(drafts.current[room.roomId] ?? "");
    ta.current?.focus();
  }, [room.roomId]);
  useEffect(() => {
    drafts.current[room.roomId] = text;
  }, [text, room.roomId]);

  // Ao entrar em modo de edição, carrega o texto da mensagem
  useEffect(() => {
    if (!editing) return;
    const ev = room.findEventById(editing);
    if (ev) setText(stripReplyFallback(String(ev.getContent().body ?? "")));
    ta.current?.focus();
  }, [editing, room]);

  useEffect(() => {
    if (replyTo) ta.current?.focus();
  }, [replyTo]);

  // Auto-altura
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, [text]);

  const typing = (v: string) => {
    const now = Date.now();
    if (v && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      c.sendTyping(room.roomId, true, 5000).catch(() => undefined);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    lastTyping.current = 0;
    c.sendTyping(room.roomId, false, 0).catch(() => undefined);
    if (editing) {
      setEditing(room.roomId, undefined);
      await c.sendMessage(room.roomId, {
        msgtype: MsgType.Text,
        body: `* ${body}`,
        "m.new_content": { msgtype: MsgType.Text, body },
        "m.relates_to": { rel_type: RelationType.Replace, event_id: editing },
      } as never);
      return;
    }
    const content: Record<string, unknown> = { msgtype: MsgType.Text, body };
    if (body.startsWith("/me ")) {
      content.msgtype = MsgType.Emote;
      content.body = body.slice(4);
    }
    if (replyTo) {
      content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo } };
      setReplyTo(room.roomId, undefined);
    }
    onSent();
    await c.sendMessage(room.roomId, content as never).catch((e) => alert("Falha ao enviar: " + e.message));
  };

  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try {
        await sendFile(room, f, replyTo);
        if (replyTo) setReplyTo(room.roomId, undefined);
        onSent();
      } catch (e) {
        alert(`Falha ao enviar ${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setUploading(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      setReplyTo(room.roomId, undefined);
      if (editing) {
        setEditing(room.roomId, undefined);
        setText("");
      }
    } else if (e.key === "ArrowUp" && !text) {
      // Editar a última mensagem própria
      const evs = room.getLiveTimeline().getEvents();
      for (let i = evs.length - 1; i >= 0; i--) {
        const ev = evs[i];
        if (
          ev.getSender() === me &&
          ev.getType() === EventType.RoomMessage &&
          !ev.isRelation(RelationType.Replace) &&
          !ev.isRedacted() &&
          ev.getContent().msgtype === MsgType.Text
        ) {
          e.preventDefault();
          setEditing(room.roomId, ev.getId()!);
          break;
        }
      }
    }
  };

  const canSend = room.currentState.maySendMessage(me);
  const replyEv = replyTo ? room.findEventById(replyTo) : null;
  const placeholder = canSend ? `Conversar em ${room.name}` : "Você não tem permissão para enviar mensagens aqui.";

  return (
    <div
      className="composer-wrap"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      {(replyEv || editing) && (
        <div className="composer-context">
          {editing ? (
            <span>Editando mensagem — <kbd>Esc</kbd> para cancelar</span>
          ) : (
            <span>
              Respondendo a <strong>{room.getMember(replyEv!.getSender()!)?.name ?? replyEv!.getSender()}</strong>
            </span>
          )}
          <button
            className="icon-btn tiny"
            onClick={() => {
              setReplyTo(room.roomId, undefined);
              if (editing) {
                setEditing(room.roomId, undefined);
                setText("");
              }
            }}
          >
            <IconX size={14} />
          </button>
        </div>
      )}
      {uploading && <div className="composer-context">Enviando {uploading}…</div>}
      <div className={`composer ${replyEv || editing ? "attached" : ""}`}>
        <button className="composer-btn" title="Enviar arquivo" disabled={!canSend} onClick={() => fileInput.current?.click()}>
          <IconPlus size={18} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={ta}
          rows={1}
          value={text}
          disabled={!canSend}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            typing(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void upload(files);
            }
          }}
        />
        <div className="composer-emoji">
          <button className="composer-btn" title="Emoji" disabled={!canSend} onClick={() => setPicker((p) => !p)}>
            <IconSmile size={22} />
          </button>
          {picker && (
            <EmojiPicker
              onPick={(e) => {
                setText((t) => t + e);
                setPicker(false);
                ta.current?.focus();
              }}
              onClose={() => setPicker(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
