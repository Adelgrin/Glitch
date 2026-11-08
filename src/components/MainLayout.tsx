import { useEffect } from "react";
import { getClient } from "../matrix/client";
import { isVoiceRoom, oneToOnePartner } from "../matrix/rooms";
import UserInfoPanel from "./UserInfoPanel";
import { useAppStore, useVersion } from "../store/app";
import { useSettings } from "../store/settings";
import ServerRail from "./ServerRail";
import ChannelSidebar from "./ChannelSidebar";
import ChatView from "./chat/ChatView";
import CallView from "./call/CallView";
import MemberList from "./MemberList";
import ModalHost from "./modals/ModalHost";
import VerificationModal, { VerificationToast } from "./modals/VerificationModal";
import { IconChat } from "./icons";

export default function MainLayout() {
  useVersion();
  const spaceId = useAppStore((s) => s.selectedSpaceId);
  const roomId = useAppStore((s) => s.selectedRooms[s.selectedSpaceId ?? "home"]);
  const showMembers = useSettings((s) => s.appearance.showMemberList);
  const appBg = useSettings((s) => s.appearance.appBackground);
  const c = getClient();
  const room = roomId ? c.getRoom(roomId) : null;
  const voice = isVoiceRoom(room);
  const dmPartner = room ? oneToOnePartner(room) : null;

  // Se o espaço selecionado sumiu (saiu do servidor), volta ao início
  useEffect(() => {
    if (spaceId && !c.getRoom(spaceId)) useAppStore.getState().selectSpace(null);
  });

  return (
    <div className={`app ${appBg.image ? "has-app-bg" : ""}`}>
      {appBg.image && <div className="app-bg" style={{ backgroundImage: `url(${appBg.image})` }} />}
      {appBg.image && appBg.vignette > 0 && <div className="app-vignette" />}
      <ServerRail />
      <ChannelSidebar />
      <main className="main">
        {room && room.getMyMembership() === "join" ? (
          voice ? (
            <CallView room={room} />
          ) : (
            <ChatView room={room} showMembersToggle />
          )
        ) : (
          <EmptyMain />
        )}
      </main>
      {showMembers &&
        room &&
        !voice &&
        (dmPartner ? <UserInfoPanel room={room} userId={dmPartner} /> : <MemberList room={room} spaceId={spaceId} />)}
      <ModalHost />
      <VerificationModal />
      <VerificationToast />
    </div>
  );
}

function EmptyMain() {
  return (
    <div className="empty-main">
      <IconChat size={56} />
      <h2>Nada por aqui ainda</h2>
      <p className="muted">Escolha um canal à esquerda, crie um servidor ou inicie uma conversa.</p>
    </div>
  );
}
