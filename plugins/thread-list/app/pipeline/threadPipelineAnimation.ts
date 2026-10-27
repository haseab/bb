let focusedLink: HTMLElement | null = null;
let focusedThreadId: string | null = null;
let capturedAt = 0;
let positions: Map<string, DOMRect> | null = null;

function rows(): Map<string, HTMLElement> {
  const result = new Map<string, HTMLElement>();
  document
    .querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")
    .forEach((link) => {
      const id = link.dataset.sidebarThreadId;
      const row = link.closest<HTMLElement>("[data-sidebar-rename-row]");
      if (id && row) result.set(id, row);
    });
  return result;
}

export function captureThreadPipelinePositions(): void {
  focusedLink =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-sidebar-thread-id]")
      : null;
  focusedThreadId = focusedLink?.dataset.sidebarThreadId ?? null;
  capturedAt = Date.now();
  positions = new Map(
    [...rows()].map(([id, row]) => [id, row.getBoundingClientRect()]),
  );
}

export function animateThreadPipelinePositions(): void {
  if (focusedLink && !focusedLink.isConnected && focusedThreadId) {
    for (const link of document.querySelectorAll<HTMLElement>(
      "[data-sidebar-thread-id]",
    )) {
      if (link.dataset.sidebarThreadId === focusedThreadId) {
        link.focus({ preventScroll: true });
        focusedLink = null;
        focusedThreadId = null;
        break;
      }
    }
  }
  const previous = positions;
  if (!previous) return;
  if (Date.now() - capturedAt > 1500) {
    positions = null;
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  for (const [id, row] of rows()) {
    const from = previous.get(id);
    if (!from || !row.animate) continue;
    const to = row.getBoundingClientRect();
    const x = from.left - to.left;
    const y = from.top - to.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
    positions = null;
    row.animate(
      [
        { transform: `translate(${x}px, ${y}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    );
  }
}
