import { getChangeKey, type ChangeData, type FileData, type HunkData } from "react-diff-view";

/**
 * The new-file line number a change "lives at". Used so comments anchor at
 * a position the server will recognize (the server's diff parser uses
 * new-file line numbers — see packages/server/src/util/diff.ts).
 *
 * Pure-delete lines have no new-file line; callers must treat `null` as
 * "not commentable".
 */
export const changeNewLine = (change: ChangeData): number | null => {
  if (change.type === "insert") return change.lineNumber;
  if (change.type === "normal") return change.newLineNumber;
  return null;
};

const stripPrefix = (content: string): string =>
  content.length > 0 && (content[0] === "+" || content[0] === "-" || content[0] === " ")
    ? content.slice(1)
    : content;

/** Build the chunk payload for a single-line ask. */
export const chunkForLine = (change: ChangeData): string => stripPrefix(change.content);

/** Display path: prefer newPath, fall back to oldPath for pure deletes. */
export const filePath = (file: FileData): string =>
  file.type === "delete" ? file.oldPath : file.newPath;

/**
 * Collapse a set of selected change keys into a commentable range: the
 * first/last new-file line numbers and the joined source text. Pure-delete
 * lines are skipped (no new-file line). Returns null if nothing
 * commentable is selected.
 */
export const rangeFromSelectedChanges = (
  hunks: HunkData[],
  selectedKeys: readonly string[],
): { fromLine: number; toLine: number; chunk: string } | null => {
  if (selectedKeys.length === 0) return null;
  const keySet = new Set(selectedKeys);
  const lines: Array<{ line: number; text: string }> = [];
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (!keySet.has(getChangeKey(change))) continue;
      const line = changeNewLine(change);
      if (line === null) continue;
      lines.push({ line, text: stripPrefix(change.content) });
    }
  }
  if (lines.length === 0) return null;
  lines.sort((a, b) => a.line - b.line);
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return null;
  return {
    fromLine: first.line,
    toLine: last.line,
    chunk: lines.map((l) => l.text).join("\n"),
  };
};
