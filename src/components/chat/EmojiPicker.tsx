import { useEffect, useRef, useState } from "react";

const GROUPS: Record<string, string[]> = {
  Frequentes: ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀", "🙏", "✅"],
  Rostos: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖", "😫", "😩", "🥺", "😭", "😤", "😠", "😡", "🤯", "😳", "🥵", "🥶", "😱", "😨", "🤔", "🤭", "🤫", "😶", "😐", "😑", "😬", "🙄", "😴", "🤤", "😵", "🤐", "🤢", "🤮", "🤧", "😷", "🤠", "🤡", "💀", "👻", "👽", "🤖", "💩"],
  Gestos: ["👋", "🤚", "✋", "🖖", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊", "👏", "🙌", "👐", "🤝", "🙏", "💪", "🫶"],
  Símbolos: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💯", "💢", "💥", "💫", "💬", "✨", "⭐", "🌟", "⚡", "🔥", "🎉", "🎊", "🏆", "🎮", "🎧", "🎵", "📌", "✅", "❌", "⚠️", "❓", "❗"],
  Natureza: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦄", "🐝", "🦋", "🌸", "🌻", "🌈", "☀️", "🌙", "❄️", "🍕", "🍔", "🍟", "🍿", "☕", "🍺", "🍰"],
};

export default function EmojiPicker({ onPick, onClose }: { onPick(e: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState("Frequentes");
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", h));
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [onClose]);
  return (
    <div className="emoji-picker" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="emoji-tabs">
        {Object.keys(GROUPS).map((g) => (
          <button key={g} className={tab === g ? "active" : ""} onClick={() => setTab(g)}>
            {GROUPS[g][0]}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {GROUPS[tab].map((e, i) => (
          <button key={e + i} onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
