import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { useStore, type Ask } from "@/lib/store";

const formatRange = (fromLine: number, toLine: number): string =>
  fromLine === toLine ? String(fromLine) : `${String(fromLine)}–${String(toLine)}`;

const StatusBadge = ({ status }: { status: Ask["status"] }) => {
  switch (status) {
    case "streaming":
      return (
        <Badge variant="secondary" className="ml-2">
          <Loader2 className="mr-1 size-3 animate-spin" />
          streaming
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="ml-2">
          error
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="muted" className="ml-2">
          cancelled
        </Badge>
      );
    default:
      return null;
  }
};

export const ThreadEntry = ({ ask }: { ask: Ask }) => {
  const cancel = useStore((s) => s.cancel);

  return (
    <div className="space-y-1">
      <div className="flex items-center text-xs font-medium text-muted-foreground">
        <span>You</span>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] font-normal">
          L{formatRange(ask.fromLine, ask.toLine)}
        </span>
        <StatusBadge status={ask.status} />
        {ask.status === "streaming" && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 text-xs"
            onClick={() => {
              cancel(ask.id);
            }}
          >
            Stop
          </Button>
        )}
      </div>
      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        {ask.question}
      </div>
      {(ask.response.length > 0 || ask.status === "done") && (
        <div className="rounded-md border bg-background px-3 py-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Claude
          </div>
          <Markdown source={ask.response || "_(no response yet)_"} />
        </div>
      )}
      {ask.status === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {ask.error ?? "Unknown error"}
        </div>
      )}
    </div>
  );
};
