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
  disabledReason,
}: {
  vpsId: number;
  vpsName: string;
  action: VpsAction;
  variant: "default" | "destructive" | "warning";
  /** Set when some other operation already has this VPS locked - disables
   * the button instead of letting the user hit the same 409 we already
   * know is coming. */
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.vpsAction(vpsId, action),
    // The action itself only confirms SERVERware accepted the request, not
    // that the VPS changed state yet - refetching now mostly just picks up
    // the server-side pendingAction lock so every browser (not just this
    // one) shows "in progress" right away. The real state update still
    // lands within the next refetchInterval tick (<=10s).
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vps"] });
      setOpen(false);
    },
  });

  const isDisabled = Boolean(disabledReason) || mutation.isPending;

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
          <Button
            size="sm"
            variant={variant}
            disabled={isDisabled}
            title={disabledReason}
          >
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

export function VpsActions({
  vpsId,
  vpsName,
  state,
  task,
  pendingAction,
}: {
  vpsId: number;
  vpsName: string;
  state: string | null;
  /** SERVERware's own "other operation in progress" marker. */
  task: string | null;
  /** Our own start/stop/restart lock - see vps.controller.ts. */
  pendingAction: string | null;
}) {
  const disabledReason = task
    ? `SERVERware operation in progress: ${task}`
    : pendingAction
      ? `${ACTION_LABELS[pendingAction as VpsAction] ?? pendingAction} in progress...`
      : undefined;

  return (
    <div className="flex items-center gap-2">
      {state !== "RUNNING" && (
        <ActionButton
          vpsId={vpsId}
          vpsName={vpsName}
          action="start"
          variant="default"
          disabledReason={disabledReason}
        />
      )}
      {state === "RUNNING" && (
        <>
          <ActionButton
            vpsId={vpsId}
            vpsName={vpsName}
            action="stop"
            variant="destructive"
            disabledReason={disabledReason}
          />
          <ActionButton
            vpsId={vpsId}
            vpsName={vpsName}
            action="restart"
            variant="warning"
            disabledReason={disabledReason}
          />
        </>
      )}
      {pendingAction && (
        <span className="text-xs text-muted-foreground">
          {ACTION_LABELS[pendingAction as VpsAction] ?? pendingAction}…
        </span>
      )}
    </div>
  );
}
