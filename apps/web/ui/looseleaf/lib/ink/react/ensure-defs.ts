// Looseleaf, MIT. See ui/looseleaf/LICENSE.
"use client";

import * as React from "react";

import { ensureInkDefs } from "@/ui/looseleaf/lib/ink/react/defs";
import { useInkContext } from "@/ui/looseleaf/lib/ink/react/hooks";

export function useEnsureInkDefs(): void {
  const { hasProvider } = useInkContext();
  React.useLayoutEffect(() => {
    if (!hasProvider) ensureInkDefs();
  }, [hasProvider]);
}
