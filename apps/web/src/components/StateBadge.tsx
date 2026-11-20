import { cn } from "@/lib/utils";

export function StateBadge({ state, task }: { state: string | null; task: string | null }) {
  const { dot, label } =
    state === "RUNNING"
      ? { dot: "bg-success", label: "Running" }
      : state === "STOPPED"
        ? { dot: "bg-muted-foreground/50", label: "Stopped" }
        : { dot: "bg-destructive", label: state ?? "Unknown" };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-foreground/90">
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        {label}
      </span>
      {task && (
        <span
          className="text-xs text-muted-foreground"
          title={`SERVERware task: ${task}`}
        >
          · {task}
        </span>
      )}
    </div>
  );
}
