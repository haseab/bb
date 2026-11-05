import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { sdk } from "@/lib/sdk";
import { Button } from "@bb/shared-ui/button";
import { appToast } from "@/components/ui/app-toast";

export function LocalRestartNotice() {
  const [pending, setPending] = useState(false);
  const status = useQuery({
    queryKey: ["local-restart"],
    queryFn: () => sdk.system.localRestart(),
    refetchInterval: 3000,
    retry: false,
  });
  const job = status.data?.job;
  if (!job || ["complete", "cancelled"].includes(job.phase)) return null;
  const controls = ["building", "waiting", "blocked"].includes(job.phase);
  const act = async (action: "cancel" | "now") => {
    setPending(true);
    try {
      await sdk.system.controlLocalRestart({ action, id: job.id });
      await status.refetch();
    } catch (error) {
      appToast.error(
        error instanceof Error
          ? error.message
          : "Could not update restart request",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <aside
      aria-label="BB restart"
      role="status"
      className="fixed bottom-4 left-1/2 z-[90] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm shadow-lg"
    >
      <span>
        {job.message ??
          (job.phase === "building"
            ? "Building BB—your threads can keep running"
            : job.phase)}
      </span>
      {controls && (
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => void act("cancel")}
          >
            Cancel restart
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || job.phase === "building"}
            onClick={() => void act("now")}
          >
            Restart now
          </Button>
        </>
      )}
    </aside>
  );
}
