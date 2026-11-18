import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { DevStatus } from "@/components/DevStatus";
import { SourceDetail } from "@/components/SourceDetail";
import { SourcesAdmin } from "@/components/SourcesAdmin";
import { Topology } from "@/components/Topology";
import { VpsDetail } from "@/components/VpsDetail";
import { VpsList } from "@/components/VpsList";

// Code-based route tree (no file-based routing plugin) - plain enough
// routes that the codegen step isn't worth the extra build tooling.
//
// 3-level drill-down (see hst2171-architecture): Topology (sources) ->
// source detail (its hosts/partitions/vps) -> VPS detail.
const rootRoute = createRootRoute({
  component: AppLayout,
});

const topologyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Topology,
});

const vpsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vps",
  component: VpsList,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources",
  component: SourcesAdmin,
});

const sourceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources/$sourceId",
  component: SourceDetail,
});

const vpsDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vps/$vpsId",
  component: VpsDetail,
});

// Temporary - see hst2171-architecture ("Dev status" page). Remove once
// the team has a better ops story than a browser tab.
const devStatusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev",
  component: DevStatus,
});

const routeTree = rootRoute.addChildren([
  topologyRoute,
  vpsListRoute,
  sourcesRoute,
  sourceDetailRoute,
  vpsDetailRoute,
  devStatusRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
