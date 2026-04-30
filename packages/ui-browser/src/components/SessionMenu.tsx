import { useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const truncSession = (sid: string) =>
  sid.length > 12 ? `${sid.slice(0, 4)}…${sid.slice(-4)}` : sid;

export const SessionMenu = () => {
  const sessionId = useStore((s) => s.sessionId);
  const setSession = useStore((s) => s.setSession);
  const conn = useStore((s) => s.conn);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  const apply = () => {
    const v = draft.trim();
    if (!v) return;
    setSession(v);
    setDraft("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2">
          {sessionId === null ? (
            <>
              <CircleAlert className="size-3.5 text-destructive" />
              <span className="text-xs text-destructive">Session not set</span>
            </>
          ) : (
            <>
              <CircleCheck className="size-3.5 text-emerald-600" />
              <span className="font-mono text-xs">{truncSession(sessionId)}</span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Claude session</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Set the Claude Code session UUID this UI should attach to.
              Asks append to that session's transcript.
            </p>
          </div>
          {sessionId !== null && (
            <div className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
              {sessionId}
            </div>
          )}
          <div className="space-y-2">
            <Input
              placeholder="00000000-0000-0000-0000-000000000000"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
            />
            <Button
              size="sm"
              className="w-full"
              onClick={apply}
              disabled={draft.trim().length === 0 || conn.state !== "open"}
            >
              {sessionId === null ? "Set session" : "Switch session"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
