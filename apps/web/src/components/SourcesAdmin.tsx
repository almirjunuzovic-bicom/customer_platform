import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  api,
  CONNECTOR_TYPES,
  type ConnectorType,
  type CreateSourceInput,
  type Source,
} from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncStatus } from "@/components/SyncStatus";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";

// Only serverware has a real connector today (see connectors/connector.types.ts
// on the backend) - aws/proxmox resolve to UnsupportedConnector, so their
// config/credentials shape isn't known yet. Structured fields for the one
// connector we know, a raw JSON fallback for the rest - no point building a
// form for a shape nobody has decided on.
const STRUCTURED_CONNECTOR_TYPES: ConnectorType[] = ["serverware"];

function EnabledToggle({ source }: { source: Source }) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => api.setSourceEnabled(source.id, enabled),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success(`"${updated.key}" ${updated.enabled ? "enabled" : "disabled"}`, {
        description: "Worker is restarting automatically to apply it.",
      });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <Switch
      checked={source.enabled}
      disabled={mutation.isPending || !isAdmin}
      onCheckedChange={(checked) => mutation.mutate(checked)}
      title={isAdmin ? undefined : "Admin only"}
    />
  );
}

function AddSourceForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [connectorType, setConnectorType] = useState<ConnectorType>("serverware");
  // Structured serverware fields
  const [baseUrl, setBaseUrl] = useState("");
  const [netId, setNetId] = useState("1");
  const [apiToken, setApiToken] = useState("");
  // Generic fallback for not-yet-implemented connectors
  const [configJson, setConfigJson] = useState("{}");
  const [credentialsJson, setCredentialsJson] = useState("{}");

  const mutation = useMutation({
    mutationFn: (input: CreateSourceInput) => api.createSource(input),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success(`Source "${created.key}" saved`, {
        description: "Worker is restarting automatically to pick it up.",
      });
      onDone();
    },
  });

  function buildInput(): CreateSourceInput | null {
    if (!key.trim() || !name.trim()) {
      mutation.reset();
      return null;
    }
    if (STRUCTURED_CONNECTOR_TYPES.includes(connectorType)) {
      if (!baseUrl.trim() || !apiToken.trim()) return null;
      return {
        key: key.trim(),
        name: name.trim(),
        connectorType,
        config: { baseUrl: baseUrl.trim(), netId: Number(netId) || 1 },
        credentials: { apiToken: apiToken.trim() },
      };
    }
    try {
      const config = JSON.parse(configJson);
      const credentials = JSON.parse(credentialsJson);
      return { key: key.trim(), name: name.trim(), connectorType, config, credentials };
    } catch {
      return null;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = buildInput();
    if (!input) {
      toast.error("Fill in all required fields (config/credentials must be valid JSON)");
      return;
    }
    mutation.mutate(input);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="source-key">Key</Label>
          <Input
            id="source-key"
            placeholder="e.g. lon1"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="source-name">Name</Label>
          <Input
            id="source-name"
            placeholder="e.g. UK Lon1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Connector</Label>
        <Select
          value={connectorType}
          onValueChange={(value) => setConnectorType(value as ConnectorType)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONNECTOR_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
                {!STRUCTURED_CONNECTOR_TYPES.includes(type) && " (not implemented yet)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {STRUCTURED_CONNECTOR_TYPES.includes(connectorType) ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="source-base-url">Base URL</Label>
            <Input
              id="source-base-url"
              placeholder="https://uk-lon1.bicomsystems.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-net-id">Network ID</Label>
            <Input
              id="source-net-id"
              type="number"
              value={netId}
              onChange={(e) => setNetId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-api-token">API token</Label>
            <Input
              id="source-api-token"
              type="password"
              placeholder="srw_..."
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">
            No connector built yet for this type - the source can still be saved, but syncing
            it will fail until one exists. Enter raw JSON for now.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="source-config">Config (JSON, non-secret)</Label>
            <Textarea
              id="source-config"
              className="font-mono text-xs"
              rows={3}
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-credentials">Credentials (JSON, encrypted at rest)</Label>
            <Textarea
              id="source-credentials"
              className="font-mono text-xs"
              rows={3}
              value={credentialsJson}
              onChange={(e) => setCredentialsJson(e.target.value)}
            />
          </div>
        </div>
      )}

      {mutation.isError && (
        <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
      )}

      <DialogFooter>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save source"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RestartWorkerButton() {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["worker-status"],
    queryFn: api.workerStatus,
    refetchInterval: 15_000,
  });
  const mutation = useMutation({
    mutationFn: api.restartWorker,
    onSuccess: () => {
      // The new process takes a moment to come up - a refetch right away
      // would likely still show the old one, so give it a beat.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["worker-status"] }), 3000);
      toast.success("Worker restarted", { description: "Picking up any source changes now." });
      setOpen(false);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <div className="flex items-center gap-2">
      {status.data && (
        <Badge variant={status.data.active ? "secondary" : "destructive"}>
          worker: {status.data.active ? "active" : (status.data.state ?? "inactive")}
        </Badge>
      )}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (mutation.isPending) return;
          if (next) mutation.reset();
          setOpen(next);
        }}
      >
        <AlertDialogTrigger
          render={
            <Button variant="outline" disabled={!isAdmin} title={isAdmin ? undefined : "Admin only"}>
              Restart worker
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart the sync worker?</AlertDialogTitle>
            <AlertDialogDescription>
              Adding, enabling, disabling, or deleting a source already restarts the
              worker automatically - use this manually only if it's otherwise stuck
              (e.g. a crash, or a source added via the CLI script). Syncing pauses for
              a few seconds while it comes back up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Restarting..." : "Yes, restart"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeleteSourceButton({ source }: { source: Source }) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.deleteSource(source.id, confirmText),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success(`Source "${result.key}" and all its data deleted`, {
        description: "Worker is restarting automatically to stop its sync job.",
      });
      setOpen(false);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return;
        if (next) {
          mutation.reset();
          setConfirmText("");
        }
        setOpen(next);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant="destructive"
            size="sm"
            disabled={!isAdmin}
            title={isAdmin ? undefined : "Admin only"}
          >
            Delete
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{source.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the source and EVERYTHING synced under it - hosts, VPS
            inventory, their metrics history and events, and partitions. There is no undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-delete-key">
            Type <span className="font-mono font-semibold">{source.key}</span> to confirm
          </Label>
          <Input
            id="confirm-delete-key"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirmText !== source.key || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Deleting..." : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddSourceDialog() {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button disabled={!isAdmin} title={isAdmin ? undefined : "Admin only"}>
            Add source
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Register a new infrastructure source (SERVERware cluster, AWS account, Proxmox
            node). The worker restarts automatically afterward to pick it up.
          </DialogDescription>
        </DialogHeader>
        <AddSourceForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function SourcesAdmin() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sources</CardTitle>
        <div className="flex items-center gap-2">
          <RestartWorkerButton />
          <AddSourceDialog />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {isError && (
          <p className="text-destructive">Failed to load sources: {(error as Error).message}</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">No sources configured yet.</p>
        )}
        {data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Connector</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((source) => (
                <TableRow key={source.id}>
                  <TableCell className="font-medium">{source.key}</TableCell>
                  <TableCell>{source.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{source.connectorType}</Badge>
                  </TableCell>
                  <TableCell>
                    <EnabledToggle source={source} />
                  </TableCell>
                  <TableCell>
                    <SyncStatus source={source} />
                  </TableCell>
                  <TableCell>
                    <DeleteSourceButton source={source} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
