import { useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "askdiff:theme";

const currentTheme = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable (private mode, sandboxed iframe);
      // theme still applies for the session, just won't persist.
    }
    setTheme(next);
  };

  return { theme, toggle };
};
