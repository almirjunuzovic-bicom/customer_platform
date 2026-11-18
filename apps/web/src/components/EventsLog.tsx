import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, UnauthorizedError, type FleetEvent, type VpsEventType } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const EVENT_TYPES: VpsEventType[] = [
  "state_changed",
  "host_changed",
  "partition_changed",
  "resource_changed",
  "created",
  "removed",
  "action_requested",
];

function EventRow({ event }: { event: FleetEvent }) {
  return (
    <TableRow>
      <TableCell>{new Date(event.detectedAt).toLocaleString()}</TableCell>
      <TableCell className="font-medium">
        <Link
          to="/vps/$vpsId"
          params={{ vpsId: String(event.vpsInventoryId) }}
          className="hover:underline"
        >
          {event.vpsName}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{event.eventType}</Badge>
      </TableCell>
      <TableCell>
        {event.previousValue ? `${event.previousValue} → ${event.newValue}` : event.newValue}
      </TableCell>
      <TableCell className="text-muted-foreground">{event.source}</TableCell>
      <TableCell className="text-muted-foreground">{event.actorName ?? "-"}</TableCell>
    </TableRow>
  );
}

export function EventsLog() {
  const [eventType, setEventType] = useState<VpsEventType | "all">("all");
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["events", eventType],
    queryFn: () => api.events(eventType === "all" ? undefined : { eventType }),
    retry: (failureCount, err) => !(err instanceof UnauthorizedError) && failureCount < 3,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Events</CardTitle>
        <Select
          value={eventType}
          onValueChange={(value) => setEventType(value as VpsEventType | "all")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {EVENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {isError && (
          <p className="text-destructive">Failed to load events: {(error as Error).message}</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">No events found.</p>
        )}
        {data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>VPS</TableHead>
                <TableHead>Event type</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Requested by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
