import { useNostrLogin } from "@nostrify/react/login";
import { useEffect, useRef, useState } from "react";

import { useLoginActions } from "@/hooks/useLoginActions";

import {
  getHostSession,
  isNosuHosted,
  subscribeHostSession,
} from "./hostSignerBridge";
import { devDiagnostic } from "./devDiagnostics";

/** Keeps Armada's active extension login aligned with the Nosu shell. */
export function HostSessionSync(): null {
  const { logins } = useNostrLogin();
  const login = useLoginActions();
  const loginRef = useRef(login);
  loginRef.current = login;
  const [host, setHost] = useState(getHostSession);
  const syncing = useRef<string | undefined>(undefined);

  useEffect(() => subscribeHostSession(setHost), []);

  useEffect(() => {
    devDiagnostic("host-session:state", {
      status: host.status,
      signerKind: host.signerKind,
      hasPubkey: Boolean(host.pubkey),
      armadaLoginCount: logins.length,
      armadaLoginMatchesHost: Boolean(host.pubkey && logins[0]?.pubkey === host.pubkey),
    });
  }, [host, logins]);

  useEffect(() => {
    if (!isNosuHosted() || host.status !== "signed" || !host.pubkey) return;
    if (logins[0]?.pubkey === host.pubkey || syncing.current === host.pubkey) return;

    syncing.current = host.pubkey;
    devDiagnostic("host-session:adopt-start", { signerKind: host.signerKind });
    void loginRef.current.extension().catch((error) => {
      syncing.current = undefined;
      devDiagnostic("host-session:adopt-error", {
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.error("[nosu] Could not adopt the host signer", error);
    });
  }, [host, logins]);

  return null;
}
