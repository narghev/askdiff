import { useMemo } from "react";
import { parseDiff } from "react-diff-view";
import { useStore } from "@/lib/store";
import { filePath } from "@/lib/selection";
import { FilePane } from "./FilePane";
import { Button } from "./ui/button";

export const DiffPane = () => {
  const diff = useStore((s) => s.diff);
  const selectedFile = useStore((s) => s.selectedFile);
  const conn = useStore((s) => s.conn);
  const project = useStore((s) => s.project);

  const files = useMemo(() => (diff ? parseDiff(diff.raw) : []), [diff]);
  const file = useMemo(
    () => files.find((f) => filePath(f) === selectedFile),
    [files, selectedFile],
  );

  if (conn.state === "connecting") {
    return <ConnState text={`Connecting to ${project ?? "askdiff server"}…`} />;
  }
  if (conn.state === "error" || conn.state === "closed") {
    return (
      <ConnState
        text={
          conn.state === "error"
            ? `Connection error: ${conn.error}`
            : `Disconnected${conn.reason ? `: ${conn.reason}` : ""}. Retrying…`
        }
        retry
      />
    );
  }
  if (!diff) return <ConnState text="Waiting for diff…" />;
  if (files.length === 0) return <ConnState text="No changes in the working tree." />;
  if (!file) return <ConnState text="Select a file from the left." />;

  return (
    <div className="p-4">
      <FilePane file={file} />
    </div>
  );
};

const ConnState = ({ text, retry }: { text: string; retry?: boolean }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
    <span>{text}</span>
    {retry && (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          location.reload();
        }}
      >
        Reload
      </Button>
    )}
  </div>
);
