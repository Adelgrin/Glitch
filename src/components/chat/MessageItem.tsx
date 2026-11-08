import { useRef, useState } from "react";
import { EventType, RelationType, type MatrixEvent, type Room } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import { useEncryptedMedia, useMxc, type EncryptedFileInfo } from "../../matrix/media";
import { useAppStore } from "../../store/app";
import { useSettings } from "../../store/settings";
import Avatar, { colorFor } from "../Avatar";
import ExpressionPicker from "./ExpressionPicker";
import CustomEmoji from "./CustomEmoji";
import { formatBytes, formatTime, hasEmotes, isOnlyEmoji, isOnlyEmotes, renderBody, renderEmoteHtml, stripReplyFallback } from "./format";
import { IconDownload, IconEdit, IconReply, IconSmile, IconTrash } from "../icons";

interface Props {
  room: Room;
  ev: MatrixEvent;
  grouped: boolean;
  canRedactOthers: boolean;
  onOpenImage(url: string): void;
}

function MessageItemInner({ room, ev, grouped, canRedactOthers, onOpenImage }: Props) {
  const c = getClient();
  const me = c.getUserId()!;
  const openModal = useAppStore((s) => s.openModal);
  const setReplyTo = useAppStore((s) => s.setReplyTo);
  const setEditing = useAppStore((s) => s.setEditing);
  const timeFmt = useSettings((s) => s.appearance.timeFormat);
  const showSeconds = useSettings((s) => s.appearance.showSeconds);
  const [picker, setPicker] = useState(false);
  const reactBtn = useRef<HTMLButtonElement>(null);

  const sender = ev.getSender()!;
  const member = room.getMember(sender);
  const name = member?.name ?? sender;
  const content = ev.getContent();
  const isMine = sender === me;
  const ts = ev.getTs();
  const edited = !!ev.replacingEventId();

  if (ev.getType() === EventType.RoomMember) return <MemberLine ev={ev} room={room} />;

  const body = typeof content.body === "string" ? stripReplyFallback(content.body) : "";
  const mentionsMe = !isMine && (body.includes(me) || (!!c.getUser(me)?.displayName && body.includes(c.getUser(me)!.displayName!)));
  const replyId = content["m.relates_to"]?.["m.in_reply_to"]?.event_id as string | undefined;

  /** key = emoji unicode ou mxc:// (emoji personalizado, com o :atalho: em `shortcode`, como no Cinny) */
  const react = async (key: string, shortcode?: string) => {
    setPicker(false);
    const rels = room.relations.getChildEventsForEvent(ev.getId()!, RelationType.Annotation, EventType.Reaction);
    const mine = rels?.getAnnotationsBySender()?.[me];
    const existing = mine ? [...mine].find((r) => r.getRelation()?.key === key) : undefined;
    if (existing) await c.redactEvent(room.roomId, existing.getId()!);
    else
      await c.sendEvent(room.roomId, EventType.Reaction, {
        "m.relates_to": { rel_type: RelationType.Annotation, event_id: ev.getId()!, key },
        ...(shortcode ? { shortcode: `:${shortcode}:` } : {}),
      } as never);
  };

  const remove = async () => {
    if (confirm("Apagar esta mensagem?")) await c.redactEvent(room.roomId, ev.getId()!);
  };

  return (
    <div
      className={`message ${grouped ? "grouped" : ""} ${mentionsMe ? "mentioned" : ""} ${ev.status ? "pending" : ""}`}
      data-event={ev.getId()}
    >
      {replyId && <ReplyPreview room={room} eventId={replyId} />}
      <div className="message-row">
        <div className="message-gutter">
          {grouped ? (
            <span className="message-hover-time">{formatTime(ts, timeFmt, false)}</span>
          ) : (
            <Avatar
              mxc={member?.getMxcAvatarUrl()}
              name={name}
              id={sender}
              size={40}
              onClick={() => openModal({ type: "userProfile", userId: sender, roomId: room.roomId })}
            />
          )}
        </div>
        <div className="message-main">
          {!grouped && (
            <div className="message-header">
              <span
                className="message-author"
                style={{ color: powerColor(member?.powerLevel ?? 0) ?? undefined }}
                onClick={() => openModal({ type: "userProfile", userId: sender, roomId: room.roomId })}
              >
                {name}
              </span>
              <span className="message-time">{formatTime(ts, timeFmt, showSeconds)}</span>
            </div>
          )}
          <MessageBody ev={ev} body={body} myId={me} onOpenImage={onOpenImage} edited={edited} />
          <Reactions room={room} ev={ev} myId={me} onReact={react} />
        </div>
      </div>
      {!ev.status && (
        <div className={`message-toolbar ${picker ? "open" : ""}`}>
          <button ref={reactBtn} className="icon-btn tiny" title="Reagir" onClick={() => setPicker((p) => !p)}>
            <IconSmile size={18} />
          </button>
          <button className="icon-btn tiny" title="Responder" onClick={() => setReplyTo(room.roomId, ev.getId()!)}>
            <IconReply size={18} />
          </button>
          {isMine && content.msgtype && ["m.text", "m.emote", "m.notice"].includes(content.msgtype) && (
            <button className="icon-btn tiny" title="Editar" onClick={() => setEditing(room.roomId, ev.getId()!)}>
              <IconEdit size={18} />
            </button>
          )}
          {(isMine || canRedactOthers) && (
            <button className="icon-btn tiny danger" title="Apagar" onClick={remove}>
              <IconTrash size={18} />
            </button>
          )}
          {picker && (
            <ExpressionPicker
              room={room}
              mode="reaction"
              anchor={reactBtn.current}
              onEmoji={(e) => void (e.kind === "unicode" ? react(e.text) : react(e.url, e.shortcode))}
              onClose={() => setPicker(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Sem memo: reações/edições mudam o evento sem mudar as props.
export const MessageItem = MessageItemInner;

function powerColor(pl: number): string | null {
  if (pl >= 100) return "var(--admin-color, #f0b232)";
  if (pl >= 50) return "var(--mod-color, #3ba55d)";
  return null;
}

function MemberLine({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const content = ev.getContent();
  const prev = ev.getPrevContent();
  const target = ev.getStateKey()!;
  const name = content.displayname ?? room.getMember(target)?.name ?? target;
  let text: string | null = null;
  if (content.membership === "join" && prev.membership !== "join") text = `${name} entrou no canal.`;
  else if (content.membership === "leave" && prev.membership === "join")
    text = ev.getSender() === target ? `${prev.displayname ?? name} saiu.` : `${prev.displayname ?? name} foi removido(a).`;
  else if (content.membership === "invite") text = `${name} foi convidado(a).`;
  else if (content.membership === "ban") text = `${name} foi banido(a).`;
  if (!text) return null;
  return (
    <div className="system-line">
      <span className="system-arrow" style={{ color: content.membership === "join" ? "#3ba55d" : "#ed4245" }}>
        {content.membership === "join" ? "→" : "←"}
      </span>
      {text}
    </div>
  );
}

function ReplyPreview({ room, eventId }: { room: Room; eventId: string }) {
  const ev = room.findEventById(eventId);
  const sender = ev?.getSender();
  const name = sender ? (room.getMember(sender)?.name ?? sender) : "Mensagem";
  const body = ev ? stripReplyFallback(String(ev.getContent().body ?? "")) : "Mensagem original não carregada";
  return (
    <div
      className="reply-preview"
      onClick={() => document.querySelector(`[data-event="${CSS.escape(eventId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
    >
      <span className="reply-spine" />
      {sender && (
        <Avatar mxc={room.getMember(sender)?.getMxcAvatarUrl()} name={name} id={sender} size={16} />
      )}
      <span className="reply-name" style={{ color: sender ? colorFor(sender) : undefined }}>
        {name}
      </span>
      <span className="ellipsis muted">{body}</span>
    </div>
  );
}

function MessageBody({
  ev,
  body,
  myId,
  edited,
  onOpenImage,
}: {
  ev: MatrixEvent;
  body: string;
  myId: string;
  edited: boolean;
  onOpenImage(url: string): void;
}) {
  const content = ev.getContent();
  if (ev.getType() === EventType.RoomMessageEncrypted || ev.isDecryptionFailure()) {
    return <div className="message-body muted italic">🔒 Não foi possível descriptografar esta mensagem.</div>;
  }
  if (ev.getType() === EventType.Sticker) {
    return <MediaImage content={content} onOpen={onOpenImage} sticker />;
  }
  // Mensagens com emojis personalizados vêm em HTML (<img data-mx-emoticon>)
  const html = content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string" ? content.formatted_body : null;
  if (html && hasEmotes(html) && (content.msgtype === "m.text" || content.msgtype === "m.emote" || content.msgtype === "m.notice")) {
    const jumbo = isOnlyEmotes(html);
    return (
      <div className={`message-body ${content.msgtype === "m.notice" ? "muted" : ""} ${content.msgtype === "m.emote" ? "italic" : ""} ${jumbo ? "emote-jumbo" : ""}`}>
        {content.msgtype === "m.emote" && <>* {ev.sender?.name} </>}
        {renderEmoteHtml(html, myId)}
        {edited && <span className="edited"> (editado)</span>}
      </div>
    );
  }
  switch (content.msgtype) {
    case "m.image":
      return <MediaImage content={content} onOpen={onOpenImage} />;
    case "m.video":
      return <MediaVideo content={content} />;
    case "m.audio":
      return <MediaAudio content={content} />;
    case "m.file":
      return <MediaFile content={content} />;
    case "m.emote":
      return (
        <div className="message-body italic">
          * {ev.sender?.name} {renderBody(body, myId)}
        </div>
      );
    default:
      return (
        <div className={`message-body ${content.msgtype === "m.notice" ? "muted" : ""} ${isOnlyEmoji(body) ? "jumbo" : ""}`}>
          {renderBody(body, myId)}
          {edited && <span className="edited"> (editado)</span>}
        </div>
      );
  }
}

type Content = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function useContentUrl(content: Content, thumb: boolean) {
  const file = content.file as EncryptedFileInfo | undefined;
  const thumbFile = content.info?.thumbnail_file as EncryptedFileInfo | undefined;
  const encUrl = useEncryptedMedia(thumb && thumbFile ? thumbFile : file, content.info?.mimetype);
  const plainMxc = thumb ? (content.info?.thumbnail_url ?? content.url) : content.url;
  const plainUrl = useMxc(file ? null : plainMxc, thumb && !content.info?.thumbnail_url ? 800 : undefined, "scale");
  return file ? encUrl : plainUrl;
}

function MediaImage({ content, onOpen, sticker }: { content: Content; onOpen(url: string): void; sticker?: boolean }) {
  const url = useContentUrl(content, false);
  const w = content.info?.w ?? 400;
  const h = content.info?.h ?? 300;
  const max = sticker ? 160 : 400;
  const scale = Math.min(1, max / w, max / h);
  return (
    <div className="media-image" style={{ width: w * scale, height: h * scale }} onClick={() => url && onOpen(url)}>
      {url ? <img src={url} alt={content.body} /> : <div className="media-loading" />}
    </div>
  );
}

function MediaVideo({ content }: { content: Content }) {
  const url = useContentUrl(content, false);
  return url ? <video className="media-video" src={url} controls preload="metadata" /> : <div className="media-loading" />;
}

function MediaAudio({ content }: { content: Content }) {
  const url = useContentUrl(content, false);
  return url ? <audio src={url} controls /> : <div className="media-loading small" />;
}

function MediaFile({ content }: { content: Content }) {
  const url = useContentUrl(content, false);
  return (
    <div className="media-file">
      <div className="media-file-icon">📄</div>
      <div className="media-file-info">
        <div className="ellipsis">{content.body}</div>
        <div className="muted tiny">{formatBytes(content.info?.size)}</div>
      </div>
      {url && (
        <a className="icon-btn" href={url} download={content.body} title="Baixar">
          <IconDownload />
        </a>
      )}
    </div>
  );
}

function Reactions({
  room,
  ev,
  myId,
  onReact,
}: {
  room: Room;
  ev: MatrixEvent;
  myId: string;
  onReact(k: string, shortcode?: string): void;
}) {
  const rels = room.relations.getChildEventsForEvent(ev.getId()!, RelationType.Annotation, EventType.Reaction);
  const sorted = rels?.getSortedAnnotationsByKey();
  if (!sorted?.length) return null;
  return (
    <div className="reactions">
      {sorted.map(([key, events]) => {
        const list = [...events].filter((e) => !e.isRedacted());
        if (!list.length) return null;
        const mine = list.some((e) => e.getSender() === myId);
        const who = list.map((e) => room.getMember(e.getSender()!)?.name ?? e.getSender()).join(", ");
        const custom = key.startsWith("mxc://");
        const shortcode = custom ? (list.map((e) => e.getContent().shortcode).find((s) => typeof s === "string") as string | undefined) : undefined;
        return (
          <button
            key={key}
            className={`reaction ${mine ? "mine" : ""}`}
            title={shortcode ? `${shortcode} — ${who}` : who}
            onClick={() => onReact(key, shortcode?.replace(/^:|:$/g, ""))}
          >
            {custom ? <CustomEmoji mxc={key} alt={shortcode ?? "emoji"} size={18} /> : <span>{key}</span>}
            <span className="reaction-count">{list.length}</span>
          </button>
        );
      })}
    </div>
  );
}
