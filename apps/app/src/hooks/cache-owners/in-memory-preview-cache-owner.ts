import type { QueryClient } from "@tanstack/react-query";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { sidebarNavigationQueryKey } from "../queries/query-keys";

export function updateInMemoryPreviewSidebar(
  queryClient: QueryClient,
  data: SidebarBootstrapResponse,
): void {
  queryClient.setQueryData(sidebarNavigationQueryKey(), data);
}
