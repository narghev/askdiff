export type FileBadge = { label: string; className: string };

export const fileBadge = (type: string): FileBadge => {
  switch (type) {
    case "add":
      return { label: "A", className: "bg-emerald-100 text-emerald-700" };
    case "delete":
      return { label: "D", className: "bg-red-100 text-red-700" };
    case "rename":
      return { label: "R", className: "bg-amber-100 text-amber-700" };
    case "copy":
      return { label: "C", className: "bg-sky-100 text-sky-700" };
    default:
      return { label: "M", className: "bg-muted text-foreground" };
  }
};
