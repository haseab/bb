import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes } from "mdast";
import type { JSONContent } from "@tiptap/core";

const parser = unified().use(remarkParse).use(remarkGfm);
type MarkdownNode = Nodes;
type InlineContent = (from: number, to: number) => JSONContent[];

function span(node: MarkdownNode): { from: number; to: number } | null {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  return from === undefined || to === undefined ? null : { from, to };
}

function hasFormatting(node: MarkdownNode, source: string): boolean {
  const range = span(node);
  if (
    node.type === "link" &&
    range &&
    !source.slice(range.from, range.to).startsWith("[")
  )
    return false;
  if (node.type === "heading" && node.children.length === 0) return false;
  if (
    [
      "delete",
      "strong",
      "emphasis",
      "inlineCode",
      "link",
      "heading",
      "list",
      "code",
      "thematicBreak",
    ].includes(node.type)
  )
    return true;
  return (
    "children" in node &&
    node.children.some((child) => hasFormatting(child, source))
  );
}

function inline(
  node: MarkdownNode,
  source: string,
  raw: InlineContent,
  marks: NonNullable<JSONContent["marks"]> = [],
): JSONContent[] {
  const range = span(node);
  if (!range) return [];
  const addMark = (type: string, attrs?: Record<string, string>) => {
    if (!("children" in node)) return [];
    return node.children.flatMap((child) =>
      inline(child, source, raw, [
        ...marks,
        { type, ...(attrs ? { attrs } : {}) },
      ]),
    );
  };
  if (node.type === "delete") return addMark("strike");
  if (
    node.type === "link" &&
    !source.slice(range.from, range.to).startsWith("[")
  )
    return raw(range.from, range.to).map((part) => ({
      ...part,
      ...(marks.length ? { marks } : {}),
    }));
  if (node.type === "strong")
    return addMark("bold", {
      markdownDelimiter: source.slice(range.from, range.from + 2),
    });
  if (node.type === "emphasis")
    return addMark("italic", {
      markdownDelimiter: source.slice(range.from, range.from + 1),
    });
  if (node.type === "link")
    return addMark("link", {
      href: node.url,
      ...(node.title ? { title: node.title } : {}),
    });
  if (node.type === "inlineCode") {
    const delimiter =
      source.slice(range.from, range.to).match(/^`+/)?.[0] ?? "`";
    return raw(range.from + delimiter.length, range.to - delimiter.length).map(
      (part) => ({
        ...part,
        marks: [
          ...marks,
          { type: "code", attrs: { markdownDelimiter: delimiter } },
        ],
      }),
    );
  }
  if (node.type === "text" && node.value.includes("\n")) {
    let cursor = range.from;
    const values = node.value.split("\n");
    const parts = source
      .slice(range.from, range.to)
      .split("\n")
      .flatMap((line, index) => {
        const expected = values[index] ?? line;
        const skip =
          index > 0 && line.endsWith(expected)
            ? line.length - expected.length
            : 0;
        const content = raw(cursor + skip, cursor + line.length);
        cursor += line.length;
        if (cursor < range.to) {
          content.push(...raw(cursor, cursor + 1));
          cursor += 1;
        }
        return content;
      });
    return parts.map((part) => ({
      ...part,
      ...(marks.length ? { marks } : {}),
    }));
  }
  if ("children" in node)
    return node.children.flatMap((child) => inline(child, source, raw, marks));
  return raw(range.from, range.to).map((part) => ({
    ...part,
    ...(marks.length ? { marks } : {}),
  }));
}

function block(
  node: MarkdownNode,
  source: string,
  raw: InlineContent,
): JSONContent {
  const range = span(node);
  const children = "children" in node ? node.children : [];
  if (node.type === "heading")
    return {
      type: "heading",
      attrs: { level: node.depth },
      content: children.flatMap((child) => inline(child, source, raw)),
    };
  if (node.type === "code")
    return {
      type: "codeBlock",
      attrs: { language: node.lang },
      ...(node.value.length
        ? { content: [{ type: "text", text: node.value }] }
        : {}),
    };
  if (node.type === "thematicBreak") return { type: "horizontalRule" };
  if (node.type === "list")
    return {
      type: node.ordered ? "orderedList" : "bulletList",
      attrs: {
        ...(node.ordered ? { start: node.start ?? 1 } : {}),
        markdownPrefix: range
          ? (source
              .slice(range.from, range.to)
              .match(/^(?:[-+*]|\d+[.)])\s+/)?.[0] ?? null)
          : null,
      },
      content: children.map((child) => block(child, source, raw)),
    };
  if (node.type === "listItem")
    return {
      type: "listItem",
      content: children.map((child) => block(child, source, raw)),
    };
  if (node.type === "blockquote")
    return {
      type: "blockquote",
      content: children.map((child) => block(child, source, raw)),
    };
  if (node.type === "paragraph")
    return {
      type: "paragraph",
      content: children.flatMap((child) => inline(child, source, raw)),
    };
  return { type: "paragraph", content: range ? raw(range.from, range.to) : [] };
}

export function promptMarkdownContent(
  source: string,
  raw: InlineContent,
): JSONContent | null {
  if (source.length > 100_000) return null;
  const tree = parser.parse(source);
  if (!hasFormatting(tree, source)) return null;
  let previousEnd = 0;
  const content = tree.children.map((node, index) => {
    const range = span(node);
    const result = block(node, source, raw);
    const before = range ? source.slice(previousEnd, range.from) : "";
    if (range) previousEnd = range.to;
    return {
      ...result,
      attrs: { ...result.attrs, markdownBefore: index === 0 ? null : before },
    };
  });
  const trailing = source.slice(previousEnd);
  if (trailing.length)
    content.push({
      type: "paragraph",
      attrs: { markdownBefore: "\n" },
      content: raw(previousEnd + 1, source.length),
    });
  return { type: "doc", content };
}

export function promptMarkdownInline(
  source: string,
  raw: InlineContent,
): JSONContent[] | null {
  if (source.length > 100_000) return null;
  const tree = parser.parse(source);
  if (
    !hasFormatting(tree, source) ||
    tree.children.length !== 1 ||
    tree.children[0]?.type !== "paragraph"
  )
    return null;
  const children = tree.children[0].children;
  const first = children[0] && span(children[0]);
  const last =
    children[children.length - 1] && span(children[children.length - 1]!);
  return [
    ...raw(0, first?.from ?? 0),
    ...children.flatMap((node) => inline(node, source, raw)),
    ...raw(last?.to ?? source.length, source.length),
  ];
}
