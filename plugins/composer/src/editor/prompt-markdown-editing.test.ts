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
    "**`optimistic-invited-source`** — Makes the guest directory’s invitation-source cell update immediately when saved, without refreshing the directory. Restores the editor and draft on failure and retains safe retry behavior. The changes are **uncommitted**.",
    "_`inline code`_ after",
    "~~`inline code`~~ after",
    "[`inline code`](https://example.com) after",
  ])(
    "pastes nested inline code formatting without rejecting the content: %s",
    (text) => {
      const editor = createEditor();
      const content = promptEditorContentFromValue({ text, mentions: [] });
      expect(editor.commands.insertContent(content.content ?? [])).toBe(true);
      expect(editor.state.doc.textContent).toContain(
        text.includes("optimistic")
          ? "optimistic-invited-source"
          : "inline code",
      );
      expect(promptEditorValueFromDoc(editor.state.doc).text).toBe(text);
    },
  );

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
