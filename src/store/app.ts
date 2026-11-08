import { create } from "zustand";
import type { SyncState } from "matrix-js-sdk";

export type ModalState =
  | { type: "createServer" }
  | { type: "joinServer" }
  | { type: "createChannel"; spaceId: string; parentId?: string; voice?: boolean }
  | { type: "createCategory"; spaceId: string }
  | { type: "serverSettings"; spaceId: string }
  | { type: "channelSettings"; roomId: string; spaceId?: string }
  | { type: "invite"; roomId: string }
  | { type: "userSettings"; tab?: string }
  | { type: "userProfile"; userId: string; roomId?: string }
  | { type: "startDm" };

interface AppState {
  version: number;
  syncState: SyncState | null;
  cryptoReady: boolean;
  /** null = Início (mensagens diretas) */
  selectedSpaceId: string | null;
  /** canal selecionado por espaço ("home" para o início) */
  selectedRooms: Record<string, string>;
  modal: ModalState | null;
  replyTo: Record<string, string | undefined>;
  editing: Record<string, string | undefined>;
  collapsedCategories: Record<string, boolean>;
  bump(): void;
  setSyncState(s: SyncState): void;
  setCryptoReady(v: boolean): void;
  selectSpace(id: string | null): void;
  selectRoom(roomId: string): void;
  openModal(m: ModalState): void;
  closeModal(): void;
  setReplyTo(roomId: string, eventId?: string): void;
  setEditing(roomId: string, eventId?: string): void;
  toggleCategory(id: string): void;
}

const NAV_KEY = "mc.nav";
function loadNav(): Pick<AppState, "selectedSpaceId" | "selectedRooms" | "collapsedCategories"> {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (raw) return { selectedSpaceId: null, selectedRooms: {}, collapsedCategories: {}, ...JSON.parse(raw) };
  } catch {
    /* ignora */
  }
  return { selectedSpaceId: null, selectedRooms: {}, collapsedCategories: {} };
}

export const useAppStore = create<AppState>((set, get) => ({
  version: 0,
  syncState: null,
  cryptoReady: false,
  ...loadNav(),
  modal: null,
  replyTo: {},
  editing: {},
  bump: () => set((s) => ({ version: s.version + 1 })),
  setSyncState: (syncState) => set({ syncState }),
  setCryptoReady: (cryptoReady) => set({ cryptoReady }),
  selectSpace: (id) => set({ selectedSpaceId: id }),
  selectRoom: (roomId) =>
    set((s) => ({ selectedRooms: { ...s.selectedRooms, [s.selectedSpaceId ?? "home"]: roomId } })),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setReplyTo: (roomId, eventId) =>
    set((s) => ({ replyTo: { ...s.replyTo, [roomId]: eventId }, editing: { ...s.editing, [roomId]: undefined } })),
  setEditing: (roomId, eventId) =>
    set((s) => ({ editing: { ...s.editing, [roomId]: eventId }, replyTo: { ...s.replyTo, [roomId]: undefined } })),
  toggleCategory: (id) =>
    set((s) => ({ collapsedCategories: { ...s.collapsedCategories, [id]: !s.collapsedCategories[id] } })),
}));

useAppStore.subscribe((s) => {
  try {
    localStorage.setItem(
      NAV_KEY,
      JSON.stringify({
        selectedSpaceId: s.selectedSpaceId,
        selectedRooms: s.selectedRooms,
        collapsedCategories: s.collapsedCategories,
      }),
    );
  } catch {
    /* ignora */
  }
});

export function useVersion() {
  return useAppStore((s) => s.version);
}

export function currentRoomId(): string | undefined {
  const s = useAppStore.getState();
  return s.selectedRooms[s.selectedSpaceId ?? "home"];
}
