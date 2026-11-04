"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, replaceEqualDeep } from "@tanstack/react-query";
import {
  MAX_SNAPSHOT_BYTES,
  STREAM_LIFETIME_MS,
  decodeSnapshot,
  newerSnapshot,
  terminal,
  type TaskSnapshot,
} from "@valyu-research/contracts";

const owner = "local-researcher"; // This browser composition uses only the local API.
export const taskKey = (id: string) => ["task", owner, id] as const;
type ConnectionState = "connecting" | "streaming" | "polling" | "offline" | "paused" | "idle";
import { AccessError, diagnosticFor, responseError } from "./diagnostic";
async function readTask(id: string, signal: AbortSignal, etag?: string) {
  const response = await fetch(`/api/research/tasks/${id}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    headers: etag ? { "If-None-Match": etag } : {},
    cache: "no-store",
  });
  if (response.status === 304) return null;
  if (!response.ok) throw await responseError(response);
  return decodeSnapshot(id, await response.json());
}
export function useTask(id: string) {
  const client = useQueryClient();
  const key = useMemo(() => taskKey(id), [id]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [accessError, setAccessError] = useState<Error | null>(null);
  const [recoveryError, setRecoveryError] = useState<Error | null>(null);
  const [transport, setTransport] = useState<"stream" | "poll" | "idle">("idle");
  const terminalRef = useRef(false);
  const query = useQuery<TaskSnapshot>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const result = await readTask(id, signal);
      if (!result) throw new Error("Missing task snapshot.");
      return result;
    },
    structuralSharing: (old, next) => {
      const selected = newerSnapshot(old as TaskSnapshot | undefined, next as TaskSnapshot);
      return selected === old ? old : replaceEqualDeep(old, selected);
    },
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    terminalRef.current = !!query.data && terminal(query.data);
  }, [query.data]);
  useEffect(() => {
    if (query.isPending || query.isFetching || query.error instanceof AccessError) return;
    let stopped = false;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let failedStream = false;
    let pollReads = 0;
    let pollDelay = 0;
    let initial = true;
    const update = (task: TaskSnapshot) => {
      attempts = 0;
      pollDelay = 0;
      client.setQueryData<TaskSnapshot>(key, (old) => newerSnapshot(old, task));
      setAccessError(null);
      setRecoveryError(null);
      if (terminal(task)) {
        terminalRef.current = true;
        active?.abort();
        setTransport("idle");
        setConnection("idle");
      }
    };
    const schedule = (action: () => void, polling = false) => {
      if (stopped || terminalRef.current || document.hidden || !navigator.onLine) return;
      const step = polling ? pollDelay++ : attempts++;
      const base = Math.min(1_000 * 2 ** Math.min(step, 5), 30_000);
      timer = setTimeout(action, base * (0.8 + Math.random() * 0.4));
    };
    const recover = async () => {
      if (stopped || terminalRef.current || document.hidden || !navigator.onLine || active) return;
      const controller = new AbortController();
      active = controller;
      setConnection(failedStream ? "polling" : "connecting");
      setTransport(failedStream ? "poll" : "idle");
      try {
        const current = client.getQueryData<TaskSnapshot>(key);
        if (!initial || !query.isSuccess) {
          const task = await readTask(
            id,
            controller.signal,
            current ? `"${id}-${current.revision}"` : undefined,
          );
          if (task) update(task);
          else {
            attempts = 0;
            setRecoveryError(null);
            if (query.error && current) client.setQueryData(key, current);
          }
        }
        initial = false;
        if (terminalRef.current || controller.signal.aborted) return;
        if (failedStream) {
          if (++pollReads >= 3) {
            failedStream = false;
            pollReads = 0;
          }
          schedule(() => void recover(), true);
          return;
        }
        const headerDeadline = new AbortController();
        const headerTimer = setTimeout(() => headerDeadline.abort(), 12_000);
        const response = await fetch(`/api/research/tasks/${id}/events`, {
          signal: AbortSignal.any([controller.signal, headerDeadline.signal]),
        }).finally(() => clearTimeout(headerTimer));
        if (!response.ok) throw await responseError(response);
        if (!response.ok || !response.body) throw new Error("Stream unavailable.");
        setTransport("stream");
        setConnection("streaming");
        const streamStarted = performance.now();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped && !controller.signal.aborted) {
          let stallTimer: ReturnType<typeof setTimeout> | undefined;
          const packet = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              stallTimer = setTimeout(() => reject(new Error("Stream stalled.")), 42_000);
            }),
          ]).finally(() => {
            if (stallTimer) clearTimeout(stallTimer);
          });
          if (packet.done) {
            // The local API rotates streams at 55s. An earlier nonterminal EOF is a
            // transport failure, even if its HTTP status was 200.
            if (
              !terminalRef.current &&
              !controller.signal.aborted &&
              performance.now() - streamStarted < STREAM_LIFETIME_MS - 5_000
            )
              throw new Error("Stream ended before its planned rotation.");
            break;
          }
          buffer = (buffer + decoder.decode(packet.value, { stream: true })).replace(/\r\n/g, "\n");
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (new TextEncoder().encode(frame).length > MAX_SNAPSHOT_BYTES + 1024)
              throw new Error("Stream frame too large.");
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            try {
              update(decodeSnapshot(id, JSON.parse(data)));
            } catch {
              throw new Error("Invalid stream snapshot.");
            }
            if (terminalRef.current) break;
          }
          if (new TextEncoder().encode(buffer).length > MAX_SNAPSHOT_BYTES + 1024)
            throw new Error("Stream frame too large.");
        }
        if (!terminalRef.current && !controller.signal.aborted) schedule(() => void recover());
      } catch (cause) {
        if (controller.signal.aborted || stopped) return;
        if (cause instanceof AccessError) {
          client.removeQueries({ queryKey: key, exact: true });
          setAccessError(cause);
          setConnection("idle");
          return;
        }
        setRecoveryError(cause instanceof Error ? cause : new Error("Connection interrupted."));
        failedStream = true;
        setTransport("poll");
        setConnection(navigator.onLine ? "polling" : "offline");
        schedule(() => void recover());
      } finally {
        controller.abort();
        if (active === controller) active = null;
      }
    };
    const resume = () => {
      if (timer) clearTimeout(timer);
      active?.abort();
      active = null;
      attempts = 0;
      failedStream = false;
      pollDelay = 0;
      if (document.hidden) {
        setTransport("idle");
        setConnection("paused");
        return;
      }
      if (!navigator.onLine) {
        setTransport("idle");
        setConnection("offline");
        return;
      }
      void recover();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    if (!terminalRef.current) resume();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      active?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    };
  }, [id, client, key, query.isPending, query.isFetching, query.isSuccess, query.error]);
  const currentError = accessError ?? query.error ?? recoveryError;
  const diagnostic = currentError ? diagnosticFor(currentError, query.data) : null;
  return {
    ...query,
    data: query.error instanceof AccessError || accessError ? undefined : query.data,
    error: accessError ?? query.error,
    transport,
    diagnostic,
    connection:
      query.fetchStatus === "paused"
        ? "offline"
        : terminal(query.data ?? { status: "queued" })
          ? "idle"
          : connection,
    accessDenied: query.error instanceof AccessError || !!accessError,
  };
}
