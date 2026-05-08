import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useStore, type Ask } from "@/lib/store";
import { ThreadEntry } from "./ThreadEntry";

type Props = {
  file: string;
  fromLine: number;
  toLine: number;
  /** Raw text of the lines being commented on (used as the ask `chunk`). */
  chunk: string;
  asks: Ask[];
};

const formatRange = (fromLine: number, toLine: number): string =>
  fromLine === toLine ? String(fromLine) : `${String(fromLine)}–${String(toLine)}`;

export const CommentWidget = ({ file, fromLine, toLine, chunk, asks }: Props) => {
  const [draft, setDraft] = useState("");
  const startAsk = useStore((s) => s.startAsk);
  const closeComposer = useStore((s) => s.closeComposer);
  const conn = useStore((s) => s.conn);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A widget mounts in two cases: a fresh composer the user just opened
  // (no asks yet), or an already-submitted thread. Only steal focus in
  // the first case so existing threads don't snatch the caret on render.
  // Reading `asks.length` once on mount is intentional — re-running this
  // when asks grow would refocus the input every time a reply lands.
  const hasAsksOnMount = useRef(asks.length > 0);
  useEffect(() => {
    if (!hasAsksOnMount.current) textareaRef.current?.focus();
  }, []);

  const canSend = draft.trim().length > 0 && conn.state === "open";

  const submit = () => {
    const question = draft.trim();
    if (!question) return;
    startAsk({ file, fromLine, toLine, chunk, question });
    setDraft("");
  };

  const handleClose = () => {
    if (asks.length === 0) closeComposer(file, fromLine);
  };

  return (
    <div className="my-1 rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-xs text-muted-foreground">
          {file}:{formatRange(fromLine, toLine)}
        </div>
        {asks.length === 0 && (
          <Button variant="ghost" size="icon" onClick={handleClose} aria-label="close">
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {asks.map((ask) => (
          <ThreadEntry key={ask.id} ask={ask} />
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          placeholder={
            asks.length === 0
              ? "Ask Claude about this code…"
              : "Reply or follow up…"
          }
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (canSend) submit();
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" disabled={!canSend} onClick={submit}>
            <Send className="mr-1 size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
};
