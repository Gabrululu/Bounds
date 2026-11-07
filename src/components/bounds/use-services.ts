import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSettings, type Settings } from "@/services/config";
import { emit, subscribe } from "@/services/events";
import { watchRevocations } from "@/services/guardian";
import { getTx, subscribeTx, type TxAction } from "@/services/tx";

const subscribeServices = (l: () => void) => {
  const off = subscribe(l);
  return () => {
    off();
  };
};

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeServices, getSettings, getSettings);
}

export function useTx(action: TxAction) {
  return useSyncExternalStore(
    subscribeTx,
    () => getTx(action),
    () => undefined,
  );
}

/** Refetches on every service write, and on LicenseRevoked events from the guardian. */
export function useServiceSync() {
  const qc = useQueryClient();
  const { guardianAddress } = useSettings();

  useEffect(() => {
    const off = subscribe(() => {
      // Drop cached data for screens not on view so they never show pre-mutation state.
      qc.removeQueries({ type: "inactive" });
      qc.invalidateQueries();
    });
    return () => {
      off();
    };
  }, [qc]);

  useEffect(
    () =>
      watchRevocations(
        () => emit(),
        (error) => console.error("LicenseRevoked subscription failed", error),
      ),
    [guardianAddress],
  );
}
