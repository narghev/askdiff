import { useMemo } from "react";
import { parseDiff } from "react-diff-view";
import { useStore } from "@/lib/store";
import { filePath } from "@/lib/selection";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const fileBadge = (type: string) => {
  switch (type) {
    case "add":
      return { label: "A", className: "bg-emerald-100 text-emerald-700" };
    case "delete":
      return { label: "D", className: "bg-red-100 text-red-700" };
    case "rename":
      return { label: "R", className: "bg-amber-100 text-amber-700" };
    case "copy":
      return { label: "C", className: "bg-sky-100 text-sky-700" };
    default:
      return { label: "M", className: "bg-muted text-foreground" };
  }
};

export const FileTree = () => {
  const diff = useStore((s) => s.diff);
  const asks = useStore((s) => s.asks);
  const askOrder = useStore((s) => s.askOrder);
  const selectedFile = useStore((s) => s.selectedFile);
  const selectFile = useStore((s) => s.selectFile);

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

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="border-b px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
        Files {files.length > 0 && `(${String(files.length)})`}
      </div>
      <ScrollArea className="flex-1">
        <ul className="py-1">
          {files.map((file) => {
            const path = filePath(file);
            const isActive = path === selectedFile;
            const badge = fileBadge(file.type);
            const askCount = askCountsByFile.get(path) ?? 0;
            return (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => {
                    selectFile(path);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent",
                    isActive && "bg-accent font-medium",
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
                    <span className="ml-auto rounded-full bg-primary px-1.5 text-[0.65rem] font-medium text-primary-foreground">
                      {askCount}
                    </span>
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
