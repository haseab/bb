import type { Editor } from "@tiptap/core";

export function handlePromptListEnter(
  editor: Editor,
  event: KeyboardEvent,
): boolean {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    event.keyCode === 229 ||
    !editor.isActive("listItem")
  )
    return false;

  event.preventDefault();
  if (!editor.commands.splitListItem("listItem")) {
    editor.commands.liftListItem("listItem");
  }
  return true;
}
