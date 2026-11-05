---
name: thread-list
description: "Inspect or change the sidebar thread list's layout preferences: organization mode, sort, section order, hidden groups, collapsed groups, and thread row actions."
---

# Thread list preferences

## Complete and reopen threads

Press Command+Enter (Control+Enter on other platforms) on a selected thread to
toggle completion. A thread in Completed returns to Queued and keeps the
selector; other threads move into Completed. The three-dot menu also offers
Complete or Reopen.
The command is `plugin:thread-list/complete` and can be rebound in Settings →
Keyboard. It only acts on the focused sidebar row, leaving composer submission
unchanged. Completed rows offer Reopen to return to the unsectioned queue.
The default row quick action is Complete; Archive remains a separate menu action.
Completing a sidebar thread opens the next visible thread below it, skipping
children that move with the completed parent and threads already in Completed.
At the bottom it opens the previous remaining thread, or the new-thread screen
when none remain. Reopening with the selector keeps that thread open and
focused in Queued. Navigation happens
after completion succeeds; Undo restores placement without switching chats.
When completion started from the focused sidebar selector (including
Command/Control+Enter), Undo also returns that selector to the restored thread.

```sh
bb thread-list complete <thread-id> [--json]
bb thread-list reopen <thread-id> [--json]
```

The first completion adopts an existing Completed section or creates one, saving
its id in `completedSectionId` (default `null`). Completed is shown separately
in every organization mode. Completion uses core section placement: it unpins
and detaches the selected thread, keeping its children beneath it. It does not
stop a run, archive its environment, or remove its history. Moving a thread out
of this section also reopens it. Archived threads must be unarchived first.
Existing archived threads are left archived.

SDK clients use `bb.sdk.plugins.callRpc` with plugin id `thread-list`, method
`setCompleted`, and input `{ threadId, completed: true }` (or `false` to reopen).
The typed `threadListRpcContract` exposes the same operation used by menus,
keyboard, and CLI. It returns `{ threadId, sectionId }`.

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
`thread-list/move` (opens a section menu), `thread-list/complete`, or another plugin's
`<pluginId>/<actionId>`. Bare legacy ids such as `archive` and `core/<id>`
keys still work. The default is `'["thread-list/complete"]'` and `'[]'` leaves
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

Set `autoActiveSectionId` to the Active section id to move a queued or completed root thread
to that section when it starts running:
`bb thread-list prefs set autoActiveSectionId <active-section-id>`.
The default is `null` (disabled). The backend rechecks current placement and only
promotes unsectioned root threads or roots in the configured Completed section,
provided they are unpinned and unarchived. It prepends the thread to
manual order, selects Manual sorting, and disables read-status grouping so the
newly active thread appears at the top. When a thread in that Active section becomes
idle, it returns to the top of the unsectioned queue, selecting Manual sorting
and disabling read-status grouping so it stays first. Threads
restarted from Completed follow the same Active → Queued path. Threads in other
custom sections stay there, including after another run. The
backend rereads current status and placement before moving a thread, so stale
finish events do not move a newly running thread or override a manual move.
Deleted destinations are ignored. Reset the preference
to disable the rule. The `setPreference` RPC accepts the same key and value.

Sidebar keyboard selection uses core `sidebar.focus` (Command+Left on macOS)
and `chat.focus` (Command+Right). Arrow Up/Down selects a thread without opening
it; Enter opens it, or starts inline rename when it is already open. The selector has a persistent outline. Opening a thread from the sidebar keeps keyboard control with that selector, including after completion and archive. Click the message box or use `chat.focus` to edit; `sidebar.focus` returns to the remembered selector. `sidebar.archiveSelected`
(Mod+Backspace) archives the selected row using the same core action as its
menu and preserves a neighboring selector. Pipeline movement commands target
the focused row, so Option+Up/Down reorders the selector's thread. Returning
from chat restores the last sidebar selection. Focus shortcuts and archive
are rebindable through core Keyboard settings. Press P while the sidebar selector is
on a thread to pin it, or unpin it when already pinned. This shortcut only acts
on the focused sidebar row and leaves typing in editors unchanged. To add a
modifier shortcut, bind `plugin:thread-list/pin` in Settings → Keyboard. SDK and CLI clients use the
existing `threads.pin` / `threads.unpin` and `bb thread pin` / `bb thread unpin`
operations.

