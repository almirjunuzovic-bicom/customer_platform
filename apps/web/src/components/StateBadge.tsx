import { Badge } from "@/components/ui/badge";

export function StateBadge({ state, task }: { state: string | null; task: string | null }) {
  const badge =
    state === "RUNNING" ? (
      <Badge>RUNNING</Badge>
    ) : state === "STOPPED" ? (
      <Badge variant="outline">STOPPED</Badge>
    ) : (
      <Badge variant="destructive">{state ?? "UNKNOWN"}</Badge>
    );
  return (
    <div className="flex items-center gap-1.5">
      {badge}
      {task && (
        <Badge variant="secondary" title={`SERVERware task: ${task}`}>
          {task}
        </Badge>
      )}
    </div>
  );
}
