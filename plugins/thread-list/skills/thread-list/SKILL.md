---
name: thread-list
description: "Inspect or change the sidebar thread list's layout preferences: organization mode, sort, section order, hidden groups, collapsed groups, and thread row actions."
---

# Thread list preferences

The Thread list plugin owns the sidebar's layout state. Read it with
`bb thread-list prefs list --json`; keys are `showProviderIcons`, `threadLifecycles`, `organizationMode`,
`environmentGrouping`, `groupByReadStatus`, `chronologicalSort`, `sortDirection`, `sectionOrder`,
`manualSectionOrder`, `machineSectionOrder`, `hiddenGroups` (including the
built-in `threads` group), `rowActions`,
`collapsedSections`, `collapsedProjects`, `collapsedThreads`,
`collapsedEnvironments`, `collapsedThreadSections`, and `collapsedMachines`.

```sh
bb thread-list prefs list [--json]
bb thread-list prefs get <key> [--json]
bb thread-list prefs set <key> <value> [--json]
bb thread-list prefs reset <key> [--json]
```

`set` takes JSON; a bare word is read as a string, so
`bb thread-list prefs set organizationMode machine` and
`bb thread-list prefs set manualSectionOrder '["pinned","sections","threads"]'`
both work. A value the key's schema rejects fails with
`invalid_preference_value` and leaves the stored value alone. Every open
window applies a change immediately. Sections themselves and a thread's
section are bb core state: use `bb thread section` and `bb thread update`.

On first load the plugin copies any non-default `sidebar.*` values from
`bb settings ui` once; after that the two are independent.

`environmentGrouping` decides whether sibling threads sharing one worktree
collapse into a single row: `"auto"` (default) groups them in every
organization except chronological, `false` never groups, and `true` always
groups. Children sharing their parent’s worktree stay directly beneath the
parent without another worktree header. `sortDirection` is `default` (each field's natural order: newest first
for dates, A–Z for titles), `ascending`, or `descending`.

`hiddenGroups` (default `[]`) moves groups into More, the same as a group
menu's Hide from list. Keys are `threads`, `project:<projectId>`,
`section:<sectionId>`, and `machine:<hostId>` (`machine:no-machine` for the
unassigned group); `threads` applies in every organization. Pinned cannot be
hidden, hiding keeps a group's threads, order, and collapse state, and IDs that
no longer exist stay saved without producing rows. `set` replaces the whole
list across organizations, so include existing keys to keep them hidden;
`reset` shows every group:

```sh
bb thread-list prefs set hiddenGroups '["threads","project:proj_example"]'
```

The header's Filter menu selects Active, Archived, or both; at least one must
remain selected. `bb thread-list prefs set threadLifecycles '["archived"]'`
shows archived threads, and `'["active","archived"]'` shows both. The default
is `'["active"]'`. Archived results load in pages; use Show more at the end
of the list. The same preference is available through `setPreference` RPC.

`rowActions` picks up to three quick-action buttons a thread row shows on
hover, left to right before its actions menu, as thread action keys: bb's
`bb--core/split`, `bb--core/copyLink`, `bb--core/read`, `bb--core/pin`,
`bb--core/rename`, `bb--core/archive`, `bb--core/delete`, the list's
`thread-list/move` (opens a section menu), or another plugin's
`<pluginId>/<actionId>`. Bare legacy ids such as `archive` and `core/<id>`
keys still work. The default is `'["bb--core/archive"]'` and `'[]'` leaves
only the menu. For example,
`bb thread-list prefs set rowActions '["bb--core/pin","bb--core/archive"]'`.
In the app, a thread
row's actions menu has Customize actions, which turns that row's quick
actions into three editable slots in place; each slot picks an action, a filled
slot can Hide, and filled slots drag to reorder. Done, Escape, or a click
elsewhere finishes.

Chronological organization shows a project-initial badge to the left of each thread,
with the full project name on hover. Use
`bb thread-list prefs set organizationMode chronological` to list threads across
projects without project headers.

