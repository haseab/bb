// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { promptEditorExtensions } from "./prompt-editor-extensions";
import {
  promptEditorContentFromValue,
  promptEditorValueFromDoc,
} from "./prompt-editor-serialization";

const editors: Editor[] = [];
function createEditor(text = ""): Editor {
  const editor = new Editor({
    extensions: promptEditorExtensions({ getPlaceholder: () => "" }),
    content: promptEditorContentFromValue({ text, mentions: [] }),
  });
  editors.push(editor);
  return editor;
}

function type(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handle) =>
      handle(editor.view, from, to, character, () =>
        editor.state.tr.insertText(character, from, to),
      ),
    );
    if (!handled)
      editor.view.dispatch(editor.state.tr.insertText(character, from, to));
  }
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("composer Markdown editing", () => {
  it("formats selected text with the existing bold shortcut and supports undo", () => {
    const editor = createEditor("Hello");
    editor.commands.selectAll();
    editor.commands.keyboardShortcut("Mod-b");
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("Hello");
    expect(promptEditorValueFromDoc(editor.state.doc).text).toBe("**Hello**");
    editor.commands.undo();
    expect(promptEditorValueFromDoc(editor.state.doc).text).toBe("Hello");
  });

  it.each([
    ["**bold**", "strong", "bold"],
    ["_italic_", "em", "italic"],
    ["~~removed~~", "s", "removed"],
    ["`code`", "code", "code"],
    ["# Heading", "h1", "Heading"],
    ["- Item", "li", "Item"],
  ])(
    "renders typed Markdown %s as editable formatting",
    (text, selector, content) => {
      const editor = createEditor();
      type(editor, text);
      expect(editor.view.dom.querySelector(selector)?.textContent).toBe(
        content,
      );
      const serialized = promptEditorValueFromDoc(editor.state.doc);
      const reopened = createEditor(serialized.text);
      expect(reopened.view.dom.querySelector(selector)?.textContent).toBe(
        content,
      );
    },
  );
});
