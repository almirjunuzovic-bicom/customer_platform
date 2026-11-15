import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { SourcesAdmin } from "@/components/SourcesAdmin";
import { VpsDetail } from "@/components/VpsDetail";
import { VpsList } from "@/components/VpsList";

// Code-based route tree (no file-based routing plugin) - plain enough
// routes (3) that the codegen step isn't worth the extra build tooling.
const rootRoute = createRootRoute({
  component: AppLayout,
});

const vpsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: VpsList,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources",
  component: SourcesAdmin,
});

const vpsDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vps/$vpsId",
  component: VpsDetail,
});

const routeTree = rootRoute.addChildren([vpsListRoute, sourcesRoute, vpsDetailRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
