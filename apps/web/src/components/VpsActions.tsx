import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type VpsAction } from "@/lib/api";
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
import { Button } from "@/components/ui/button";

const ACTION_LABELS: Record<VpsAction, string> = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
};

function ActionButton({
  vpsId,
  vpsName,
  action,
  variant,
}: {
  vpsId: number;
  vpsName: string;
  action: VpsAction;
  variant: "default" | "destructive" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.vpsAction(vpsId, action),
    // The action itself only confirms SERVERware accepted the request, not
    // that the VPS changed state yet - refetching now mostly just clears
    // the "pending" UI. The real state update lands within the next
    // refetchInterval tick (<=10s) once the poller confirms it.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vps"] });
      setOpen(false);
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Don't let a click-away/escape close it mid-request and lose the
        // only place the error message is shown.
        if (mutation.isPending) return;
        if (next) mutation.reset(); // clear a stale error from last time
        setOpen(next);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button size="sm" variant={variant} disabled={mutation.isPending}>
            {ACTION_LABELS[action]}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {ACTION_LABELS[action]} "{vpsName}"?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to {action} this VPS? This sends a real
            command to SERVERware.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError && (
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={variant}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Working..." : `Yes, ${action}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function VpsActions({ vpsId, vpsName, state }: { vpsId: number; vpsName: string; state: string | null }) {
  return (
    <div className="flex gap-2">
      {state !== "RUNNING" && (
        <ActionButton vpsId={vpsId} vpsName={vpsName} action="start" variant="default" />
      )}
      {state === "RUNNING" && (
        <>
          <ActionButton vpsId={vpsId} vpsName={vpsName} action="stop" variant="destructive" />
          <ActionButton vpsId={vpsId} vpsName={vpsName} action="restart" variant="outline" />
        </>
      )}
    </div>
  );
}
