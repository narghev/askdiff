import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileData } from "react-diff-view";
import { useStore } from "@/lib/store";
import { filePath } from "@/lib/selection";
import { fileBadge } from "@/lib/file-badge";
import { cn } from "@/lib/utils";

const countChanges = (file: FileData): { adds: number; dels: number } => {
  let adds = 0;
  let dels = 0;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "insert") adds++;
      else if (change.type === "delete") dels++;
    }
  }
  return { adds, dels };
};

export const FileHeader = ({ file }: { file: FileData }) => {
  const path = filePath(file);
  const collapsed = useStore((s) => s.fileCollapsed[path] === true);
  const viewed = useStore((s) => s.fileViewed[path] === true);
  const toggleCollapsed = useStore((s) => s.toggleCollapsed);
  const toggleViewed = useStore((s) => s.toggleViewed);
  const askCount = useStore((s) =>
    s.askOrder.reduce((n, id) => (s.asks[id]?.file === path ? n + 1 : n), 0),
  );

  const { adds, dels } = useMemo(() => countChanges(file), [file]);
  const badge = fileBadge(file.type);
  const ChevronIcon = collapsed ? ChevronRight : ChevronDown;

  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-center gap-2 border-b bg-card/95 px-3 py-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-card/80",
        viewed && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => {
          toggleCollapsed(path);
        }}
        className="-ml-1 inline-flex size-5 items-center justify-center rounded hover:bg-accent"
        aria-label={collapsed ? "Expand file" : "Collapse file"}
        aria-expanded={!collapsed}
      >
        <ChevronIcon className="size-3.5" />
      </button>
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
      <span className="ml-1 shrink-0 font-mono text-[0.7rem]">
        <span className="text-emerald-700">+{adds}</span>
        <span className="ml-1 text-red-700">-{dels}</span>
      </span>
      {askCount > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[0.65rem] font-medium text-primary-foreground">
          {askCount}
        </span>
      )}
      <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded border px-2 py-0.5 hover:bg-accent">
        <input
          type="checkbox"
          checked={viewed}
          onChange={() => {
            toggleViewed(path);
          }}
          className="size-3 cursor-pointer accent-primary"
        />
        <span>Viewed</span>
      </label>
    </header>
  );
};
