import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EventTimeline, EventType, RelationType, type MatrixEvent, type Room } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import { getDirectRoomIds, getDmPartner, isVoiceRoom } from "../../matrix/rooms";
import { useVersion } from "../../store/app";
import { useSettings } from "../../store/settings";
import { MessageItem } from "./MessageItem";
import Composer from "./Composer";
import { formatDay } from "./format";
import { IconAt, IconHash, IconSpeaker, IconUsers, IconX } from "../icons";

const SHOWN = new Set<string>([EventType.RoomMessage, EventType.RoomMessageEncrypted, EventType.Sticker, EventType.RoomMember]);
const GROUP_MS = 7 * 60 * 1000;

function visible(ev: MatrixEvent) {
  if (!SHOWN.has(ev.getType())) return false;
  if (ev.isRedacted()) return false;
  const rel = ev.getRelation();
  if (rel?.rel_type === RelationType.Replace) return false;
  if (ev.getType() === EventType.RoomMember) {
    const c = ev.getContent();
    const p = ev.getPrevContent();
    // ignora mudanças de nome/avatar
    if (c.membership === p.membership) return false;
  }
  return true;
}

interface Props {
  room: Room;
  showMembersToggle?: boolean;
  embedded?: boolean;
  onClose?: () => void;
}

export default function ChatView({ room, showMembersToggle, embedded, onClose }: Props) {
  const version = useVersion();
  const c = getClient();
  const me = c.getUserId()!;
  const chatBg = useSettings((s) => s.appearance.chatBackground);
  const showMembers = useSettings((s) => s.appearance.showMemberList);
  const setAppearance = useSettings((s) => s.setAppearance);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const events = room.getLiveTimeline().getEvents().filter(visible);
  const lastId = events[events.length - 1]?.getId();
  const isDm = getDirectRoomIds().has(room.roomId);
  const partner = isDm ? getDmPartner(room) : null;
  const topic = room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic as string | undefined;
  const myPl = room.getMember(me)?.powerLevel ?? 0;
  const redactPl = (room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent()?.redact as number) ?? 50;

  // Reset ao trocar de sala
  useEffect(() => {
    atBottom.current = true;
    setReachedStart(false);
    room.loadMembersIfNeeded().catch(() => undefined);
  }, [room]);

  // Mantém o scroll no fim / preserva posição ao carregar histórico
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [version, room]);

  // Confirmação de leitura
  useEffect(() => {
    if (!lastId || !document.hasFocus()) return;
    const ev = room.findEventById(lastId);
    if (ev && !ev.status && atBottom.current && ev.getSender() !== me && !room.hasUserReadEvent(me, lastId)) {
      c.sendReadReceipt(ev).catch(() => undefined);
    }
  }, [lastId, room, c, me]);

  const loadMore = useCallback(async () => {
    if (loadingMore || reachedStart) return;
    const el = scrollRef.current;
    setLoadingMore(true);
    try {
      prevHeight.current = el?.scrollHeight ?? null;
      const before = room.getLiveTimeline().getEvents().filter(visible).length;
      // Repete enquanto só chegarem eventos invisíveis (estado, reações…)
      for (let i = 0; i < 6; i++) {
        await c.scrollback(room, 40);
        if (!room.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS)) {
          setReachedStart(true);
          break;
        }
        if (room.getLiveTimeline().getEvents().filter(visible).length > before) break;
      }
    } catch {
      prevHeight.current = null;
    } finally {
      setLoadingMore(false);
    }
  }, [c, room, loadingMore, reachedStart]);

  // Carrega mais se a tela não está cheia
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 50 && !reachedStart && !loadingMore) void loadMore();
  }, [events.length, reachedStart, loadingMore, loadMore]);

  const onScroll = () => {
    const el = scrollRef.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 200) void loadMore();
  };

  const typing = room
    .getMembers()
    .filter((m) => m.typing && m.userId !== me)
    .map((m) => m.name);

  const voice = isVoiceRoom(room);

  return (
    <div className={`chat ${embedded ? "embedded" : ""}`}>
      <header className="chat-header">
        {isDm ? <IconAt size={22} className="muted" /> : voice ? <IconSpeaker size={22} className="muted" /> : <IconHash size={22} className="muted" />}
        <span className="chat-title ellipsis">{isDm && partner ? partner.name : room.name}</span>
        {topic && !embedded && (
          <>
            <span className="chat-header-sep" />
            <span className="chat-topic ellipsis muted">{topic}</span>
          </>
        )}
        <span className="flex-spacer" />
        {showMembersToggle && (
          <button
            className={`icon-btn ${showMembers ? "active" : ""}`}
            title={showMembers ? "Ocultar lista de membros" : "Mostrar lista de membros"}
            onClick={() => setAppearance({ showMemberList: !showMembers })}
          >
            <IconUsers />
          </button>
        )}
        {onClose && (
          <button className="icon-btn" title="Fechar chat" onClick={onClose}>
            <IconX />
          </button>
        )}
      </header>
      <div className="chat-body">
        {chatBg.image && !embedded && (
          <div className="chat-bg" style={{ backgroundImage: `url(${chatBg.image})` }}>
            <div className="chat-bg-dim" />
          </div>
        )}
        <div className="messages" ref={scrollRef} onScroll={onScroll}>
          {reachedStart ? (
            <div className="channel-start">
              <div className="channel-start-icon">{isDm ? "@" : "#"}</div>
              <h1>{isDm ? (partner?.name ?? room.name) : `Boas-vindas a #${room.name}!`}</h1>
              <p className="muted">
                {isDm ? "Este é o começo do seu histórico de mensagens diretas." : "Este é o começo do canal."}
              </p>
            </div>
          ) : (
            <div className="loading-more">{loadingMore ? "Carregando mensagens…" : ""}</div>
          )}
          {events.map((ev, i) => {
            const prev = events[i - 1];
            const newDay = !prev || new Date(prev.getTs()).toDateString() !== new Date(ev.getTs()).toDateString();
            const grouped =
              !!prev &&
              !newDay &&
              prev.getType() !== EventType.RoomMember &&
              ev.getType() !== EventType.RoomMember &&
              prev.getSender() === ev.getSender() &&
              ev.getTs() - prev.getTs() < GROUP_MS &&
              !ev.getContent()["m.relates_to"]?.["m.in_reply_to"];
            return (
              <div key={ev.getId() ?? ev.getTxnId() ?? i}>
                {newDay && (
                  <div className="day-divider">
                    <span>{formatDay(ev.getTs())}</span>
                  </div>
                )}
                <MessageItem
                  room={room}
                  ev={ev}
                  grouped={grouped}
                  canRedactOthers={myPl >= redactPl}
                  onOpenImage={setLightbox}
                />
              </div>
            );
          })}
          <div className="messages-end" />
        </div>
      </div>
      <Composer room={room} onSent={() => (atBottom.current = true)} />
      <div className="typing">
        {typing.length > 0 && (
          <>
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <strong>{typing.slice(0, 3).join(", ")}</strong>
            {typing.length === 1 ? " está digitando…" : " estão digitando…"}
          </>
        )}
      </div>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <a className="lightbox-open" href={lightbox} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Abrir original
          </a>
        </div>
      )}
    </div>
  );
}
