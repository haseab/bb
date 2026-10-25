import { localBuildVersion } from "virtual:bb-local-build";
import { useState } from "react";
import { useSystemVersion } from "@/hooks/queries/system-queries";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export function SidebarVersion() {
  const [desktop] = useState(getBbDesktopInfo);
  const systemVersion = useSystemVersion({ enabled: desktop === null });
  const version =
    localBuildVersion ?? desktop?.version ?? systemVersion.data?.currentVersion;
  if (!version) return null;
  const release = version.match(/^(\d+\.\d+)/u)?.[1] ?? version;
  const revision = localBuildVersion?.match(/\.(\d+)$/u)?.[1];
  return (
    <span
      aria-label={`bb version ${version}`}
      className="flex max-w-full shrink-0 select-none flex-col items-center gap-0.5 px-0.5 text-center text-2xs leading-none tabular-nums text-muted-foreground"
      data-sidebar-version
    >
      <span>v{release}</span>
      {revision === undefined ? null : <span>#{revision}</span>}
    </span>
  );
}
