import { useEffect, useState, useCallback } from "react";
import { NETWORK_PASSPHRASE } from "../stellar";
import {
  isMainnetPassphrase,
  MAINNET_CONFIRM_KEY,
  isMainnetConfirmed as getMainnetConfirmed,
  setMainnetConfirmed,
} from "../utils/network";

interface NetworkCheckResult {
  networkMatch: boolean;
  walletNetwork: string;
  isMainnet: boolean;
  isMainnetConfirmed: boolean;
  requiresMainnetConfirm: boolean;
  confirmMainnet: () => void;
}

/**
 * Checks whether the Freighter wallet is configured to the same network
 * as the app (NETWORK_PASSPHRASE from stellar.ts).
 * Re-runs whenever the component mounts.
 */
export function useNetworkCheck(): NetworkCheckResult {
  const isMainnet = isMainnetPassphrase(NETWORK_PASSPHRASE);
  const [isMainnetConfirmed, setIsMainnetConfirmed] = useState<boolean>(() => {
    if (!isMainnet) return true;
    try {
      return getMainnetConfirmed();
    } catch {
      return false;
    }
  });

  const confirmMainnet = useCallback(() => {
    setMainnetConfirmed();
    setIsMainnetConfirmed(true);
  }, []);

  const [result, setResult] = useState<Omit<NetworkCheckResult, "isMainnet" | "isMainnetConfirmed" | "requiresMainnetConfirm" | "confirmMainnet">>({
    networkMatch: true, // optimistic default — no false warning before check completes
    walletNetwork: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (typeof window === "undefined" || !window.freighter) return;

      try {
        const { network, networkPassphrase } = await window.freighter.getNetwork();

        if (!cancelled) {
          setResult({
            networkMatch: networkPassphrase === NETWORK_PASSPHRASE,
            walletNetwork: network,
          });
        }
      } catch {
        // If getNetwork() fails (older Freighter), assume match to avoid noise
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep confirmed state in sync with sessionStorage across remounts/storage events
  useEffect(() => {
    if (!isMainnet) return;
    function onStorage(e: StorageEvent) {
      if (e.key === MAINNET_CONFIRM_KEY) {
        try {
          setIsMainnetConfirmed(sessionStorage.getItem(MAINNET_CONFIRM_KEY) === "true");
        } catch {
          // ignore
        }
      }
    }
    // sessionStorage does not fire storage events in same tab, but listen for completeness
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [isMainnet]);

  return {
    ...result,
    isMainnet,
    isMainnetConfirmed,
    requiresMainnetConfirm: isMainnet && !isMainnetConfirmed,
    confirmMainnet,
  };
}
