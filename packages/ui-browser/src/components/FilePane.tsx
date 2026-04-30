import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Diff,
  Hunk,
  getChangeKey,
  type FileData,
} from "react-diff-view";
import { useStore, type Ask } from "@/lib/store";
import {
  changeNewLine,
  chunkForLine,
  filePath,
  rangeFromSelectedChanges,
} from "@/lib/selection";
import { useDiffTokens } from "@/hooks/use-diff-tokens";
import { CommentWidget } from "./CommentWidget";

type OpenComposer = { fromLine: number; toLine: number; chunk: string };

type Drag =
  | { phase: "idle" }
  | { phase: "dragging"; start: string; end: string }
  | { phase: "locked"; start: string; end: string };

const IDLE: Drag = { phase: "idle" };

export const FilePane = ({ file }: { file: FileData }) => {
  const path = filePath(file);
  const asks = useStore((s) => s.asks);
  const askOrder = useStore((s) => s.askOrder);
  const openAnchors = useStore((s) => s.openAnchors);
  const openComposer = useStore((s) => s.openComposer);
  const tokens = useDiffTokens(file);

  const [drag, setDrag] = useState<Drag>(IDLE);

  // Reset selection when switching to a different file.
  useEffect(() => {
    setDrag(IDLE);
  }, [path]);

  // Document-level mouseup so releasing outside the diff still finalizes.
  // The ref tracks the latest endpoints so the listener doesn't re-bind on
  // every mouseenter (which fires once per gutter row during a drag).
  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => {
    if (drag.phase !== "dragging") return;
    const onUp = () => {
      const d = dragRef.current;
      if (d.phase !== "dragging") return;
      // Single click (start === end) → single-line comment, no lingering
      // selection. Drag → multi-line comment with the range kept
      // highlighted in a "locked" phase until the next gutter interaction.
      const opener = composerOpener(file, d.start, d.end, path);
      setDrag(d.start === d.end ? IDLE : { phase: "locked", start: d.start, end: d.end });
      if (opener) openComposer(opener);
    };
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
    };
  }, [drag.phase, file, openComposer, path]);

  const selectedKeys = useMemo(() => {
    if (drag.phase === "idle") return [];
    const all = file.hunks.flatMap((h) => h.changes);
    const startIdx = all.findIndex((c) => getChangeKey(c) === drag.start);
    const endIdx = all.findIndex((c) => getChangeKey(c) === drag.end);
    if (startIdx === -1 || endIdx === -1) return [];
    const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    return all.slice(from, to + 1).map((c) => getChangeKey(c));
  }, [drag, file.hunks]);

  // Widgets render at toLine — i.e. the bottom of a multi-line range —
  // so the composer/thread sits where the user finished selecting.
  const asksByLine = useMemo(() => {
    const m = new Map<number, Ask[]>();
    for (const id of askOrder) {
      const ask = asks[id];
      if (!ask || ask.file !== path) continue;
      const list = m.get(ask.toLine) ?? [];
      list.push(ask);
      m.set(ask.toLine, list);
    }
    return m;
  }, [asks, askOrder, path]);

  const openByLine = useMemo(() => {
    const m = new Map<number, OpenComposer>();
    for (const [key, meta] of Object.entries(openAnchors)) {
      const colon = key.lastIndexOf(":");
      if (colon < 0) continue;
      if (key.slice(0, colon) !== path) continue;
      m.set(meta.toLine, meta);
    }
    return m;
  }, [openAnchors, path]);

  const widgets = useMemo(
    () => buildWidgets(file, asksByLine, openByLine),
    [file, asksByLine, openByLine],
  );

  return (
    <div className="overflow-x-auto">
      <Diff
        viewType="split"
        diffType={file.type}
        hunks={file.hunks}
        tokens={tokens}
        widgets={widgets}
        selectedChanges={selectedKeys}
        gutterEvents={{
          onMouseDown: ({ change }, event) => {
            if (!change) return;
            // Prevent the browser's text-selection drag from kicking in.
            event.preventDefault();
            const key = getChangeKey(change);
            setDrag({ phase: "dragging", start: key, end: key });
          },
          onMouseEnter: ({ change }) => {
            if (!change) return;
            const key = getChangeKey(change);
            setDrag((d) => (d.phase === "dragging" ? { ...d, end: key } : d));
          },
        }}
      >
        {(hunks) => hunks.map((h, idx) => <Hunk key={idx} hunk={h} />)}
      </Diff>
    </div>
  );
};

// Resolve the start/end change keys of a drag into an `openComposer`
// payload. Returns null when the selection covers no commentable lines
// (e.g. dragging through pure deletions).
const composerOpener = (
  file: FileData,
  startKey: string,
  endKey: string,
  path: string,
): { file: string; fromLine: number; toLine: number; chunk: string } | null => {
  const all = file.hunks.flatMap((h) => h.changes);
  if (startKey === endKey) {
    const change = all.find((c) => getChangeKey(c) === startKey);
    if (!change) return null;
    const line = changeNewLine(change);
    if (line === null) return null;
    return { file: path, fromLine: line, toLine: line, chunk: chunkForLine(change) };
  }
  const startIdx = all.findIndex((c) => getChangeKey(c) === startKey);
  const endIdx = all.findIndex((c) => getChangeKey(c) === endKey);
  if (startIdx === -1 || endIdx === -1) return null;
  const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  const keys = all.slice(from, to + 1).map((c) => getChangeKey(c));
  const range = rangeFromSelectedChanges(file.hunks, keys);
  if (!range) return null;
  return { file: path, ...range };
};

const buildWidgets = (
  file: FileData,
  asksByLine: Map<number, Ask[]>,
  openByLine: Map<number, OpenComposer>,
): Record<string, ReactNode> => {
  const widgets: Record<string, ReactNode> = {};
  const path = filePath(file);

  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      const line = changeNewLine(change);
      if (line === null) continue;
      const asks = asksByLine.get(line) ?? [];
      const open = openByLine.get(line);
      if (asks.length === 0 && !open) continue;
      const latest = asks[asks.length - 1];
      const fromLine = latest?.fromLine ?? open?.fromLine ?? line;
      const toLine = latest?.toLine ?? open?.toLine ?? line;
      const chunk = latest?.chunk ?? open?.chunk ?? chunkForLine(change);
      widgets[getChangeKey(change)] = (
        <CommentWidget
          file={path}
          fromLine={fromLine}
          toLine={toLine}
          chunk={chunk}
          asks={asks}
        />
      );
    }
  }
  return widgets;
};
