import { useEffect, useState } from "react";
import { tokenize, type FileData, type HunkTokens } from "react-diff-view";
import { resolveLanguageForPath } from "@/lib/highlight";
import { filePath } from "@/lib/selection";

/**
 * Lazy-load refractor for the file's language and tokenize its hunks for
 * `<Diff tokens=...>`. Returns null while loading or when no grammar
 * matches; the diff still renders, just without coloring.
 */
export const useDiffTokens = (file: FileData): HunkTokens | null => {
  const [tokens, setTokens] = useState<HunkTokens | null>(null);
  const path = filePath(file);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    void (async () => {
      const resolved = await resolveLanguageForPath(path);
      if (cancelled || !resolved) return;
      try {
        const t = tokenize(file.hunks, {
          highlight: true,
          refractor: resolved.refractor,
          language: resolved.language,
        });
        if (!cancelled) setTokens(t);
      } catch {
        // Some grammars throw on certain inputs; fall back to plain text.
        if (!cancelled) setTokens(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, path]);

  return tokens;
};
