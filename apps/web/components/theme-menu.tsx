"use client";
import { useSyncExternalStore } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  currentTheme,
  serverTheme,
  subscribeTheme,
  setThemePreference,
  type ThemePreference,
} from "../lib/theme";
const modes = ["system", "light", "dark"] as const;
const icons = { system: Monitor, light: Sun, dark: Moon };
export function ThemeMenu() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
  const next: ThemePreference = modes[(modes.indexOf(theme) + 1) % modes.length]!;
  const Icon = icons[theme];
  return (
    <button
      className="theme-toggle"
      aria-label={`Appearance: ${theme}. Use ${next} mode`}
      title={`Appearance: ${theme}. Switch to ${next}`}
      onClick={() => setThemePreference(next)}
    >
      <Icon size={18} />
    </button>
  );
}
