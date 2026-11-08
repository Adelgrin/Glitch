import { useEffect, useState } from "react";
import { EventType, JoinRule, KnownMembership } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import { BANNER_EVENT, serverName } from "../../matrix/rooms";
import { uploadBlob, useMxc } from "../../matrix/media";
import { useVersion } from "../../store/app";
import Avatar from "../Avatar";
import { ImageField } from "./Modal";
import { IconX } from "../icons";

export default function ServerSettingsModal({ onClose, spaceId }: { onClose(): void; spaceId: string }) {
  useVersion();
  const c = getClient();
  const space = c.getRoom(spaceId);
  const [tab, setTab] = useState<"overview" | "members" | "address">("overview");
  if (!space) return null;
  return (
    <div className="settings-page">
      <nav className="settings-nav">
        <div className="settings-nav-inner">
          <div className="section-label ellipsis">{space.name}</div>
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
            Visão geral
          </button>
          <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>
            Membros e cargos
          </button>
          <button className={tab === "address" ? "active" : ""} onClick={() => setTab("address")}>
            Endereço e convites
          </button>
        </div>
      </nav>
      <div className="settings-content">
        <div className="settings-content-inner">
          {tab === "overview" && <Overview spaceId={spaceId} />}
          {tab === "members" && <Members spaceId={spaceId} />}
          {tab === "address" && <Address spaceId={spaceId} />}
        </div>
        <button className="settings-close" onClick={onClose} title="Fechar (Esc)">
          <IconX />
          <span>ESC</span>
        </button>
      </div>
      <EscClose onClose={onClose} />
    </div>
  );
}

export function EscClose({ onClose }: { onClose(): void }) {
  // Fecha com Esc (ignorado enquanto o recortador estiver aberto, pois ele captura antes)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".cropper-modal")) onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return null;
}

