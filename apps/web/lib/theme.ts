export type ThemePreference = "system" | "light" | "dark";
export const themeBootScript = `try{var t=localStorage.getItem('fieldnotes:theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'system'}catch{document.documentElement.dataset.theme='system'}`;
const valid = (value: unknown): ThemePreference =>
  value === "light" || value === "dark" ? value : "system";
export const serverTheme = (): ThemePreference => "system";
export const currentTheme = (): ThemePreference =>
  valid(document.documentElement.getAttribute("data-theme"));
export function setThemePreference(value: ThemePreference) {
  document.documentElement.setAttribute("data-theme", value);
  try {
    localStorage.setItem("fieldnotes:theme", value);
  } catch {
    /* Still applies for the current page. */
  }
  window.dispatchEvent(new Event("fieldnotes:theme"));
}
export function subscribeTheme(changed: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== "fieldnotes:theme") return;
    document.documentElement.setAttribute("data-theme", valid(event.newValue));
    changed();
  };
  window.addEventListener("storage", storage);
  window.addEventListener("fieldnotes:theme", changed);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("fieldnotes:theme", changed);
  };
}
