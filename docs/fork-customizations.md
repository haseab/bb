# BB fork integration checklist

This checkout combines haseab/bb with upstream get-bb/bb. Follow the global
“sync BB” instructions: merge upstream on an integration branch, preserve fork
behavior, verify, and merge a pull request into the fork. A sync never rebuilds
or restarts the installed desktop app.

## Personal plugin extraction — November 7, 2026

Personal workflow code now lives in
[`bb-personal-plugins`](../../bb-personal-plugins/README.md), at
`/Users/haseab/Documents/ChatGPT/general/bb-personal-plugins`. Its Attention and
Personal composer plugins are installed from local paths. Keep future personal
sidebar, backlog, composer, project-editor and appearance work there.

The bundled `plugins/thread-list` and `plugins/composer` match the last
incorporated upstream commit `faec44168f09618ca3e95428f11487e3d535538c`.
The core project-editor dialog and private SDK hook were removed. The old
core-only backlog preview was retired; the standalone plugin harness covers
those interactions. The original sidebar preferences and database were copied
without deleting the legacy state. The legacy plugin is disabled to prevent
duplicate background policies. Attention owns focused-row Mod+Enter; the
legacy `sidebar.completeSelected` binding is disabled in settings.

Native-session ingestion, project/schema semantics, migration history, safe
restart admission and OS window control remain core responsibilities. Shared
new-thread routing and archive/focus command coordination remain core
customizations pending suitable host lifecycle hooks.
The standalone repository documents validation, local reloads and remaining
compatibility limits. No desktop build or restart is implied by extraction.

The extraction release advertises Plugin SDK 0.6.133 so the installed personal
plugins remain eligible to load. This release removes the experimental host
project-editor hook; project editing now uses the public project source SDK.

## Behaviors to preserve

| Area                           | Fork behavior                                                                                                                                                                                               | Regression coverage                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sidebar selection              | Clicks retain the selector; arrows, P, Cmd+Enter and Cmd+Delete work; completion/archive open the next surviving row; Undo restores the original row and selector; completing a completed thread reopens it | Attention plugin selection/completion tests; app ThreadActionsProvider, sidebar focus and shortcuts, app-toast tests |
| Thread pipeline                | Restarted completed threads enter Active, then return to Queued; manual order survives transitions                                                                                                          | Attention plugin server, pipeline, manual-order tests                                                                |
| Unread ordering                | Unread queued/completed items group together with manual ordering inside the group; moving to Active/Queued preserves the grouping preference                                                               | Attention plugin read-status-grouping, thread-promotion and drag tests                                               |
| Backlog                        | Default seven-day return; Cmd+E walks unscheduled backlog items; natural-language dates; refreshed items return below a divider until a message/run makes them hot                                          | Attention plugin backlog, follow-up-date and app tests                                                               |
| Conversation peek              | Cmd+P fades triage away and shows the thread’s user messages; returning restores triage                                                                                                                     | Attention plugin BacklogTriage and ConversationPeek tests                                                            |
| New conversation               | Immediate search field; dropdown animates after 200ms; blank search defaults to No project; typing hides it and selects the first filtered project                                                          | app NewThreadProjectFlow tests                                                                                       |
| Project spaces                 | Folderless named projects and multiple local/remote folders per host; removing the last folder is allowed; upstream observed folder-creation/onboarding remains available                                   | app quick-create/settings tests; Attention ProjectEditor tests; db project sources tests                             |
| Project identity               | Colored badges, provider/native-origin styling, and upstream cross-project metadata coexist                                                                                                                 | Attention row and app project identity tests                                                                         |
| AI decisions                   | Existing Codex login classifies new quick decisions; red markers and queue promotion remain available                                                                                                       | Attention plugin decisions tests                                                                                     |
| Native Codex sessions          | Native conversations and ongoing turn updates sync without confusing BB-created conversations with native imports                                                                                           | provider-codex session-sync/session-reader tests; server native-session-sync tests; db migration tests               |
| Safe restart                   | Detached packaging leaves BB open, gates new dispatch, waits for running/in-flight work, verifies the bundle, replaces /Applications/bb.app and relaunches the matching runtime                             | desktop local-restart-coordinator, server local-restart/dispatch, CLI restart tests                                  |
| Sidebar visibility/performance | Open split-pane threads remain reachable in collapsed groups; selection redraws only the previous/new selected rows                                                                                         | Attention collapsed visibility, navigation and sidebarRowRenders tests                                               |
| Multi-selection                | Upstream core context menu owns bulk actions; custom Complete/Reopen uses its experimental bulk action registration                                                                                         | Attention completeThreadAction tests; app thread action menu tests                                                   |

## Integration of November 6, 2026

- Fork base: c030278a7f51efedaa74843b6c7689c1660bec76.
- Upstream: faec44168f09618ca3e95428f11487e3d535538c (0.48.1).
- Plugin SDK: 0.6.132 includes upstream 0.6.131 plus the fork’s public extensions.
- Host daemon protocol: 265 combines upstream 264 with native session sync.
- The existing uncommitted project-picker filtering change is included.

### Database compatibility

Upstream and this fork independently used migration numbers 147–149. Keep
upstream’s canonical history through 152, and generate the combined fork schema
as 153. Original fork SQL is retained unchanged under `drizzle/legacy-fork`.
The migration runner recognizes its original timestamps, verifies recorded
hashes, completes any partial legacy sequence, applies missing upstream
migrations transactionally, then records the equivalent combined extension.
Fresh and upstream-only profiles run the canonical migration normally.

Migration tests exercise all three historical fork states with real SQLite,
checking conversation/native-link preservation, multiple project folders,
foreign keys, idempotence and rejection of altered legacy hashes. Existing
historical upstream fixture tests remove only the extra fork schema when
rewinding their isolated databases. The server’s recursive migration-directory
copy includes the legacy SQL in packaged runtimes.
