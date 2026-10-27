bb's composer: the prompt box you type into in every thread, on the New thread screen, and when editing queued or sent messages.

## What you get

- WYSIWYG Markdown for bold, italic, strikethrough, headings, lists, quotes, links, and code, while keeping the composer font size.
- Rich text with @-mention pills for files, folders, threads, sections and plugin items.
- Slash commands and skills, prompt history on the up arrow, and pasted thread links that turn into thread pills.
- Attachments by button, paste or drop, with image and video previews.
- Voice input, the `+` menu, the send menu, and send, queue, steer and stop.
- Everything other plugins add to the composer: banners, actions, popups, menu entries, highlights and commands.

## How it works

bb renders its composer through `app.slots.experimental_composer`, and this plugin is the composer it ships. bb keeps the draft, uploads, history, pickers and sending; the plugin draws the box with `experimental_useComposerRenderer()` and bb's host components.

Switch composers under Settings → Appearance → Composer. With no composer plugin enabled, threads show no composer.

## Make your own

Copy `plugins/composer`, change its id, and edit `src/PromptBoxInternal.tsx`. The copy builds outside bb's repository: it uses only the published plugin SDK, npm packages and bb's registry components. A composer you install wins over this one under Automatic.

## Markdown editing

Markdown drafts and pasted Markdown render as formatted text. Type Markdown shortcuts or use Command/Control+B for bold, Command/Control+I for italic, and Command/Control+E for inline code. Headings inherit the composer's text size. Drafts, history, and submitted prompts remain Markdown strings, including mention offsets. The existing SDK and `bb thread send` accept the same Markdown text without conversion. Other textarea controls are unchanged.