## Backlog follow-ups

The section named Backlog is adopted automatically. `backlogSectionId` (default
`null`) records its id; set it explicitly to use another section. A deleted
configured section disables refresh until it is reconfigured. Entering Backlog
starts an implicit seven-day countdown (`backlogRefreshDays`, default `7`, range
1–3650). Existing Backlog roots start their first countdown when the policy first
observes them. Children stay with their root. Pinned, archived, deleted, and
manually moved threads are not pulled back by an old deadline.

Command+E (Control+E elsewhere), command `plugin:thread-list/triage-backlog`, walks
through Backlog roots that have no explicit follow-up date. It never includes
Queued or Active threads, or threads already given a date. Type `7d`, `7 days`,
`61 min`, `tomorrow at 3pm`, or `Sep 1`; the input previews the resolved local
date. Enter saves and advances, Tab or Skip leaves the default countdown, and Escape
closes. Date-only input uses 9am in the client's timezone; a date without a year
uses its next occurrence. Invalid and past dates cannot be saved. Explicit dates
replace the implicit deadline. A thread's Follow up… menu action can edit an
existing date or schedule a Queued/Active thread, moving it to Backlog without
stopping its run. Cmd+E still only triages unscheduled Backlog work.

The server checks deadlines every minute and once at startup, so overdue work
catches up after downtime. It waits for running threads to become idle. Due
threads return to the bottom of the unsectioned Queued group, below the
horizontal Refreshed divider. They remain there when opened; sending a message
or starting a run makes them hot again. Refresh does not send a message or start
an agent. Worktree grouping cannot merge hot and refreshed rows across the
divider. Deadlines and refreshed markers are stored in the plugin's database.

```sh
bb thread-list backlog list --json
bb thread-list backlog schedule <thread-id> '61 min' --timezone America/Los_Angeles
bb thread-list backlog clear <thread-id>
bb thread-list prefs set backlogRefreshDays 7
bb thread-list prefs set backlogSectionId <section-id>
```

`backlog clear` removes an explicit date and restarts the default countdown.
The `backlogState`, `scheduleFollowUp`, and `clearFollowUp` plugin RPCs expose the
same operations through `bb.sdk.plugins.callRpc`. `scheduleFollowUp` accepts
`{threadId, input, timeZone, onlyBacklog?}`; `onlyBacklog: true` rejects threads
moved out of Backlog while triage was open. The other inputs are `null` and
`{threadId}`, respectively. Every result is `{sectionId, items}`. Each item has
`threadId`, `sectionId`, `enteredAt`, `followUpAt` (null for the implicit policy),
`refreshAt`, `refreshedAt`, and `stage` (`backlog`, `refreshing`, or `refreshed`).
CLI defaults to the server's timezone; pass `--timezone` for the client's zone.

## Visible threads

Threads visible in the current window, including split panes, remain visible and
accented in the sidebar. Collapsed groups show only those threads followed by
Show all when other threads remain hidden. This also applies to Completed and
groups hidden under More. Opening a thread does not change saved collapse or
hidden-group preferences. Show all expands or restores its group using the same
preferences exposed by `bb thread-list prefs` and the `setPreference` RPC.

## Thread origin

Search results show a `bb` badge for BB-created threads and `Codex` for native Codex imports. Sidebar Codex icons are purple for BB-created threads and keep their normal color for native imports; their tooltip states the origin. Continuing an imported conversation in BB preserves its origin. Hiding provider icons also hides this sidebar cue.

The SDK thread list and search responses expose `creationSource` (`bb` or `native`), also visible through `bb thread list --json`. Sidebar plugins receive `PluginSidebarThread.experimental_creationSource`; older hosts omit it.

Completion and reopening show an Undo toast for ten seconds in the UI.
Command/Control+Z reverses the most recent Undo toast, including completion
and archive; Command/Control+Enter confirms it and dismisses the toast.
Completion Undo restores the previous section, parent, and pinned state.
After typing, these shortcuts belong to the editor again; Undo and Confirm
remain clickable in the toast. CLI and RPC completion remain immediate.

During Backlog follow-up triage, Cmd+P peeks at the thread’s human input messages. Cmd+P or Escape returns to the same date draft. CLI: `bb thread log <id> --user-messages --all`. Plugins can use `navigate.toThread(id, { experimental_userMessagesOnly: true })`, and pass false to restore the timeline.
