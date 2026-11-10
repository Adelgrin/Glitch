import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EventTimeline, EventType, RelationType, type MatrixEvent, type Room } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import { getDirectRoomIds, getDmPartner, isVoiceRoom, oneToOnePartner } from "../../matrix/rooms";
import { useAppStore, useVersion } from "../../store/app";
import { useSettings } from "../../store/settings";
import { MessageItem } from "./MessageItem";
import Composer from "./Composer";
import { formatDay } from "./format";
import { IconDownload, IconSettings, IconUserCircle, IconUsers, IconX } from "../icons";
import { saveUrlAs } from "../../matrix/media";
import RoomIcon from "../RoomIcon";

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
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  const events = room.getLiveTimeline().getEvents().filter(visible);
  const lastId = events[events.length - 1]?.getId();
  const isDm = getDirectRoomIds().has(room.roomId);
  const partner = isDm ? getDmPartner(room) : null;
  const oneToOne = !!oneToOnePartner(room);
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
        <RoomIcon room={room} size={26} className="header-icon" />
        <span className="chat-title ellipsis">{isDm && partner ? partner.name : room.name}</span>
        {topic && !embedded && (
          <>
            <span className="chat-header-sep" />
            <span className="chat-topic ellipsis muted">{topic}</span>
          </>
        )}
        <span className="flex-spacer" />
        {!embedded && (
          <button
            className="icon-btn"
            title="Configurações da sala"
            onClick={() => useAppStore.getState().openModal({ type: "channelSettings", roomId: room.roomId })}
          >
            <IconSettings />
          </button>
        )}
        {showMembersToggle && (
          <button
            className={`icon-btn ${showMembers ? "active" : ""}`}
            title={
              oneToOne
                ? showMembers
                  ? "Ocultar perfil do usuário"
                  : "Mostrar perfil do usuário"
                : showMembers
                  ? "Ocultar lista de membros"
                  : "Mostrar lista de membros"
            }
            onClick={() => setAppearance({ showMemberList: !showMembers })}
          >
            {oneToOne ? <IconUserCircle /> : <IconUsers />}
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
              <RoomIcon room={room} size={72} className="channel-start-icon" />
              <h1>{isDm ? (partner?.name ?? room.name) : `Boas-vindas a ${voice ? "" : "#"}${room.name}!`}</h1>
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
                  onOpenImage={(url, name) => setLightbox({ url, name: name ?? "imagem" })}
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
          <img src={lightbox.url} alt="" />
          <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn primary small" onClick={() => saveUrlAs(lightbox.url, lightbox.name)}>
              <IconDownload size={16} /> Baixar
            </button>
            <a className="lightbox-open" href={lightbox.url} target="_blank" rel="noreferrer">
              Abrir original
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
