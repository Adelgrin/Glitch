import { useEffect, useRef, useState } from "react";
import { getUserNote, NOTE_MAX, setUserNote } from "../matrix/userNotes";
import { useVersion } from "../store/app";

/**
 * Campo de nota pessoal sobre um usuário (só você vê). Salva ao sair do campo
 * ou com Enter; Shift+Enter quebra a linha; Esc desfaz.
 */
export default function UserNote({ userId, className = "" }: { userId: string; className?: string }) {
  useVersion(); // atualiza quando a nota muda em outro dispositivo
  const saved = getUserNote(userId);
  const [text, setText] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Mostra a versão salva quando não está editando (ex.: mudou em outro dispositivo)
  useEffect(() => {
    if (!editing) setText(saved);
  }, [saved, editing]);

  // Altura acompanha o texto
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const commit = async () => {
    setEditing(false);
    if (text.trim() === saved) return;
    setStatus("saving");
    try {
      await setUserNote(userId, text);
      setStatus("saved");
      window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className={`user-note ${className}`}>
      <div className="user-note-head">
        <span className="user-info-label">Nota</span>
        <span className="user-note-status muted tiny">
          {status === "saving" ? "Salvando…" : status === "saved" ? "Salva" : status === "error" ? "Falha ao salvar" : "só você vê"}
        </span>
      </div>
      <textarea
        ref={ref}
        className="user-note-input"
        rows={1}
        value={text}
        maxLength={NOTE_MAX}
        placeholder="Clique para adicionar uma nota"
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            // Esc desfaz a edição sem fechar o cartão
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setText(saved);
            setEditing(false);
            requestAnimationFrame(() => ref.current?.blur());
          }
        }}
      />
    </div>
  );
}