Organize → Rows → Provider icons toggles the icon before each thread title.
`showProviderIcons` defaults to `true`; use
`bb thread-list prefs set showProviderIcons false` to hide them. Unknown
provider ids have no icon.

Organize → Groups → By read status lists threads that show the unread dot above
the rest, keeping the selected sort within each group. `groupByReadStatus`
defaults to `false`; use `bb thread-list prefs set groupByReadStatus true` to
turn it on. Parents start collapsed while it is on, without changing
`collapsedThreads`, and `environmentGrouping` is ignored. The open thread keeps
its place until another thread is opened.

New threads inherit the sidebar group where creation was invoked. Pinned
creates pinned threads; custom sections supply their section; project, machine,
and general thread groups start unsectioned and unpinned. Environment rows
reuse their environment and the containing group's placement. In Pinned,
they retain the group's common underlying section for unpinning; mixed-section
groups use no underlying section.

## Manual pipeline and keyboard moves

Custom sections are manual workflow stages. Create them with
`bb thread section create Completed` and `bb thread section create Active`.
For Completed → Active → Queued, set `threadsSectionLabel` to `Queued` and
`manualSectionOrder` to `["section:<completedId>","section:<activeId>","threads"]`.
Set `chronologicalSort` to `manual` for persistent ordering; `manualThreadOrder`
is the thread-id list (default `[]`). New unsectioned threads appear in Queued.
These stages do not start, stop, or archive agent runs.

Command+Up/Down moves the focused sidebar thread, or the open thread, to the
previous/next section. Option+Up/Down reorders siblings within that section and
switches the list to Manual sorting. Neither wraps at boundaries. Moves animate
unless Reduce Motion is enabled. Pinned threads retain their existing pin order
and use the core pin reorder API. Right-click → Move to offers every custom
section; moving a child into a section detaches it from its parent.

Rebind through Settings → Keyboard or `bb settings keyboard set`, using command
ids `plugin:thread-list/section-up`, `plugin:thread-list/section-down`,
`plugin:thread-list/order-up`, and `plugin:thread-list/order-down`.
The command palette exposes the same operations. API clients can use
`threads.update({threadId, sectionId})`, `threadSections`, and the thread-list
`setPreference` RPC for the same section and manual-order state.

Set `autoActiveSectionId` to the Active section id to move a queued root thread
to that section when it starts running:
`bb thread-list prefs set autoActiveSectionId <active-section-id>`.
The default is `null` (disabled). The backend rechecks current placement and only
promotes unsectioned, unpinned, unarchived root threads. It prepends the thread to
manual order, selects Manual sorting, and disables read-status grouping so the
newly active thread appears at the top. When a thread in that Active section becomes
idle, it returns to the unsectioned queue without changing manual order. Threads
in Completed or another section stay there, including after another run. The
backend rereads current status and placement before moving a thread, so stale
finish events do not move a newly running thread or override a manual move.
Deleted destinations are ignored. Reset the preference
to disable the rule. The `setPreference` RPC accepts the same key and value.

Sidebar keyboard selection uses core `sidebar.focus` (Command+Left on macOS)
and `chat.focus` (Command+Right). Arrow Up/Down selects a thread without opening
it; Enter opens it, or starts inline rename when it is already open. The selector has an outline. `sidebar.archiveSelected`
(Mod+Backspace) archives the selected row using the same core action as its
menu and preserves a neighboring selector. Pipeline movement commands target
the focused row, so Option+Up/Down reorders the selector's thread. Returning
from chat restores the last sidebar selection. Focus shortcuts and archive
are rebindable through core Keyboard settings.

## Thread origin

Search results show a `bb` badge for BB-created threads and `Codex` for native Codex imports. Sidebar Codex icons are purple for BB-created threads and keep their normal color for native imports; their tooltip states the origin. Continuing an imported conversation in BB preserves its origin. Hiding provider icons also hides this sidebar cue.

The SDK thread list and search responses expose `creationSource` (`bb` or `native`), also visible through `bb thread list --json`. Sidebar plugins receive `PluginSidebarThread.experimental_creationSource`; older hosts omit it.
