import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { ConfigError } from "./services/config";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Missing configuration won't fix itself, so show its message right away.
      queries: { retry: (failures, error) => !(error instanceof ConfigError) && failures < 2 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
