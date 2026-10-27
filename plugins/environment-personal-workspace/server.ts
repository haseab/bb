import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { personalWorkspaceHostContract } from "./contract.js";
import { PERSONAL_WORKSPACE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

export default async function personalWorkspacePlugin(
  bb: BbPluginApi,
): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: personalWorkspaceHostContract,
  });

  for (const workspace of [
    {
      id: PERSONAL_WORKSPACE_ENVIRONMENT_PROVIDER_ID,
      displayName: "Personal workspace",
      description: "Create a personal directory without a project.",
      projectless: true,
    },
    {
      id: "project-workspace",
      displayName: "Project workspace",
      description:
        "Create a working directory for a project with optional attached folders.",
      projectless: false,
    },
  ]) {
    bb.experimental_environments.register({
      id: workspace.id,
      displayName: workspace.displayName,
      description: workspace.description,
      icon: "Folder",
      requires: { projectless: workspace.projectless },
      async create({ host: machine, pathKey, report, signal }) {
        report.step(`Preparing ${workspace.displayName.toLowerCase()}…`);
        try {
          const created = await host.call(
            "createWorkspace",
            { pathKey },
            { hostId: machine.id, signal },
          );
          return {
            status: "created",
            ownsPath: true,
            path: created.path,
          };
        } catch (error) {
          if (signal.aborted) throw error;
          return {
            status: "failed",

            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
      async remove({ hostId, path, pathKey, signal }) {
        if (hostId === null) {
          return {
            status: "failed",
            message: `The ${workspace.displayName.toLowerCase()} machine is unknown`,
          };
        }
        try {
          await host.call(
            "removeWorkspace",
            { pathKey, path },
            { hostId, signal },
          );
          return { status: "removed" };
        } catch (error) {
          if (signal.aborted) throw error;
          return {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
  }
}
