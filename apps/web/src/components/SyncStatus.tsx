import { CheckCircle2, Circle, XCircle } from "lucide-react";
import type { Source } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

export function SyncStatus({ source }: { source: Source }) {
  if (!source.lastSyncAt) {
    return (
      <Badge variant="outline">
        <Circle className="size-3" />
        never synced
      </Badge>
    );
  }
  if (source.lastSyncOk) {
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" />
        synced {new Date(source.lastSyncAt).toLocaleTimeString()}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" title={source.lastSyncError ?? undefined}>
      <XCircle className="size-3" />
      failed {new Date(source.lastSyncAt).toLocaleTimeString()}
    </Badge>
  );
}
