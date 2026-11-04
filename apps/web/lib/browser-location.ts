"use client";
import { useSyncExternalStore } from "react";
const changed = "fieldnotes:location";
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(changed, listener);
  };
};
const snapshot = () => window.location.search;
const server = () => "";
export const useBrowserSearch = () => useSyncExternalStore(subscribe, snapshot, server);
export function setPanel(name: "source" | "compose", value: string | null, push = false) {
  const url = new URL(window.location.href);
  url.searchParams.delete("source");
  url.searchParams.delete("compose");
  if (value) url.searchParams.set(name, value);
  const address = `${url.pathname}${url.search}${url.hash}`;
  if (push) window.history.pushState(null, "", address);
  else window.history.replaceState(null, "", address);
  window.dispatchEvent(new Event(changed));
}
