import { useState } from "react";
import { VerificationPhase } from "matrix-js-sdk/lib/crypto-api/index.js";
import {
  acceptIncoming,
  beginSas,
  closeVerification,
  confirmSas,
  emojiName,
  mismatchSas,
  openVerification,
  startSelfVerification,
  useVerification,
} from "../../matrix/verification";
import { Modal } from "./Modal";
import { IconDevices, IconShieldAlert, IconShieldCheck, IconX } from "../icons";

/** Modal global da verificação por emojis (enviada ou recebida). */
export default function VerificationModal() {
  const st = useVerification();
  if (!st.open) return null;
  const { request: req, phase, sas, confirmed, error, status, restore, receivingKeys } = st;
  const otherDevice = req?.otherDeviceId;
  const deviceLabel = otherDevice ? deviceName(otherDevice) : null;

  let title = "Verificar esta sessão";
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (error && (!req || phase === VerificationPhase.Cancelled)) {
    title = "Verificação não concluída";
    body = (
      <div className="verify-center">
        <div className="verify-icon warn">
          <IconShieldAlert size={40} />
        </div>
        <p>{error}</p>
      </div>
    );
    footer = (
      <>
        <button className="btn link" onClick={closeVerification}>
          Fechar
        </button>
        {(!req || req.isSelfVerification) && !status.thisDeviceVerified && (
          <button className="btn primary" onClick={() => void startSelfVerification()}>
            Tentar novamente
          </button>
        )}
      </>
    );
  } else if (!req) {
    body = <Intro />;
    footer = (
      <>
        <button className="btn link" onClick={closeVerification}>
          Agora não
        </button>
        <StartButton disabled={!status.crossSigningSetUp} />
      </>
    );
  } else if (phase === VerificationPhase.Done) {
    title = req.isSelfVerification ? "Sessão verificada" : "Verificado";
    body = (
      <div className="verify-center">
        <div className="verify-icon ok">
          <IconShieldCheck size={40} />
        </div>
        <p>
          {receivingKeys
            ? "Pronto! Esta sessão agora é confiável e está recebendo as chaves das suas mensagens criptografadas."
            : req.isSelfVerification
              ? `A sessão ${deviceLabel ?? "do outro dispositivo"} agora é confiável.`
              : `A identidade de ${req.otherUserId} foi confirmada.`}
        </p>
        {receivingKeys && <RestoreStatus />}
      </div>
    );
    footer = (
      <button className="btn primary" onClick={closeVerification}>
        {restore?.running ? "Continuar em segundo plano" : "Concluir"}
      </button>
    );
  } else if (sas) {
    title = "Compare os emojis";
    const emojis = sas.sas.emoji;
    body = (
      <>
        <p className="muted center">
          Confirme que os emojis abaixo aparecem <strong>na mesma ordem</strong> no outro dispositivo.
        </p>
        {emojis ? (
          <div className="sas-emojis">
            {emojis.map(([emoji, name], i) => (
              <div className="sas-emoji" key={i}>
                <span className="sas-emoji-glyph">{emoji}</span>
                <span className="sas-emoji-name">{emojiName(name)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="sas-decimal">{sas.sas.decimal?.join("  ")}</div>
        )}
        {confirmed && <p className="muted center small">Aguardando o outro dispositivo confirmar…</p>}
      </>
    );
    footer = (
      <>
        <button className="btn danger-outline" onClick={mismatchSas} disabled={confirmed}>
          Eles não combinam
        </button>
        <button className="btn primary" onClick={() => void confirmSas()} disabled={confirmed}>
          {confirmed ? "Aguardando…" : "Eles combinam"}
        </button>
      </>
    );
  } else if (phase === VerificationPhase.Requested && !req.initiatedByMe) {
    title = "Pedido de verificação";
    body = (
      <div className="verify-center">
        <div className="verify-icon">
          <IconDevices size={40} />
        </div>
        <p>
          {req.isSelfVerification ? (
            <>
              Outra sessão sua{deviceLabel ? <> (<strong>{deviceLabel}</strong>)</> : null} quer ser verificada.
            </>
          ) : (
            <>
              <strong>{req.otherUserId}</strong> quer verificar você.
            </>
          )}
        </p>
        <p className="muted small">Só aceite se foi você (ou essa pessoa) quem iniciou o pedido agora.</p>
      </div>
    );
    footer = (
      <>
        <button className="btn link" onClick={closeVerification}>
          Recusar
        </button>
        <button className="btn primary" onClick={() => void acceptIncoming()}>
          Aceitar
        </button>
      </>
    );
  } else if (phase === VerificationPhase.Ready && !req.initiatedByMe && !req.verifier) {
    title = "Pedido aceito";
    body = (
      <div className="verify-center">
        <div className="verify-icon">
          <IconDevices size={40} />
        </div>
        <p>Inicie a comparação de emojis aqui ou no outro dispositivo.</p>
      </div>
    );
    footer = (
      <>
        <button className="btn link" onClick={closeVerification}>
          Cancelar
        </button>
        <button className="btn primary" onClick={() => void beginSas()}>
          Comparar emojis
        </button>
      </>
    );
  } else {
    // Esperando o outro lado aceitar ou responder
    const waitingAccept = phase === VerificationPhase.Requested || phase === VerificationPhase.Unsent;
    body = (
      <div className="verify-center">
        <div className="verify-icon pulse">
          <IconDevices size={40} />
        </div>
        {waitingAccept ? (
          req.isSelfVerification && !otherDevice ? (
            <>
              <p>
                Abra o <strong>Element</strong> (ou o Glitch) em outro dispositivo onde você já está conectado e{" "}
                <strong>aceite o pedido de verificação</strong> que apareceu lá.
              </p>
              <p className="muted small">O pedido expira em alguns minutos.</p>
            </>
          ) : (
            <p>Aguardando {deviceLabel ? <strong>{deviceLabel}</strong> : "o outro dispositivo"} aceitar o pedido…</p>
          )
        ) : (
          <p>Preparando a comparação de emojis…</p>
        )}
        {error && <p className="error small">{error}</p>}
      </div>
    );
    footer = (
      <button className="btn link" onClick={closeVerification}>
        Cancelar
      </button>
    );
  }

  return (
    <Modal title={title} onClose={closeVerification} className="verify-modal" footer={footer}>
      {body}
    </Modal>
  );
}

function Intro() {
  const { status } = useVerification();
  if (status.loaded && !status.crossSigningSetUp) {
    return (
      <div className="verify-center">
        <div className="verify-icon warn">
          <IconShieldAlert size={40} />
        </div>
        <p>
          Sua conta ainda não tem a criptografia configurada (assinatura cruzada). Entre uma vez pelo{" "}
          <strong>Element</strong> e configure a recuperação; depois volte aqui para verificar esta sessão.
        </p>
      </div>
    );
  }
  return (
    <div className="verify-center">
      <div className="verify-icon">
        <IconDevices size={40} />
      </div>
      <p>
        Confirme que é você usando outro dispositivo já conectado (como o Element no celular ou no computador). Vocês
        vão comparar alguns emojis, e depois disso esta sessão recebe as chaves para ler suas mensagens criptografadas.
      </p>
    </div>
  );
}

function StartButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn primary"
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        await startSelfVerification();
        setBusy(false);
      }}
    >
      {busy ? "Enviando…" : "Verificar com outro dispositivo"}
    </button>
  );
}

