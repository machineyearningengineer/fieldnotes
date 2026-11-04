"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InkProvider } from "../ui/looseleaf/lib/ink/react";
import { useState } from "react";
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, refetchOnReconnect: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <InkProvider tier="lo">{children}</InkProvider>
    </QueryClientProvider>
  );
}
