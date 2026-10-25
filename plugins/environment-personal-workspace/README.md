# Personal and project workspaces

Provides `personal-workspace` for projectless work and `project-workspace` for projects with optional attached folders. Both create a per-thread directory on an enrolled machine. Sub-threads in these managed directories share their parent environment. Core retires the owned directory after the last thread is archived.

Bundled and installed automatically. Select it through the environment picker or `bb thread spawn --environment-provider personal-workspace`. Use `--environment-provider project-workspace --project <id>` for an independent project directory. Use `bb environment providers --json` for its inputs and availability.

The Plugin Guide documents the experimental environment-provider contract. Core owns durable launches, retries, cancellation, retirement, and teardown; this plugin owns resource creation and removal.