export function RestoreStatus() {
  const restore = useVerification((s) => s.restore);
  const keyCached = useVerification((s) => s.status.backupKeyCached);
  if (!restore) {
    return (
      <p className="muted small">
        {keyCached ? "Preparando a cópia das chaves…" : "Aguardando o outro dispositivo enviar a chave do backup…"}
      </p>
    );
  }
  if (restore.error) return <p className="muted small">Chaves antigas não copiadas: {restore.error}</p>;
  const pct = restore.total ? Math.round((restore.done / restore.total) * 100) : 0;
  return (
    <div className="restore-progress">
      <div className="restore-label small">
        {restore.running
          ? restore.total
            ? `Copiando chaves das mensagens… ${restore.done} de ${restore.total}`
            : "Baixando o backup de chaves…"
          : `${restore.imported ?? 0} chaves copiadas. As mensagens antigas já podem ser lidas.`}
      </div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${restore.running ? pct : 100}%` }} />
      </div>
    </div>
  );
}

/** Aviso flutuante enquanto esta sessão não estiver verificada. */
export function VerificationToast() {
  const status = useVerification((s) => s.status);
  const open = useVerification((s) => s.open);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("mc.verifyToastDismissed") === "1");
  if (!status.loaded || !status.crossSigningSetUp || status.thisDeviceVerified || open || dismissed) return null;
  return (
    <div className="verify-toast">
      <div className="verify-toast-icon">
        <IconShieldAlert size={22} />
      </div>
      <div className="verify-toast-text">
        <strong>Verifique esta sessão</strong>
        <span>Confirme com outro dispositivo para ler suas mensagens criptografadas.</span>
      </div>
      <button className="btn primary small" onClick={openVerification}>
        Verificar
      </button>
      <button
        className="icon-btn"
        title="Depois"
        onClick={() => {
          sessionStorage.setItem("mc.verifyToastDismissed", "1");
          setDismissed(true);
        }}
      >
        <IconX size={16} />
      </button>
    </div>
  );
}

function deviceName(deviceId: string) {
  const d = useVerification.getState().status.devices.find((x) => x.deviceId === deviceId);
  return d && d.name !== deviceId ? `${d.name} (${deviceId})` : deviceId;
}