function Overview({ spaceId }: { spaceId: string }) {
  const c = getClient();
  const space = c.getRoom(spaceId)!;
  const me = c.getUserId()!;
  const [name, setName] = useState(space.name);
  const [topic, setTopic] = useState((space.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic as string) ?? "");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const iconUrl = useMxc(space.getMxcAvatarUrl(), 256);
  const bannerMxc = space.currentState.getStateEvents(BANNER_EVENT, "")?.getContent()?.url as string | undefined;
  const bannerUrl = useMxc(bannerMxc);
  const can = (t: string) => space.currentState.maySendStateEvent(t, me);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError("");
    try {
      await fn();
      setSaved(msg);
      setTimeout(() => setSaved(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h2>Visão geral do servidor</h2>
      <div className="settings-grid">
        <ImageField
          preview={iconUrl}
          aspect={1}
          shape="circle"
          outputWidth={512}
          label="Ícone do servidor"
          boxWidth={100}
          onResult={(r) =>
            run(async () => {
              const url = await uploadBlob(r.blob, r.original ? "icon.gif" : "icon.png");
              await c.sendStateEvent(spaceId, EventType.RoomAvatar, { url }, "");
            }, "Ícone atualizado!")
          }
          onRemove={can(EventType.RoomAvatar) ? () => run(() => c.sendStateEvent(spaceId, EventType.RoomAvatar, {}, ""), "Ícone removido") : undefined}
          placeholder={<Avatar name={space.name} id={spaceId} size={100} shape="server" />}
        />
        <div className="grow">
          <label className="field">
            <span>Nome do servidor</span>
            <input value={name} disabled={!can(EventType.RoomName)} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Descrição</span>
            <textarea value={topic} rows={2} disabled={!can(EventType.RoomTopic)} onChange={(e) => setTopic(e.target.value)} />
          </label>
          <button
            className="btn primary small"
            disabled={!can(EventType.RoomName)}
            onClick={() =>
              run(async () => {
                if (name !== space.name) await c.setRoomName(spaceId, name);
                await c.setRoomTopic(spaceId, topic);
              }, "Alterações salvas!")
            }
          >
            Salvar alterações
          </button>
        </div>
      </div>

      <div className="divider" />
      <h3>Banner do servidor</h3>
      <p className="muted small">Aparece no topo da lista de canais. Posicione a imagem antes de aplicar.</p>
      <ImageField
        preview={bannerUrl}
        aspect={16 / 9}
        shape="rect"
        outputWidth={960}
        mime="image/jpeg"
        boxWidth={320}
        label="Imagem do banner (16:9)"
        onResult={(r) =>
          run(async () => {
            const url = await uploadBlob(r.blob, r.original ? "banner.gif" : "banner.jpg");
            await c.sendStateEvent(spaceId, BANNER_EVENT as never, { url } as never, "");
          }, "Banner atualizado!")
        }
        onRemove={() => run(() => c.sendStateEvent(spaceId, BANNER_EVENT as never, {} as never, ""), "Banner removido")}
      />
      {!can(EventType.RoomName) && <p className="muted small">Você não tem permissão para editar este servidor.</p>}
      {saved && <div className="toast">{saved}</div>}
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

function Members({ spaceId }: { spaceId: string }) {
  const c = getClient();
  const space = c.getRoom(spaceId)!;
  const me = c.getUserId()!;
  const myPl = space.getMember(me)?.powerLevel ?? 0;
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const members = space
    .getMembers()
    .filter((m) => m.membership === KnownMembership.Join)
    .filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.userId.includes(filter))
    .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name));
  const canPl = space.currentState.maySendStateEvent(EventType.RoomPowerLevels, me);

  const setPl = async (userId: string, pl: number) => {
    setError("");
    try {
      await c.setPowerLevel(spaceId, userId, pl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h2>Membros e cargos</h2>
      <p className="muted small">
        Cargos usam níveis de poder do Matrix: Administrador (100), Moderador (50) e Membro (0).
      </p>
      <input className="search-input wide" placeholder="Buscar membros" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="member-table">
        {members.map((m) => (
          <div className="member-row" key={m.userId}>
            <Avatar mxc={m.getMxcAvatarUrl()} name={m.name} id={m.userId} size={32} />
            <div className="grow ellipsis">
              <div className="ellipsis">{m.name}</div>
              <div className="muted tiny ellipsis">{m.userId}</div>
            </div>
            <select
              value={m.powerLevel >= 100 ? 100 : m.powerLevel >= 50 ? 50 : 0}
              disabled={!canPl || m.userId === me || m.powerLevel >= myPl}
              onChange={(e) => setPl(m.userId, Number(e.target.value))}
            >
              <option value={100}>Administrador</option>
              <option value={50}>Moderador</option>
              <option value={0}>Membro</option>
            </select>
            {m.userId !== me && myPl >= 50 && m.powerLevel < myPl && (
              <>
                <button
                  className="btn tiny secondary"
                  onClick={() => confirm(`Expulsar ${m.name}?`) && c.kick(spaceId, m.userId).catch((e) => setError(e.message))}
                >
                  Expulsar
                </button>
                <button
                  className="btn tiny danger-outline"
                  onClick={() => confirm(`Banir ${m.name}?`) && c.ban(spaceId, m.userId).catch((e) => setError(e.message))}
                >
                  Banir
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

function Address({ spaceId }: { spaceId: string }) {
  const c = getClient();
  const space = c.getRoom(spaceId)!;
  const alias = space.getCanonicalAlias();
  const [local, setLocal] = useState("");
  const [msg, setMsg] = useState("");
  const link = `https://matrix.to/#/${encodeURIComponent(alias ?? spaceId)}`;
  const isPublic = space.getJoinRule() === "public";

  const createAlias = async () => {
    setMsg("");
    try {
      const full = `#${local.trim().replace(/^#/, "")}:${serverName()}`;
      await c.createAlias(full, spaceId);
      await c.sendStateEvent(spaceId, EventType.RoomCanonicalAlias, { alias: full }, "");
      setMsg("Endereço criado!");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h2>Endereço e convites</h2>
      <label className="field">
        <span>Link do servidor</span>
        <div className="row gap">
          <input readOnly value={link} className="grow" />
          <button className="btn primary small" onClick={() => navigator.clipboard.writeText(link)}>
            Copiar
          </button>
        </div>
      </label>
      <p className="muted small">
        {isPublic
          ? "Servidor público: qualquer pessoa com o link pode entrar."
          : "Servidor privado: pessoas precisam ser convidadas (use “Convidar pessoas” no menu do servidor)."}
      </p>
      <div className="divider" />
      <h3>Endereço publicado</h3>
      <p className="muted small">Atual: {alias ?? "nenhum"}</p>
      <div className="row gap">
        <span className="muted">#</span>
        <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="meu-servidor" />
        <span className="muted">:{serverName()}</span>
        <button className="btn small primary" disabled={!local.trim()} onClick={createAlias}>
          Criar
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
      <label className="check">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={async (e) => {
            try {
              await c.sendStateEvent(
                spaceId,
                EventType.RoomJoinRules,
                { join_rule: e.target.checked ? JoinRule.Public : JoinRule.Invite },
                "",
              );
            } catch (err) {
              setMsg(err instanceof Error ? err.message : String(err));
            }
          }}
        />
        Qualquer pessoa pode entrar (público)
      </label>
    </>
  );
}
