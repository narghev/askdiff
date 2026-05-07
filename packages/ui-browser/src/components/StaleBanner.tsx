import { AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";

export const StaleBanner = () => {
  const stale = useStore((s) => s.diff?.stale);
  const staleFiles = useStore((s) => s.diff?.staleFiles);

  if (!stale) return null;

  const count = staleFiles?.length ?? 0;
  const fileWord = count === 1 ? "file has" : "files have";

  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-medium">
          {count} {fileWord}
        </strong>{" "}
        changed since this diff was captured. Re-run{" "}
        <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[0.7rem] dark:bg-amber-900/40">
          /askdiff
        </code>{" "}
        in Claude Code to refresh.
      </span>
    </div>
  );
};
