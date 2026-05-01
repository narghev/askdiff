import type { FileData } from "react-diff-view";
import { filePath } from "@/lib/selection";

export type TreeFile = {
  kind: "file";
  /** Basename used for display in the row. */
  name: string;
  /** Full repo-relative path; matches `filePath(file)`. */
  path: string;
  file: FileData;
};

export type TreeDir = {
  kind: "dir";
  /**
   * Display segment. May be a single dir (`components`) or several joined
   * with `/` if a chain of single-child dirs was compressed
   * (`packages/ui-browser/src`).
   */
  name: string;
  /** Cumulative path from repo root, used as the toggle key. */
  path: string;
  children: TreeNode[];
};

export type TreeNode = TreeFile | TreeDir;

/**
 * Build a directory tree from a flat list of changed files.
 *
 * - Dirs are sorted first, then files; both alphabetical.
 * - Single-child dir chains are collapsed into one displayed row, so a
 *   monorepo path like `packages/ui-browser/src/components/Foo.tsx` doesn't
 *   produce four near-empty levels of chevrons.
 */
export const buildFileTree = (files: FileData[]): TreeNode[] => {
  const root: TreeDir = { kind: "dir", name: "", path: "", children: [] };

  for (const file of files) {
    const path = filePath(file);
    const segs = path.split("/");
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (seg === undefined) continue;
      const dirPath = segs.slice(0, i + 1).join("/");
      let next = cur.children.find(
        (c): c is TreeDir => c.kind === "dir" && c.name === seg,
      );
      if (!next) {
        next = { kind: "dir", name: seg, path: dirPath, children: [] };
        cur.children.push(next);
      }
      cur = next;
    }
    const basename = segs[segs.length - 1] ?? path;
    cur.children.push({ kind: "file", name: basename, path, file });
  }

  sortTree(root);
  // Compress dir children of root, but don't compress the root itself
  // (root is invisible — its children are the rendered top-level rows).
  for (const c of root.children) {
    if (c.kind === "dir") compressDir(c);
  }
  return root.children;
};

const sortTree = (node: TreeDir): void => {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) {
    if (c.kind === "dir") sortTree(c);
  }
};

const compressDir = (dir: TreeDir): void => {
  while (dir.children.length === 1) {
    const only = dir.children[0];
    if (!only || only.kind !== "dir") break;
    dir.name = `${dir.name}/${only.name}`;
    dir.path = only.path;
    dir.children = only.children;
  }
  for (const c of dir.children) {
    if (c.kind === "dir") compressDir(c);
  }
};

/** Recursively sum a predicate over all file leaves under a node. */
export const countLeaves = (
  node: TreeNode,
  pred: (file: TreeFile) => number,
): number => {
  if (node.kind === "file") return pred(node);
  let n = 0;
  for (const c of node.children) n += countLeaves(c, pred);
  return n;
};
