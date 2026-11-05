import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SIDEBAR_SUCCESS_STATUS_DOT_CLASS } from "@/components/ui/sidebar-row-classes";
import type { QuickDecision } from "../../shared/decisions.js";

export function QuickDecisionDot({ decision }: { decision: QuickDecision }) {
  const label = `${decision.level === "instant" ? "Instant decision" : "Quick decision"}${decision.reason ? `: ${decision.reason}` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          data-thread-status-glyph="quick-decision"
          data-decision-level={decision.level}
          className={SIDEBAR_SUCCESS_STATUS_DOT_CLASS}
          style={{
            backgroundColor:
              decision.level === "instant"
                ? "var(--destructive)"
                : "color-mix(in oklch, var(--destructive) 60%, var(--destructive-foreground))",
          }}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
