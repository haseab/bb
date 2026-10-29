interface ToastShortcut {
  id: string | number | undefined;
  undo: () => void;
  confirm: () => void;
}

const pending = new Set<ToastShortcut>();

function onKeyDown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    !(event.metaKey || event.ctrlKey) ||
    event.altKey ||
    event.shiftKey
  )
    return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "enter") return;
  const latest = [...pending].at(-1);
  if (!latest) return;
  pending.delete(latest);
  event.preventDefault();
  event.stopImmediatePropagation();
  if (key === "z") latest.undo();
  else latest.confirm();
}

function onInput() {
  pending.clear();
}

export function removeToastShortcuts(id?: string | number) {
  for (const action of pending) {
    if (id === undefined || action.id === id) pending.delete(action);
  }
}

export function registerToastShortcuts(action: ToastShortcut) {
  if (pending.size === 0) {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("beforeinput", onInput, true);
    window.addEventListener("input", onInput, true);
  }
  if (action.id !== undefined) removeToastShortcuts(action.id);
  pending.add(action);
  return () => {
    pending.delete(action);
    if (pending.size !== 0) return;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("beforeinput", onInput, true);
    window.removeEventListener("input", onInput, true);
  };
}
