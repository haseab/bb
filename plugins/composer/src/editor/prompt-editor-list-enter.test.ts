// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { promptEditorExtensions } from "./prompt-editor-extensions";
import {
  promptEditorContentFromValue,
  promptEditorValueFromDoc,
} from "./prompt-editor-serialization";
import { handlePromptListEnter } from "./prompt-editor-list-enter";

const editors: Editor[] = [];
function createEditor(text: string) {
  const submit = vi.fn();
  const editor = new Editor({
    extensions: promptEditorExtensions({ getPlaceholder: () => "" }),
    content: promptEditorContentFromValue({ text, mentions: [] }),
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (handlePromptListEnter(editor, event)) return true;
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault();
          submit();
          return true;
        }
        return false;
      },
    },
  });
  editors.push(editor);
  editor.commands.setTextSelection(editor.state.doc.content.size - 2);
  return { editor, submit };
}
function pressEnter(editor: Editor, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...options,
  });
  editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, event));
  return event;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("composer list Enter", () => {
  it.each(["-", "*", "+", "1."])(
    "continues %s items, leaves an empty item, then submits",
    (marker) => {
      const { editor, submit } = createEditor(`${marker} first`);
      editor.commands.focus("end");
      expect(editor.isActive("listItem")).toBe(true);
      expect(pressEnter(editor).defaultPrevented).toBe(true);
      expect(submit).not.toHaveBeenCalled();
      expect(editor.isActive("listItem")).toBe(true);
      expect(editor.state.selection.$from.parent.textContent).toBe("");
      expect(editor.state.doc.firstChild?.childCount).toBe(2);
      pressEnter(editor);
      expect(submit).not.toHaveBeenCalled();
      expect(editor.isActive("listItem")).toBe(false);
      expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
      expect(editor.state.selection.$from.parent.textContent).toBe("");
      expect(editor.state.doc.firstChild?.childCount).toBe(1);
      pressEnter(editor);
      expect(submit).toHaveBeenCalledOnce();
      expect(promptEditorValueFromDoc(editor.state.doc).text).toContain(
        "first",
      );
    },
  );

  it("splits the current item at the caret and allows more than one bullet", () => {
    const { editor, submit } = createEditor("- first second");
    editor.commands.setTextSelection(8);
    pressEnter(editor);
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.child(0).textContent).toBe("first");
    expect(editor.state.doc.firstChild?.child(1).textContent).toBe(" second");
    editor.commands.insertContent("next");
    pressEnter(editor);
    expect(editor.isActive("listItem")).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it("lets plain paragraphs submit immediately", () => {
    const { editor, submit } = createEditor("hello");
    pressEnter(editor);
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each([
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { isComposing: true },
  ])(
    "leaves modified and composing Enter to existing handlers (%j)",
    (options) => {
      const { editor } = createEditor("- first");
      editor.commands.focus("end");
      const before = editor.state.doc;
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        cancelable: true,
        ...options,
      });
      expect(handlePromptListEnter(editor, event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(editor.state.doc).toBe(before);
    },
  );
});
