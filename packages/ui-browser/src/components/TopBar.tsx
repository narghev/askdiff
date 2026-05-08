import { useStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./ThemeToggle";

const ConnectionDot = () => {
  const conn = useStore((s) => s.conn);
  const color =
    conn.state === "open"
      ? "bg-emerald-500"
      : conn.state === "connecting"
        ? "bg-amber-500"
        : "bg-destructive";
  return (
    <span
      className={`inline-block size-2 rounded-full ${color}`}
      aria-label={`connection ${conn.state}`}
    />
  );
};

// Truncate to a git-short-sha-style ID. Full UUID lives in the badge's
// title attribute for hover/copy.
const truncSession = (sid: string) =>
  sid.length > 12 ? `${sid.slice(0, 4)}…${sid.slice(-4)}` : sid;

export const TopBar = () => {
  const project = useStore((s) => s.project);
  const protocol = useStore((s) => s.protocol);
  const diffLabel = useStore((s) => s.diff?.label);
  const sessionId = useStore((s) => s.sessionId);

  // Always advertise *what* the user is reviewing — when the skill didn't
  // pre-compute a diff, the server falls back to the working tree, so that
  // becomes the implicit label.
  const label = diffLabel ?? (protocol ? "Working tree" : undefined);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">askdiff</span>
        {protocol && (
          <Badge variant="outline" className="font-mono text-[0.65rem]">
            {protocol}
          </Badge>
        )}
        {label && (
          <Badge variant="muted" className="font-mono text-[0.65rem]">
            {label}
          </Badge>
        )}
      </div>
      {project && (
        <div className="ml-1 truncate font-mono text-xs text-muted-foreground">
          {project}
        </div>
      )}
      <div className="ml-auto flex items-center gap-3">
        {sessionId && (
          <Badge
            variant="outline"
            className="font-mono text-[0.65rem]"
            title={`asks land in Claude Code session ${sessionId}`}
          >
            session {truncSession(sessionId)}
          </Badge>
        )}
        <ThemeToggle />
        <ConnectionDot />
      </div>
    </header>
  );
};
