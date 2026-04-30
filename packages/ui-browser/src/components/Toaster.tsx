import { useEffect } from "react";
import { X } from "lucide-react";
import { useStore } from "@/lib/store";

const AUTO_DISMISS_MS = 6000;

const ToastItem = ({ id, message }: { id: string; message: string }) => {
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    const t = setTimeout(() => {
      dismiss(id);
    }, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(t);
    };
  }, [id, dismiss]);

  return (
    <div className="pointer-events-auto flex items-start gap-2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm text-destructive shadow-md">
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="dismiss"
        onClick={() => {
          dismiss(id);
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};

export const Toaster = () => {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} message={t.message} />
      ))}
    </div>
  );
};
