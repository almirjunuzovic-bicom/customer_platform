import type { Source } from "@/lib/api";

export function SyncStatus({ source }: { source: Source }) {
  if (!source.lastSyncAt) {
    return <span className="text-xs text-muted-foreground">never synced</span>;
  }
  if (source.lastSyncOk) {
    return (
      <span className="text-xs text-muted-foreground">
        OK · {new Date(source.lastSyncAt).toLocaleTimeString()}
      </span>
    );
  }
  return (
    <span className="text-xs text-destructive" title={source.lastSyncError ?? undefined}>
      failed · {new Date(source.lastSyncAt).toLocaleTimeString()}
    </span>
  );
}
