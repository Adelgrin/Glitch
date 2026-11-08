import { useEffect, useRef, useState } from "react";
import { KnownMembership, type Room } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import {
  canEditPack,
  getRoomPacks,
  getUserPack,
  isPackGlobal,
  newPackStateKey,
  sanitizeShortcode,
  savePack,
  setPackGlobal,
  uploadPackImages,
  type Pack,
  type PackContent,
  type PackImageContent,
  type PackRef,
  type PackUsage,
} from "../../matrix/imagePacks";
import { useVersion } from "../../store/app";
import CustomEmoji from "../chat/CustomEmoji";
import { IconChevronDown, IconChevronRight, IconImage, IconX } from "../icons";

type UsageChoice = "both" | "emoticon" | "sticker";

const toChoice = (u?: PackUsage[]): UsageChoice =>
  !u || u.length === 2 ? "both" : u[0] === "emoticon" ? "emoticon" : "sticker";
const fromChoice = (c: UsageChoice): PackUsage[] => (c === "both" ? ["emoticon", "sticker"] : [c]);

interface DraftImage {
  /** id local estável (o atalho pode ser editado) */
  key: string;
  shortcode: string;
  content: PackImageContent;
  /** null = herda do pacote */
  usage: UsageChoice | null;
}

function toDraft(pack: Pack | null): DraftImage[] {
  return Object.entries(pack?.content.images ?? {}).map(([code, img], i) => ({
    key: `${i}-${code}`,
    shortcode: code,
    content: img,
    usage: img.usage ? toChoice(img.usage) : null,
  }));
}

