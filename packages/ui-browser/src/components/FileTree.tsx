import { useMemo } from "react";
import { Check } from "lucide-react";
import { parseDiff } from "react-diff-view";
import { useStore } from "@/lib/store";
import { filePath } from "@/lib/selection";
import { fileBadge } from "@/lib/file-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export const FileTree = () => {
  const diff = useStore((s) => s.diff);
  const asks = useStore((s) => s.asks);
  const askOrder = useStore((s) => s.askOrder);
  const selectedFile = useStore((s) => s.selectedFile);
  const fileViewed = useStore((s) => s.fileViewed);
  const requestScrollTo = useStore((s) => s.requestScrollTo);

  const files = useMemo(() => (diff ? parseDiff(diff.raw) : []), [diff]);

  const askCountsByFile = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of askOrder) {
      const ask = asks[id];
      if (!ask) continue;
      m.set(ask.file, (m.get(ask.file) ?? 0) + 1);
    }
    return m;
  }, [asks, askOrder]);

  const viewedCount = files.reduce(
    (n, f) => (fileViewed[filePath(f)] === true ? n + 1 : n),
    0,
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
        <span>Files {files.length > 0 && `(${String(files.length)})`}</span>
        {files.length > 0 && (
          <span className="text-[0.65rem] normal-case">
            {viewedCount}/{files.length} viewed
          </span>
        )}
      </div>
      <ScrollArea className="flex-1">
        <ul className="py-1">
          {files.map((file) => {
            const path = filePath(file);
            const isActive = path === selectedFile;
            const isViewed = fileViewed[path] === true;
            const badge = fileBadge(file.type);
            const askCount = askCountsByFile.get(path) ?? 0;
            return (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => {
                    requestScrollTo(path);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent",
                    isActive && "bg-accent font-medium",
                    isViewed && "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded text-[0.65rem] font-bold",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="truncate font-mono" title={path}>
                    {path}
                  </span>
                  {askCount > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[0.65rem] font-medium text-primary-foreground">
                      {askCount}
                    </span>
                  )}
                  {isViewed && (
                    <Check
                      className="size-3 shrink-0 text-emerald-600"
                      aria-label="viewed"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </aside>
  );
};
