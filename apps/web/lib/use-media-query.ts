"use client";
import { useCallback, useSyncExternalStore } from "react";
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (changed: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", changed);
      return () => media.removeEventListener("change", changed);
    },
    [query],
  );
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}
