/**
 * Notas pessoais sobre outros usuários (como no Discord): só você vê.
 * Ficam na account data da sua conta, então sincronizam entre os seus dispositivos
 * e não são visíveis para mais ninguém.
 */
import { getClient } from "./client";

export const USER_NOTES_KEY = "com.matrixcord.user_notes";
export const NOTE_MAX = 256;

type NotesContent = { notes?: Record<string, string> };

function readNotes(): Record<string, string> {
  const content = getClient().getAccountData(USER_NOTES_KEY as never)?.getContent() as NotesContent | undefined;
  return content?.notes && typeof content.notes === "object" ? content.notes : {};
}

export function getUserNote(userId: string): string {
  const v = readNotes()[userId];
  return typeof v === "string" ? v : "";
}

/** Salva (ou apaga, se vazia) a nota sobre um usuário. */
export async function setUserNote(userId: string, text: string) {
  const note = text.trim().slice(0, NOTE_MAX);
  const notes = { ...readNotes() };
  if (note) notes[userId] = note;
  else delete notes[userId];
  await getClient().setAccountData(USER_NOTES_KEY as never, { notes } as never);
}