/** Editor de um pacote: nome, uso, imagens (envio em lote, atalho, uso por imagem). */
export function PackEditor({ packRef, pack, onRemoved }: { packRef: PackRef; pack: Pack | null; onRemoved?(): void }) {
  const editable = canEditPack(packRef);
  const [name, setName] = useState(pack?.content.pack?.display_name ?? "");
  const [usage, setUsage] = useState<UsageChoice>(toChoice(pack?.content.pack?.usage));
  const [images, setImages] = useState<DraftImage[]>(() => toDraft(pack));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);

  // Atualiza quando o pacote muda em outro lugar (se não houver edição pendente)
  useEffect(() => {
    if (dirty) return;
    setName(pack?.content.pack?.display_name ?? "");
    setUsage(toChoice(pack?.content.pack?.usage));
    setImages(toDraft(pack));
  }, [pack, dirty]);

  const touch = () => {
    setDirty(true);
    setSaved(false);
  };

  const addFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setError("");
    setBusy(`Enviando 0 de ${imgs.length}…`);
    try {
      const taken = new Set(images.map((i) => i.shortcode));
      const added = await uploadPackImages(imgs, taken, (d, t) => setBusy(`Enviando ${d} de ${t}…`));
      setImages((cur) => [
        ...cur,
        ...added.map(([code, content]) => ({ key: `n${keySeq.current++}`, shortcode: code, content, usage: null })),
      ]);
      touch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const duplicates = (() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const i of images) {
      if (seen.has(i.shortcode)) dup.add(i.shortcode);
      seen.add(i.shortcode);
    }
    return dup;
  })();
  const invalid = images.some((i) => !i.shortcode) || duplicates.size > 0;

  const buildContent = (): PackContent => {
    const imgs: Record<string, PackImageContent> = {};
    for (const i of images) {
      const { usage: _old, ...rest } = i.content;
      imgs[i.shortcode] = { ...rest, ...(i.usage ? { usage: fromChoice(i.usage) } : {}) };
    }
    const meta = { ...(pack?.content.pack ?? {}), usage: fromChoice(usage) } as NonNullable<PackContent["pack"]>;
    if (name.trim()) meta.display_name = name.trim();
    else delete meta.display_name;
    meta.avatar_url = images[0]?.content.url;
    if (!meta.avatar_url) delete meta.avatar_url;
    return { ...pack?.content, pack: meta, images: imgs };
  };

  const save = async () => {
    setError("");
    setBusy("Salvando…");
    try {
      await savePack(packRef, buildContent());
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const copyToMine = async () => {
    setError("");
    setBusy("Copiando…");
    try {
      const mine = getUserPack();
      const content = structuredClone(mine.content) as PackContent;
      content.images = { ...(content.images ?? {}) };
      const taken = new Set(Object.keys(content.images));
      let added = 0;
      for (const i of images) {
        let code = i.shortcode;
        for (let n = 2; taken.has(code); n++) code = `${i.shortcode}_${n}`;
        taken.add(code);
        content.images[code] = { ...i.content, ...(i.usage ? { usage: fromChoice(i.usage) } : i.content.usage ? {} : { usage: fromChoice(usage) }) };
        added++;
      }
      await savePack({ kind: "user" }, content);
      alert(`${added} imagens copiadas para o seu pacote pessoal.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const removePack = async () => {
    if (packRef.kind !== "room") return;
    if (!confirm(`Apagar o pacote "${name || packRef.stateKey}"? As imagens deixam de aparecer para todos.`)) return;
    setBusy("Apagando…");
    try {
      await savePack(packRef, {});
      if (isPackGlobal(packRef.roomId, packRef.stateKey)) await setPackGlobal(packRef.roomId, packRef.stateKey, false);
      onRemoved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`pack-editor ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDragOver(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {editable && (
        <div className="pack-meta">
          <label className="field grow">
            <span>Nome do pacote</span>
            <input
              value={name}
              placeholder={packRef.kind === "user" ? "Pacote pessoal" : "Meu pacote"}
              onChange={(e) => {
                setName(e.target.value);
                touch();
              }}
            />
          </label>
          <label className="field">
            <span>Usar como</span>
            <select
              value={usage}
              onChange={(e) => {
                setUsage(e.target.value as UsageChoice);
                touch();
              }}
            >
              <option value="both">Emojis e figurinhas</option>
              <option value="emoticon">Só emojis</option>
              <option value="sticker">Só figurinhas</option>
            </select>
          </label>
        </div>
      )}

      {editable && (
        <button className="pack-drop" onClick={() => fileInput.current?.click()} disabled={!!busy}>
          <IconImage size={22} />
          <span>
            <strong>Enviar imagens</strong> — clique ou arraste várias de uma vez (PNG, GIF, WebP…)
          </span>
        </button>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {images.length === 0 ? (
        <p className="muted small">Nenhuma imagem ainda.</p>
      ) : (
        <div className="pack-grid">
          {images.map((img) => (
            <div className={`pack-item ${duplicates.has(img.shortcode) || !img.shortcode ? "invalid" : ""}`} key={img.key}>
              <div className="pack-item-img">
                <CustomEmoji mxc={img.content.url} alt={img.shortcode} className="pack-thumb" />
              </div>
              {editable ? (
                <>
                  <div className="pack-code">
                    <span>:</span>
                    <input
                      value={img.shortcode}
                      onChange={(e) => {
                        const v = sanitizeShortcode(e.target.value);
                        setImages((cur) => cur.map((x) => (x.key === img.key ? { ...x, shortcode: v } : x)));
                        touch();
                      }}
                    />
                    <span>:</span>
                  </div>
                  <select
                    className="pack-usage"
                    value={img.usage ?? "inherit"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setImages((cur) => cur.map((x) => (x.key === img.key ? { ...x, usage: v === "inherit" ? null : (v as UsageChoice) } : x)));
                      touch();
                    }}
                  >
                    <option value="inherit">Padrão do pacote</option>
                    <option value="both">Emoji e figurinha</option>
                    <option value="emoticon">Só emoji</option>
                    <option value="sticker">Só figurinha</option>
                  </select>
                  <button
                    className="pack-remove"
                    title="Remover"
                    onClick={() => {
                      setImages((cur) => cur.filter((x) => x.key !== img.key));
                      touch();
                    }}
                  >
                    <IconX size={14} />
                  </button>
                </>
              ) : (
                <div className="pack-code readonly">:{img.shortcode}:</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="pack-actions">
        {busy && <span className="muted small">{busy}</span>}
        {saved && <span className="pack-saved small">Salvo!</span>}
        {invalid && <span className="error small">Há atalhos vazios ou repetidos.</span>}
        {dirty && !busy && !invalid && <span className="muted small">Alterações não salvas</span>}
        <span className="flex-spacer" />
        {packRef.kind === "room" && images.length > 0 && (
          <button className="btn secondary small" disabled={!!busy} onClick={() => void copyToMine()}>
            Copiar para o meu pacote
          </button>
        )}
        {packRef.kind === "room" && editable && onRemoved && (
          <button className="btn danger-outline small" disabled={!!busy} onClick={() => void removePack()}>
            Apagar pacote
          </button>
        )}
        {editable && (
          <button className="btn primary small" disabled={!dirty || invalid || !!busy} onClick={() => void save()}>
            Salvar pacote
          </button>
        )}
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

/** Cartão recolhível com um pacote de sala. */
function RoomPackCard({ room, pack, showRoom, defaultOpen }: { room: Room; pack: Pack; showRoom?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const ref = pack.ref as Extract<PackRef, { kind: "room" }>;
  const [global, setGlobal] = useState(isPackGlobal(ref.roomId, ref.stateKey));
  const [err, setErr] = useState("");
  return (
    <div className="pack-card">
      <div className="pack-card-head">
        <button className="pack-card-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          <span className="pack-card-avatar">{pack.avatar ? <CustomEmoji mxc={pack.avatar} alt={pack.name} size={28} /> : "🗂️"}</span>
          <span className="ellipsis">
            <strong>{pack.name}</strong>
            <span className="muted small">
              {" "}
              · {pack.images.length} {pack.images.length === 1 ? "imagem" : "imagens"}
              {showRoom ? ` · ${room.name}` : ""}
            </span>
          </span>
        </button>
        <label className="check pack-global" title="Disponível em todas as salas, não só aqui">
          <input
            type="checkbox"
            checked={global}
            onChange={async (e) => {
              const v = e.target.checked;
              setGlobal(v);
              setErr("");
              try {
                await setPackGlobal(ref.roomId, ref.stateKey, v);
              } catch (x) {
                setGlobal(!v);
                setErr(x instanceof Error ? x.message : String(x));
              }
            }}
          />
          Usar em todas as salas
        </label>
      </div>
      {err && <div className="form-error">{err}</div>}
      {open && <PackEditor packRef={pack.ref} pack={pack} onRemoved={() => setOpen(false)} />}
    </div>
  );
}

/** Aba das configurações do usuário: pacote pessoal + pacotes das salas. */
export function UserPacksPanel() {
  useVersion();
  const c = getClient();
  const mine = getUserPack();
  const roomPacks = c
    .getRooms()
    .filter((r) => r.getMyMembership() === KnownMembership.Join)
    .flatMap((r) => getRoomPacks(r).map((p) => ({ room: r, pack: p })))
    .filter((x) => x.pack.images.length > 0);

  return (
    <>
      <h2>Emojis e figurinhas</h2>
      <p className="muted small">
        Pacotes no formato do Cinny (MSC2545): funcionam também no Cinny, FluffyChat e Nheko. Envie imagens para criar
        emojis e figurinhas; o <code>:atalho:</code> de cada uma é o que você digita na mensagem.
      </p>

      <h3>Seu pacote pessoal</h3>
      <p className="muted small">Só você vê e usa, em qualquer sala.</p>
      <div className="pack-card open">
        <PackEditor packRef={{ kind: "user" }} pack={mine} />
      </div>

      <h3>Pacotes das suas salas e servidores</h3>
      {roomPacks.length === 0 ? (
        <p className="muted small">
          Nenhuma sala sua tem pacotes. Crie um em <strong>Configurações do servidor › Emojis e figurinhas</strong> para
          compartilhar com todos os membros.
        </p>
      ) : (
        <>
          <p className="muted small">
            Pacotes de uma sala aparecem nela e nos canais do servidor. Marque <em>Usar em todas as salas</em> para tê-los em
            qualquer lugar.
          </p>
          {roomPacks.map(({ room, pack }) => (
            <RoomPackCard key={pack.id} room={room} pack={pack} showRoom />
          ))}
        </>
      )}
    </>
  );
}

/** Aba das configurações de sala/servidor: pacotes compartilhados com os membros. */
export function RoomPacksPanel({ room }: { room: Room }) {
  useVersion();
  const packs = getRoomPacks(room);
  const editable = canEditPack({ kind: "room", roomId: room.roomId, stateKey: "" });
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const kind = room.isSpaceRoom() ? "servidor" : "canal";

  const create = async () => {
    const name = prompt("Nome do novo pacote:", `Figurinhas de ${room.name}`);
    if (!name?.trim()) return;
    const stateKey = newPackStateKey(room, name);
    setError("");
    try {
      await savePack({ kind: "room", roomId: room.roomId, stateKey }, { pack: { display_name: name.trim() }, images: {} });
      setCreating(`${room.roomId}|${stateKey}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h2>Emojis e figurinhas</h2>
      <p className="muted small">
        Pacotes deste {kind} ficam disponíveis para todos os membros{room.isSpaceRoom() ? ", em todos os canais do servidor" : ""}.
        Compatível com Cinny, FluffyChat e Nheko.
      </p>
      {editable && (
        <button className="btn primary small" onClick={() => void create()}>
          Criar pacote
        </button>
      )}
      {!editable && <p className="notice small">Você não tem permissão para editar os pacotes daqui.</p>}
      {error && <div className="form-error">{error}</div>}
      <div style={{ marginTop: 12 }}>
        {packs.length === 0 && <p className="muted small">Nenhum pacote ainda.</p>}
        {packs.map((p) => (
          <RoomPackCard key={p.id} room={room} pack={p} defaultOpen={p.id === creating || packs.length === 1} />
        ))}
      </div>
    </>
  );
}
