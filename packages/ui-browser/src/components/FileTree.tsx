import { useMemo } from "react";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { parseDiff } from "react-diff-view";
import { useStore } from "@/lib/store";
import { filePath } from "@/lib/selection";
import { fileBadge } from "@/lib/file-badge";
import { buildFileTree, countLeaves, type TreeDir, type TreeFile, type TreeNode } from "@/lib/file-tree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const ROW_PAD = 12;

export const FileTree = () => {
  const diff = useStore((s) => s.diff);

  const files = useMemo(() => (diff ? parseDiff(diff.raw) : []), [diff]);
  const tree = useMemo(() => buildFileTree(files), [files]);
  const fileViewed = useStore((s) => s.fileViewed);
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
          {tree.map((node) => (
            <Node key={node.path} node={node} depth={0} />
          ))}
        </ul>
      </ScrollArea>
    </aside>
  );
};

const Node = ({ node, depth }: { node: TreeNode; depth: number }) =>
  node.kind === "dir" ? (
    <DirRow dir={node} depth={depth} />
  ) : (
    <FileRow file={node} depth={depth} />
  );

const DirRow = ({ dir, depth }: { dir: TreeDir; depth: number }) => {
  const collapsed = useStore((s) => s.treeCollapsed[dir.path] === true);
  const toggleTreeNode = useStore((s) => s.toggleTreeNode);
  const askCount = useStore((s) =>
    countLeaves(dir, (f) =>
      s.askOrder.reduce((n, id) => (s.asks[id]?.file === f.path ? n + 1 : n), 0),
    ),
  );
  const fileViewed = useStore((s) => s.fileViewed);
  const total = countLeaves(dir, () => 1);
  const viewed = countLeaves(dir, (f) => (fileViewed[f.path] === true ? 1 : 0));
  const allViewed = total > 0 && viewed === total;
  const Chev = collapsed ? ChevronRight : ChevronDown;
  const FolderIcon = collapsed ? Folder : FolderOpen;

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          toggleTreeNode(dir.path);
        }}
        style={{ paddingLeft: depth * ROW_PAD + 8 }}
        className={cn(
          "flex w-full items-center gap-1 py-1 pr-3 text-left text-xs hover:bg-accent",
          allViewed && "text-muted-foreground",
        )}
        aria-expanded={!collapsed}
      >
        <Chev className="size-3 shrink-0 text-muted-foreground" />
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono" title={dir.name}>
          {dir.name}
        </span>
        {askCount > 0 && (
          <span className="ml-auto rounded-full bg-primary px-1.5 text-[0.65rem] font-medium text-primary-foreground">
            {askCount}
          </span>
        )}
      </button>
      {!collapsed && (
        <ul>
          {dir.children.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
};

const FileRow = ({ file, depth }: { file: TreeFile; depth: number }) => {
  const selectedFile = useStore((s) => s.selectedFile);
  const isActive = file.path === selectedFile;
  const isViewed = useStore((s) => s.fileViewed[file.path] === true);
  const askCount = useStore((s) =>
    s.askOrder.reduce((n, id) => (s.asks[id]?.file === file.path ? n + 1 : n), 0),
  );
  const requestScrollTo = useStore((s) => s.requestScrollTo);
  const badge = fileBadge(file.file.type);

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          requestScrollTo(file.path);
        }}
        // The chevron column on dir rows is `size-3 + gap-1` ≈ 16px. Add
        // the same to leaf rows so files line up under their dir's icon.
        style={{ paddingLeft: depth * ROW_PAD + 8 + 16 }}
        className={cn(
          "flex w-full items-center gap-2 py-1 pr-3 text-left text-xs hover:bg-accent",
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
        <span className="truncate font-mono" title={file.path}>
          {file.name}
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
};
