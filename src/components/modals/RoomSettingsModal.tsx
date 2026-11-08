import { useEffect, useState, type ReactNode } from "react";
import { EventType, GuestAccess, HistoryVisibility, JoinRule, KnownMembership, RestrictedAllowType, Visibility, type Room } from "matrix-js-sdk";
import { getClient } from "../../matrix/client";
import { isVoiceRoom, removeChild, serverName } from "../../matrix/rooms";
import { uploadBlob, useMxc } from "../../matrix/media";
import {
  effectiveLevel,
  getPowerLevels,
  getRoomNotifState,
  myPowerLevel,
  parentSpaceIds,
  roomCreators,
  roleName,
  roomVersionSupports,
  savePowerLevels,
  setRoomNotifState,
  withLevel,
  withUserLevel,
  type PermKey,
  type RoomNotifState,
} from "../../matrix/roomSettings";
import { useAppStore, useVersion } from "../../store/app";
import { leaveVoice, useVoice } from "../../voice/voice";
import Avatar from "../Avatar";
import { ImageField } from "./Modal";
import { EscClose } from "./ServerSettingsModal";
import { IconX } from "../icons";

type Tab = "general" | "security" | "roles" | "notifications" | "advanced";

/** Configurações completas de uma sala/canal (nível do Element). */
export default function RoomSettingsModal({
  onClose,
  roomId,
  spaceId,
  initialTab,
}: {
  onClose(): void;
  roomId: string;
  spaceId?: string;
  initialTab?: Tab;
}) {
  useVersion();
  const room = getClient().getRoom(roomId);
  const [tab, setTab] = useState<Tab>(initialTab ?? "general");
  if (!room) return null;
  const prefix = isVoiceRoom(room) ? "🔊 " : room.isSpaceRoom() ? "" : "# ";
  const tabs: [Tab, string][] = [
    ["general", "Geral"],
    ["security", "Segurança e privacidade"],
    ["roles", "Cargos e permissões"],
    ["notifications", "Notificações"],
    ["advanced", "Avançado"],
  ];
  return (
    <div className="settings-page">
      <nav className="settings-nav">
        <div className="settings-nav-inner">
          <div className="section-label ellipsis">
            {prefix}
            {room.name}
          </div>
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </nav>
      <div className="settings-content">
        <div className="settings-content-inner">
          {tab === "general" && <GeneralPanel room={room} spaceId={spaceId} onClose={onClose} />}
          {tab === "security" && <SecurityPanel room={room} />}
          {tab === "roles" && <RolesPanel room={room} />}
          {tab === "notifications" && <NotificationsPanel room={room} />}
          {tab === "advanced" && <AdvancedPanel room={room} onClose={onClose} />}
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

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

function useRun() {
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError("");
    try {
      await fn();
      if (ok) {
        setSaved(ok);
        setTimeout(() => setSaved(""), 2500);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const feedback = (
    <>
      {saved && <div className="toast">{saved}</div>}
      {error && <div className="form-error">{error}</div>}
    </>
  );
  return { run, feedback };
}

function useCan(room: Room) {
  const me = getClient().getUserId()!;
  return (type: string) => room.currentState.maySendStateEvent(type, me);
}

function RadioCard({
  active,
  disabled,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  title: ReactNode;
  desc?: ReactNode;
  onClick(): void;
}) {
  return (
    <div
      className={`radio-card ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => !disabled && !active && onClick()}
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
    >
      <span className="radio-dot" />
      <div>
        <div className="radio-title">{title}</div>
        {desc && <div className="muted small">{desc}</div>}
      </div>
    </div>
  );
}

const ROLE_LEVELS = [0, 50, 100];

/** Seletor de cargo (Membro/Moderador/Administrador/Personalizado). */
function LevelSelect({
  value,
  maxLevel,
  disabled,
  onChange,
}: {
  value: number;
  maxLevel: number;
  disabled?: boolean;
  onChange(level: number): void;
}) {
  const options = ROLE_LEVELS.includes(value) ? ROLE_LEVELS : [...ROLE_LEVELS, value].sort((a, b) => a - b);
  return (
    <select
      className="level-select"
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "custom") {
          const n = prompt(
            Number.isFinite(maxLevel) ? `Nível personalizado (até ${maxLevel}):` : "Nível personalizado (número):",
            String(value),
          );
          const num = n === null ? NaN : parseInt(n, 10);
          if (!Number.isNaN(num) && num <= maxLevel) onChange(num);
          else e.target.value = String(value);
          return;
        }
        onChange(Number(v));
      }}
    >
      {options
        .slice()
        .reverse()
        .map((l) => (
          <option key={l} value={l} disabled={l > maxLevel}>
            {roleName(l)}
          </option>
        ))}
      <option value="custom">Personalizado…</option>
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Geral                                                               */
/* ------------------------------------------------------------------ */

export function GeneralPanel({ room, spaceId, onClose }: { room: Room; spaceId?: string; onClose(): void }) {
  const c = getClient();
  const can = useCan(room);
  const { run, feedback } = useRun();
  const [name, setName] = useState(room.name);
  const topicNow = (room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic as string) ?? "";
  const [topic, setTopic] = useState(topicNow);
  const avatarUrl = useMxc(room.getMxcAvatarUrl(), 256);
  const isSpace = room.isSpaceRoom();
  const kind = isSpace ? "servidor" : "canal";
  const parents = parentSpaceIds(room);

  const remove = async () => {
    if (!confirm(`Remover o canal "${room.name}" do servidor? Os membros continuam com o histórico.`)) return;
    await run(async () => {
      const parent = parents[0] ?? spaceId;
      if (parent) await removeChild(parent, room.roomId);
      if (useVoice.getState().roomId === room.roomId) await leaveVoice();
      await c.leave(room.roomId);
      onClose();
    });
  };

  const leave = async () => {
    if (!confirm(`Sair de "${room.name}"?`)) return;
    await run(async () => {
      if (useVoice.getState().roomId === room.roomId) await leaveVoice();
      await c.leave(room.roomId);
      onClose();
    });
  };

  return (
    <>
      <h2>Geral</h2>
      <div className="settings-grid">
        <ImageField
          preview={avatarUrl}
          aspect={1}
          shape="circle"
          outputWidth={512}
          boxWidth={100}
          label={`Ícone do ${kind}`}
          onResult={async (r) => {
            await run(async () => {
              const url = await uploadBlob(r.blob, r.original ? "avatar.gif" : "avatar.png");
              await c.sendStateEvent(room.roomId, EventType.RoomAvatar, { url }, "");
            }, "Ícone atualizado!");
          }
          }
          onRemove={can(EventType.RoomAvatar) ? () => run(() => c.sendStateEvent(room.roomId, EventType.RoomAvatar, {}, ""), "Ícone removido") : undefined}
          placeholder={<Avatar name={room.name} id={room.roomId} size={100} shape={isSpace ? "server" : "circle"} />}
        />
        <div className="grow">
          <label className="field">
            <span>Nome do {kind}</span>
            <input value={name} disabled={!can(EventType.RoomName)} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Tópico</span>
            <textarea value={topic} rows={3} disabled={!can(EventType.RoomTopic)} onChange={(e) => setTopic(e.target.value)} />
          </label>
          <button
            className="btn primary small"
            disabled={(!can(EventType.RoomName) && !can(EventType.RoomTopic)) || (name === room.name && topic === topicNow)}
            onClick={() =>
              run(async () => {
                if (name !== room.name) await c.setRoomName(room.roomId, name);
                if (topic !== topicNow) await c.setRoomTopic(room.roomId, topic);
              }, "Alterações salvas!")
            }
          >
            Salvar alterações
          </button>
        </div>
      </div>

      <div className="divider" />
      <Addresses room={room} />

      <div className="divider" />
      <h3>Zona de perigo</h3>
      <div className="row gap">
        {!isSpace && parents.length > 0 && (
          <button className="btn danger-outline small" onClick={remove}>
            Remover canal do servidor
          </button>
        )}
        <button className="btn danger-outline small" onClick={leave}>
          Sair {isSpace ? "do servidor" : "da sala"}
        </button>
      </div>
      {feedback}
    </>
  );
}

function Addresses({ room }: { room: Room }) {
  const c = getClient();
  const can = useCan(room);
  const { run, feedback } = useRun();
  const [local, setLocal] = useState<string[] | null>(null);
  const [newAlias, setNewAlias] = useState("");
  const canonical = room.getCanonicalAlias();
  const altAliases = room.getAltAliases();
  const canAlias = can(EventType.RoomCanonicalAlias);

  const loadLocal = () =>
    c
      .getLocalAliases(room.roomId)
      .then((r) => setLocal(r.aliases))
      .catch(() => setLocal([]));
  useEffect(() => {
    void loadLocal();
  }, [room.roomId]);

  const setMain = (alias: string | null) =>
    run(async () => {
      const content: Record<string, unknown> = { alt_aliases: altAliases.filter((a) => a !== alias) };
      if (alias) content.alias = alias;
      await c.sendStateEvent(room.roomId, EventType.RoomCanonicalAlias, content as never, "");
    }, "Endereço principal alterado");

  const add = () =>
    run(async () => {
      const full = `#${newAlias.trim().replace(/^#/, "").replace(/:.*$/, "")}:${serverName()}`;
      await c.createAlias(full, room.roomId);
      if (!canonical && canAlias) {
        await c.sendStateEvent(room.roomId, EventType.RoomCanonicalAlias, { alias: full, alt_aliases: altAliases }, "");
      }
      setNewAlias("");
      await loadLocal();
    }, "Endereço criado!");

  const remove = (alias: string) =>
    run(async () => {
      if (alias === canonical && canAlias) {
        await c.sendStateEvent(room.roomId, EventType.RoomCanonicalAlias, { alt_aliases: altAliases } as never, "");
      }
      await c.deleteAlias(alias);
      await loadLocal();
    }, "Endereço removido");

  const link = `https://matrix.to/#/${encodeURIComponent(canonical ?? room.roomId)}`;

  return (
    <>
      <h3>Endereços</h3>
      <label className="field">
        <span>Link</span>
        <div className="row gap">
          <input readOnly value={link} className="grow" />
          <button className="btn primary small" onClick={() => navigator.clipboard.writeText(link)}>
            Copiar
          </button>
        </div>
      </label>
      <label className="field">
        <span>Endereço principal</span>
        <select value={canonical ?? ""} disabled={!canAlias} onChange={(e) => void setMain(e.target.value || null)}>
          <option value="">Nenhum</option>
          {[...new Set([...(canonical ? [canonical] : []), ...(local ?? []), ...altAliases])].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <div className="field-label">Endereços locais (em {serverName()})</div>
      <div className="alias-list">
        {local === null && <span className="muted small">Carregando…</span>}
        {local?.length === 0 && <span className="muted small">Nenhum endereço local.</span>}
        {local?.map((a) => (
          <div className="alias-row" key={a}>
            <span className="grow selectable">{a}</span>
            {a === canonical && <span className="badge-inline">principal</span>}
            <button className="btn tiny secondary" onClick={() => void remove(a)}>
              Remover
            </button>
          </div>
        ))}
      </div>
      <div className="row gap" style={{ marginTop: 8 }}>
        <span className="muted">#</span>
        <input className="grow" value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder="meu-canal" />
        <span className="muted">:{serverName()}</span>
        <button className="btn small primary" disabled={!newAlias.trim()} onClick={() => void add()}>
          Adicionar
        </button>
      </div>
      {feedback}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Segurança e privacidade                                             */
/* ------------------------------------------------------------------ */

export function SecurityPanel({ room }: { room: Room }) {
  const c = getClient();
  const can = useCan(room);
  const { run, feedback } = useRun();
  const isSpace = room.isSpaceRoom();
  const encrypted = room.hasEncryptionStateEvent();
  const joinRule = room.getJoinRule();
  const joinContent = room.currentState.getStateEvents(EventType.RoomJoinRules, "")?.getContent() ?? {};
  const allowed: string[] = ((joinContent.allow as { type: string; room_id: string }[] | undefined) ?? [])
    .filter((a) => a.type === RestrictedAllowType.RoomMembership)
    .map((a) => a.room_id);
  const parents = parentSpaceIds(room);
  const spaceChoices = [...new Set([...parents, ...allowed])];
  const guest = room.getGuestAccess();
  const history = room.getHistoryVisibility();
  const canJoin = can(EventType.RoomJoinRules);
  const [published, setPublished] = useState<boolean | null>(null);

  useEffect(() => {
    c.getRoomDirectoryVisibility(room.roomId)
      .then((r) => setPublished(r.visibility === Visibility.Public))
      .catch(() => setPublished(null));
  }, [room.roomId, c]);

  const setJoin = (rule: JoinRule, allow?: string[]) =>
    run(async () => {
      const content: Record<string, unknown> = { join_rule: rule };
      if (rule === JoinRule.Restricted || (rule as string) === "knock_restricted") {
        const ids = allow ?? (allowed.length ? allowed : parents);
        content.allow = ids.map((id) => ({ type: RestrictedAllowType.RoomMembership, room_id: id }));
      }
      await c.sendStateEvent(room.roomId, EventType.RoomJoinRules, content as never, "");
    }, "Acesso atualizado");

  const enableEncryption = () => {
    if (
      !confirm(
        "Ativar a criptografia de ponta a ponta?\n\nDepois de ativada, ela NÃO pode ser desativada. Bots, pontes e clientes sem suporte podem deixar de funcionar, e a busca do servidor não encontrará as mensagens.",
      )
    )
      return;
    void run(
      () => c.sendStateEvent(room.roomId, EventType.RoomEncryption, { algorithm: "m.megolm.v1.aes-sha2" }, ""),
      "Criptografia ativada",
    );
  };

  const restrictedOk = roomVersionSupports(room, "restricted");
  const knockOk = roomVersionSupports(room, "knock");
  const spaceName = (id: string) => c.getRoom(id)?.name ?? id;

  return (
    <>
      <h2>Segurança e privacidade</h2>

      {!isSpace && (
        <>
          <h3>Criptografia</h3>
          <label className={`check ${encrypted || !can(EventType.RoomEncryption) ? "disabled" : ""}`}>
            <input
              type="checkbox"
              checked={encrypted}
              disabled={encrypted || !can(EventType.RoomEncryption)}
              onChange={enableEncryption}
            />
            <div>
              <div>Criptografia de ponta a ponta</div>
              <div className="muted small">
                {encrypted
                  ? "Ativada. Só os participantes conseguem ler as mensagens. Depois de ativada, a criptografia não pode ser desativada."
                  : "Só os participantes conseguem ler as mensagens. Depois de ativada, não pode ser desativada."}
              </div>
            </div>
          </label>
          {encrypted && isVoiceRoom(room) && (
            <p className="muted small">
              Observação: a mídia das chamadas do MatrixCord ainda não é criptografada; só o chat de texto deste canal é.
            </p>
          )}
          <div className="divider" />
        </>
      )}

      <h3>Acesso</h3>
      <p className="muted small">Decide quem pode entrar {isSpace ? "no servidor" : "neste canal"}.</p>
      <RadioCard
        active={joinRule === JoinRule.Invite}
        disabled={!canJoin}
        title="Privado (só convidados)"
        desc="Só entra quem for convidado."
        onClick={() => void setJoin(JoinRule.Invite)}
      />
      {(spaceChoices.length > 0 || joinRule === JoinRule.Restricted) && (
        <RadioCard
          active={joinRule === JoinRule.Restricted}
          disabled={!canJoin || !restrictedOk}
          title={isSpace ? "Membros do servidor pai" : "Membros do servidor"}
          desc={
            restrictedOk
              ? `Qualquer pessoa em ${spaceChoices.map(spaceName).join(", ") || "um servidor"} pode encontrar e entrar.`
              : "Requer atualizar a sala para a versão 8 ou mais nova (aba Avançado)."
          }
          onClick={() => void setJoin(JoinRule.Restricted, spaceChoices)}
        />
      )}
      {joinRule === JoinRule.Restricted && spaceChoices.length > 1 && (
        <div className="allow-list">
          {spaceChoices.map((id) => (
            <label className="check" key={id}>
              <input
                type="checkbox"
                checked={allowed.includes(id)}
                disabled={!canJoin}
                onChange={(e) => {
                  const next = e.target.checked ? [...allowed, id] : allowed.filter((x) => x !== id);
                  if (next.length) void setJoin(JoinRule.Restricted, next);
                }}
              />
              {spaceName(id)}
            </label>
          ))}
        </div>
      )}
      <RadioCard
        active={joinRule === JoinRule.Knock}
        disabled={!canJoin || !knockOk}
        title="Pedir para entrar"
        desc={knockOk ? "Pessoas pedem acesso, e um moderador aprova." : "Requer atualizar a sala para a versão 7 ou mais nova."}
        onClick={() => void setJoin(JoinRule.Knock)}
      />
      <RadioCard
        active={joinRule === JoinRule.Public}
        disabled={!canJoin}
        title="Público"
        desc="Qualquer pessoa pode encontrar e entrar."
        onClick={() => void setJoin(JoinRule.Public)}
      />

      {joinRule === JoinRule.Public && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={!!published}
              disabled={published === null}
              onChange={(e) => {
                const v = e.target.checked;
                void run(async () => {
                  await c.setRoomDirectoryVisibility(room.roomId, v ? Visibility.Public : Visibility.Private);
                  setPublished(v);
                }, v ? "Publicado no diretório" : "Removido do diretório");
              }}
            />
            <div>
              <div>Publicar no diretório de salas de {serverName()}</div>
              <div className="muted small">Aparece na busca de salas públicas do servidor.</div>
            </div>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={guest === GuestAccess.CanJoin}
              disabled={!can(EventType.RoomGuestAccess)}
              onChange={(e) =>
                void run(
                  () =>
                    c.sendStateEvent(
                      room.roomId,
                      EventType.RoomGuestAccess,
                      { guest_access: e.target.checked ? GuestAccess.CanJoin : GuestAccess.Forbidden },
                      "",
                    ),
                  "Acesso de visitantes atualizado",
                )
              }
            />
            <div>
              <div>Permitir visitantes</div>
              <div className="muted small">Contas de visitante (sem cadastro) podem entrar.</div>
            </div>
          </label>
        </>
      )}

      {!isSpace && (
        <>
          <div className="divider" />
          <h3>Quem pode ler o histórico?</h3>
          <p className="muted small">Mudanças valem só para mensagens futuras.</p>
          {(
            [
              [HistoryVisibility.WorldReadable, "Qualquer pessoa", "Inclusive quem não entrou (só faz sentido em salas públicas)."],
              [HistoryVisibility.Shared, "Membros (todo o histórico)", "Membros leem tudo desde que esta opção foi escolhida."],
              [HistoryVisibility.Invited, "Membros, desde o convite", "Cada membro lê a partir do momento em que foi convidado."],
              [HistoryVisibility.Joined, "Membros, desde a entrada", "Cada membro lê a partir do momento em que entrou."],
            ] as const
          ).map(([v, title, desc]) => (
            <RadioCard
              key={v}
              active={history === v}
              disabled={!can(EventType.RoomHistoryVisibility) || (v === HistoryVisibility.WorldReadable && encrypted)}
              title={title}
              desc={v === HistoryVisibility.WorldReadable && encrypted ? "Indisponível em salas criptografadas." : desc}
              onClick={() =>
                void run(
                  () => c.sendStateEvent(room.roomId, EventType.RoomHistoryVisibility, { history_visibility: v }, ""),
                  "Visibilidade do histórico atualizada",
                )
              }
            />
          ))}
        </>
      )}
      {feedback}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cargos e permissões                                                 */
/* ------------------------------------------------------------------ */

interface PermDef {
  key: PermKey;
  label: string;
  only?: "room" | "space" | "voice";
}

const PERM_GROUPS: { title: string; perms: PermDef[] }[] = [
  {
    title: "Geral",
    perms: [
      { key: "users_default", label: "Cargo padrão de novos membros" },
      { key: "events_default", label: "Enviar mensagens" },
      { key: "event:m.reaction", label: "Reagir a mensagens", only: "room" },
      { key: "invite", label: "Convidar pessoas" },
      { key: "notifications.room", label: "Notificar todos (@room)" },
      { key: "event:m.room.pinned_events", label: "Fixar mensagens", only: "room" },
      { key: "event:org.matrix.msc3401.call.member", label: "Entrar em chamadas de voz e vídeo", only: "room" },
    ],
  },
  {
    title: "Moderação",
    perms: [
      { key: "kick", label: "Expulsar pessoas" },
      { key: "ban", label: "Banir pessoas" },
      { key: "redact", label: "Apagar mensagens de outras pessoas" },
      { key: "event:m.room.redaction", label: "Apagar as próprias mensagens", only: "room" },
    ],
  },
  {
    title: "Configurações",
    perms: [
      { key: "state_default", label: "Alterar configurações (padrão)" },
      { key: "event:m.room.name", label: "Mudar o nome" },
      { key: "event:m.room.avatar", label: "Mudar o ícone" },
      { key: "event:m.room.topic", label: "Mudar o tópico" },
      { key: "event:m.room.canonical_alias", label: "Mudar o endereço principal" },
      { key: "event:m.room.join_rules", label: "Mudar quem pode entrar" },
      { key: "event:m.room.history_visibility", label: "Mudar a visibilidade do histórico", only: "room" },
      { key: "event:m.room.encryption", label: "Ativar criptografia", only: "room" },
      { key: "event:m.room.power_levels", label: "Mudar cargos e permissões" },
      { key: "event:m.space.child", label: "Gerenciar canais e categorias", only: "space" },
      { key: "event:com.matrixcord.space.banner", label: "Mudar o banner", only: "space" },
      { key: "event:m.room.server_acl", label: "Mudar ACLs de servidores" },
      { key: "event:m.room.tombstone", label: "Atualizar a sala" },
      { key: "event:im.vector.modular.widgets", label: "Gerenciar widgets", only: "room" },
    ],
  },
];

export function RolesPanel({ room }: { room: Room }) {
  const c = getClient();
  const me = c.getUserId()!;
  const { run, feedback } = useRun();
  const pl = getPowerLevels(room);
  const myPl = myPowerLevel(room);
  const creators = roomCreators(room);
  const canPl = room.currentState.maySendStateEvent(EventType.RoomPowerLevels, me);
  const isSpace = room.isSpaceRoom();
  const [newUser, setNewUser] = useState("");
  const [newLevel, setNewLevel] = useState(50);

  const privileged = Object.entries(pl.users ?? {})
    .filter(([id, l]) => l !== (pl.users_default ?? 0) && !creators.includes(id))
    .sort((a, b) => b[1] - a[1]);
  const banned = room.getMembersWithMembership(KnownMembership.Ban);

  const change = (key: PermKey, level: number) => run(() => savePowerLevels(room.roomId, withLevel(pl, key, level)), "Permissão atualizada");
  const changeUser = (userId: string, level: number | null) =>
    run(() => savePowerLevels(room.roomId, withUserLevel(pl, userId, level)), "Cargo atualizado");

  const addUser = async () => {
    const id = newUser.trim();
    if (!/^@[^:]+:.+$/.test(id)) {
      alert("Informe um ID completo, como @pessoa:servidor.org");
      return;
    }
    if (await changeUser(id, newLevel)) setNewUser("");
  };

  return (
    <>
      <h2>Cargos e permissões</h2>
      {!canPl && <p className="notice small">Você não tem permissão para alterar cargos aqui. As configurações abaixo são só leitura.</p>}

      <h3>Pessoas com cargo</h3>
      <div className="member-table">
        {creators.map((userId) => {
          const m = room.getMember(userId);
          return (
            <div className="member-row" key={userId}>
              <Avatar mxc={m?.getMxcAvatarUrl()} name={m?.name ?? userId} id={userId} size={32} />
              <div className="grow ellipsis">
                <div className="ellipsis">{m?.name ?? userId}</div>
                <div className="muted tiny ellipsis">{userId}</div>
              </div>
              <span className="role-fixed" title="Em salas versão 12+, quem criou a sala tem poder máximo, que não pode ser alterado.">
                Criador
              </span>
            </div>
          );
        })}
        {privileged.length === 0 && creators.length === 0 && <p className="muted small">Ninguém tem cargo especial.</p>}
        {privileged.map(([userId, level]) => {
          const m = room.getMember(userId);
          const editable = canPl && (userId === me ? true : level < myPl);
          return (
            <div className="member-row" key={userId}>
              <Avatar mxc={m?.getMxcAvatarUrl()} name={m?.name ?? userId} id={userId} size={32} />
              <div className="grow ellipsis">
                <div className="ellipsis">{m?.name ?? userId}</div>
                <div className="muted tiny ellipsis">{userId}</div>
              </div>
              <LevelSelect
                value={level}
                maxLevel={myPl}
                disabled={!editable}
                onChange={(l) => {
                  if (userId === me && l < level && !confirm("Você está reduzindo o seu próprio cargo e não poderá desfazer isso sozinho. Continuar?")) return;
                  void changeUser(userId, l);
                }}
              />
              {editable && userId !== me && (
                <button className="btn tiny secondary" title="Voltar ao cargo padrão" onClick={() => void changeUser(userId, null)}>
                  Remover
                </button>
              )}
            </div>
          );
        })}
      </div>
      {canPl && (
        <div className="row gap" style={{ marginTop: 8 }}>
          <input className="grow" placeholder="@pessoa:servidor.org" value={newUser} onChange={(e) => setNewUser(e.target.value)} />
          <LevelSelect value={newLevel} maxLevel={myPl} onChange={setNewLevel} />
          <button className="btn small primary" disabled={!newUser.trim()} onClick={() => void addUser()}>
            Dar cargo
          </button>
        </div>
      )}

      {banned.length > 0 && (
        <>
          <div className="divider" />
          <h3>Pessoas banidas</h3>
          <div className="member-table">
            {banned.map((m) => {
              const reason = m.events.member?.getContent().reason as string | undefined;
              return (
                <div className="member-row" key={m.userId}>
                  <Avatar mxc={m.getMxcAvatarUrl()} name={m.name} id={m.userId} size={32} />
                  <div className="grow ellipsis">
                    <div className="ellipsis">{m.name}</div>
                    <div className="muted tiny ellipsis">
                      {m.userId}
                      {reason ? ` · motivo: ${reason}` : ""}
                    </div>
                  </div>
                  {myPl >= effectiveLevel(pl, "ban") && (
                    <button className="btn tiny secondary" onClick={() => void run(() => c.unban(room.roomId, m.userId), "Banimento removido")}>
                      Desbanir
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="divider" />
      <h3>Permissões</h3>
      <p className="muted small">Escolha o cargo mínimo necessário para cada ação.</p>
      {PERM_GROUPS.map((g) => {
        const perms = g.perms.filter((p) => !p.only || (p.only === "space" ? isSpace : !isSpace));
        return (
          <div className="perm-group" key={g.title}>
            <div className="field-label">{g.title}</div>
            {perms.map((p) => {
              const level = effectiveLevel(pl, p.key);
              return (
                <div className="perm-row" key={p.key}>
                  <span className="grow">{p.label}</span>
                  <LevelSelect
                    value={level}
                    maxLevel={myPl}
                    disabled={!canPl || level > myPl}
                    onChange={(l) => void change(p.key, l)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
      {feedback}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

export function NotificationsPanel({ room }: { room: Room }) {
  const { run, feedback } = useRun();
  const [busy, setBusy] = useState(false);
  const state = getRoomNotifState(room.roomId);
  const options: [RoomNotifState, string, string][] = [
    ["default", "Padrão", "Segue as suas configurações gerais de notificação."],
    ["all", "Todas as mensagens", "Notifica a cada mensagem nova."],
    ["mentions", "Só menções e palavras-chave", "Notifica quando citarem você, @room ou palavras-chave."],
    ["mute", "Desativado", "Nunca notifica. O canal continua marcando mensagens não lidas."],
  ];
  return (
    <>
      <h2>Notificações</h2>
      <p className="muted small">Vale para todos os seus dispositivos.</p>
      {options.map(([v, title, desc]) => (
        <RadioCard
          key={v}
          active={state === v}
          disabled={busy}
          title={title}
          desc={desc}
          onClick={async () => {
            setBusy(true);
            await run(() => setRoomNotifState(room.roomId, v), "Notificações atualizadas");
            setBusy(false);
          }}
        />
      ))}
      {feedback}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Avançado                                                            */
/* ------------------------------------------------------------------ */

export function AdvancedPanel({ room, onClose }: { room: Room; onClose(): void }) {
  const c = getClient();
  const can = useCan(room);
  const { run, feedback } = useRun();
  const [versions, setVersions] = useState<{ default: string; available: Record<string, string> } | null>(null);
  const [target, setTarget] = useState("");
  const current = room.getVersion();
  const predecessor = room.findPredecessor();
  const tombstone = room.currentState.getStateEvents(EventType.RoomTombstone, "")?.getContent();

  useEffect(() => {
    c.getCapabilities()
      .then((cap) => {
        const v = cap["m.room_versions"];
        if (v) {
          setVersions(v);
          setTarget(v.default);
        }
      })
      .catch(() => undefined);
  }, [c]);

  const upgrade = () => {
    if (
      !confirm(
        `Atualizar a sala da versão ${current} para a ${target}?\n\nUma sala nova será criada no lugar desta, e a antiga ficará arquivada com um link para a nova. Os membros precisam entrar de novo (o Element e o MatrixCord oferecem isso automaticamente).`,
      )
    )
      return;
    void run(async () => {
      const res = await c.upgradeRoom(room.roomId, target);
      const store = useAppStore.getState();
      // Atualiza o vínculo com o servidor pai, se houver
      for (const parent of parentSpaceIds(room)) {
        const child = c.getRoom(parent)?.currentState.getStateEvents(EventType.SpaceChild, room.roomId)?.getContent();
        if (child) {
          await c.sendStateEvent(parent, EventType.SpaceChild, child as never, res.replacement_room).catch(() => undefined);
          await c.sendStateEvent(parent, EventType.SpaceChild, {} as never, room.roomId).catch(() => undefined);
        }
      }
      store.selectRoom(res.replacement_room);
      onClose();
    }, "Sala atualizada");
  };

  const copy = (t: string) => void navigator.clipboard.writeText(t);
  const stability = versions?.available[current];

  return (
    <>
      <h2>Avançado</h2>
      <div className="kv">
        <span>ID interno</span>
        <span className="row gap">
          <span className="selectable">{room.roomId}</span>
          <button className="btn tiny secondary" onClick={() => copy(room.roomId)}>
            Copiar
          </button>
        </span>
        <span>Versão da sala</span>
        <span>
          {current}
          {stability ? ` (${stability === "stable" ? "estável" : "instável"})` : ""}
        </span>
        <span>Tipo</span>
        <span>{room.isSpaceRoom() ? "Espaço (servidor/categoria)" : isVoiceRoom(room) ? "Canal de voz" : "Canal de texto"}</span>
        {predecessor && (
          <>
            <span>Continuação de</span>
            <span className="selectable">{predecessor.roomId}</span>
          </>
        )}
      </div>

      {tombstone?.replacement_room && (
        <p className="notice small">
          Esta sala foi substituída por <span className="selectable">{tombstone.replacement_room as string}</span>.
        </p>
      )}

      {!tombstone?.replacement_room && versions && (
        <>
          <div className="divider" />
          <h3>Atualizar a sala</h3>
          <p className="muted small">
            Versões novas trazem recursos como “Membros do servidor” (v8+) e “Pedir para entrar” (v7+). A versão recomendada
            pelo seu servidor é a <strong>{versions.default}</strong>.
          </p>
          <div className="row gap">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {Object.entries(versions.available)
                .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]) || a[0].localeCompare(b[0]))
                .map(([v, s]) => (
                  <option key={v} value={v}>
                    {v} {s === "stable" ? "" : "(instável)"} {v === versions.default ? "· recomendada" : ""}
                  </option>
                ))}
            </select>
            <button
              className="btn danger-outline small"
              disabled={!can(EventType.RoomTombstone) || !target || target === current}
              onClick={upgrade}
            >
              Atualizar sala
            </button>
          </div>
          {!can(EventType.RoomTombstone) && <p className="muted small">Só quem pode “Atualizar a sala” faz isso.</p>}
        </>
      )}
      {feedback}
    </>
  );
}
