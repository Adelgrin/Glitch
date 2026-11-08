import { useAppStore } from "../../store/app";
import { CreateCategoryModal, CreateChannelModal, CreateServerModal, JoinServerModal } from "./ServerModals";
import RoomSettingsModal from "./RoomSettingsModal";
import { UserPopout } from "../UserCard";
import ServerSettingsModal from "./ServerSettingsModal";
import UserSettingsModal from "./UserSettingsModal";
import { InviteModal, StartDmModal, UserProfileModal } from "./UserModals";

export default function ModalHost() {
  const modal = useAppStore((s) => s.modal);
  const close = useAppStore((s) => s.closeModal);
  if (!modal) return null;
  switch (modal.type) {
    case "createServer":
      return <CreateServerModal onClose={close} />;
    case "joinServer":
      return <JoinServerModal onClose={close} />;
    case "createChannel":
      return <CreateChannelModal onClose={close} spaceId={modal.spaceId} parentId={modal.parentId} voice={modal.voice} />;
    case "createCategory":
      return <CreateCategoryModal onClose={close} spaceId={modal.spaceId} />;
    case "serverSettings":
      return <ServerSettingsModal onClose={close} spaceId={modal.spaceId} />;
    case "channelSettings":
      return <RoomSettingsModal onClose={close} roomId={modal.roomId} spaceId={modal.spaceId} initialTab={modal.tab} />;
    case "invite":
      return <InviteModal onClose={close} roomId={modal.roomId} />;
    case "userSettings":
      return <UserSettingsModal onClose={close} initialTab={modal.tab} />;
    case "userProfile":
      return modal.anchor ? (
        <UserPopout key={modal.userId + JSON.stringify(modal.anchor)} onClose={close} userId={modal.userId} roomId={modal.roomId} anchor={modal.anchor} />
      ) : (
        <UserProfileModal onClose={close} userId={modal.userId} roomId={modal.roomId} />
      );
    case "startDm":
      return <StartDmModal onClose={close} />;
  }
}
