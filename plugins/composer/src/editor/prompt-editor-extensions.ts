import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Heading from "@tiptap/extension-heading";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Link from "@tiptap/extension-link";
import Strike from "@tiptap/extension-strike";
import {
  BulletList,
  OrderedList,
  ListItem,
  ListKeymap,
} from "@tiptap/extension-list";
import { Extension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions/placeholder";
import Blockquote from "@tiptap/extension-blockquote";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { TrailingNode } from "@tiptap/extensions/trailing-node";
import type { AnyExtension } from "@tiptap/react";
import {
  PromptDecorationExtension,
  type PromptDecorationExtensionOptions,
} from "./prompt-decoration-extension";
import { PromptMentionExtension } from "./prompt-mention-extension";

interface PromptEditorExtensionsOptions extends PromptDecorationExtensionOptions {
  getPlaceholder: () => string;
}

export function promptEditorExtensions({
  getPlaceholder,
  getDecorationSources,
  onRuleError,
}: PromptEditorExtensionsOptions): AnyExtension[] {
  return [
    Bold,
    Italic,
    Code,
    CodeBlock,
    Heading,
    HorizontalRule,
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      shouldAutoLink: () => false,
    }),
    Strike,
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,
    Extension.create({
      name: "promptMarkdownSource",
      addGlobalAttributes() {
        return [
          {
            types: [
              "paragraph",
              "heading",
              "blockquote",
              "bulletList",
              "orderedList",
              "listItem",
              "codeBlock",
              "horizontalRule",
            ],
            attributes: {
              markdownBefore: { default: null, rendered: false },
              markdownPrefix: { default: null, rendered: false },
            },
          },
          {
            types: ["bold", "italic", "strike", "code"],
            attributes: {
              markdownDelimiter: { default: null, rendered: false },
            },
          },
        ];
      },
    }),
    Blockquote,
    Document,
    HardBreak,
    UndoRedo,
    Paragraph,
    Text,
    TrailingNode.configure({
      notAfter: [
        "bulletList",
        "orderedList",
        "codeBlock",
        "heading",
        "horizontalRule",
      ],
    }),
    Placeholder.configure({
      placeholder: () => getPlaceholder(),
    }),
    PromptMentionExtension,
    PromptDecorationExtension.configure({
      ...(getDecorationSources !== undefined ? { getDecorationSources } : {}),
      ...(onRuleError !== undefined ? { onRuleError } : {}),
    }),
  ];
}
