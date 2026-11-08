/**
 * Só em desenvolvimento (?preview=verify): mostra o modal de verificação com dados falsos,
 * para ajustar o visual sem precisar de dois dispositivos.
 * ?preview=verify&step=intro|waiting|incoming|sas|done
 */
import { useEffect } from "react";
import { VerificationPhase, type VerificationRequest } from "matrix-js-sdk/lib/crypto-api/index.js";
import { useVerification } from "../../matrix/verification";
import ThemeApplier from "../ThemeApplier";
import VerificationModal, { VerificationToast } from "./VerificationModal";

const EMOJIS: [string, string][] = [
  ["🐶", "Dog"],
  ["🔑", "Key"],
  ["🚀", "Rocket"],
  ["🍕", "Pizza"],
  ["🎸", "Guitar"],
  ["🌵", "Cactus"],
  ["👍", "Thumbs Up"],
];

export default function VerifyPreview() {
  const step = new URLSearchParams(location.search).get("step") ?? "sas";
  useEffect(() => {
    const phase =
      step === "incoming" || step === "waiting"
        ? VerificationPhase.Requested
        : step === "done"
          ? VerificationPhase.Done
          : VerificationPhase.Started;
    const req = {
      phase,
      initiatedByMe: step !== "incoming",
      isSelfVerification: true,
      otherDeviceId: step === "incoming" ? "QWERTYUIOP" : undefined,
      otherUserId: "@voce:matrix.org",
      verifier: undefined,
      cancel: async () => undefined,
    } as unknown as VerificationRequest;
    useVerification.setState({
      open: step !== "toast",
      request: step === "intro" || step === "toast" ? null : req,
      phase,
      sas:
        step === "sas"
          ? { sas: { emoji: EMOJIS }, confirm: async () => undefined, mismatch: () => undefined, cancel: () => undefined }
          : null,
      receivingKeys: step === "done",
      restore: step === "done" ? { running: true, done: 1234, total: 3000 } : null,
      status: {
        loaded: true,
        crossSigningSetUp: true,
        thisDeviceVerified: false,
        canSignOthers: false,
        backupVersion: "3",
        backupKeyCached: step === "done",
        backupActive: false,
        devices: [],
      },
    });
  }, [step]);
  return (
    <>
      <ThemeApplier />
      <VerificationModal />
      <VerificationToast />
    </>
  );
}
