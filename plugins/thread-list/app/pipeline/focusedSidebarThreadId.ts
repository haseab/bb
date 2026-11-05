export function focusedSidebarThreadId(): string | null {
  const focused = document.activeElement;
  if (
    !(focused instanceof HTMLElement) ||
    focused.closest(
      'input, textarea, [contenteditable="true"], [role="textbox"]',
    )
  )
    return null;
  return (
    focused
      .closest("a[data-sidebar-thread-id]")
      ?.getAttribute("data-sidebar-thread-id") ?? null
  );
}
