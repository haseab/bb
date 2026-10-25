import { describe, expect, it } from "vitest";
import { projectResponseSchema } from "@bb/server-contract";
import { getThread, getEnvironment } from "@bb/db";
import {
  seedHost,
  seedPrimaryHost,
  seedThread,
  seedEnvironment,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const jsonHeaders = { "content-type": "application/json" };

describe("project spaces", () => {
  it("creates independent projects without a machine or folder", async () => {
    await withTestHarness(async ({ app }) => {
      const ids = new Set<string>();
      for (let index = 0; index < 2; index++) {
        const response = await app.request("/api/v1/projects", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ name: "Research" }),
        });
        expect(response.status).toBe(201);
        const project = projectResponseSchema.parse(await response.json());
        expect(project.sources).toEqual([]);
        expect(project.name).toBe("Research");
        ids.add(project.id);
        const loaded = await app.request(`/api/v1/projects/${project.id}`);
        expect(projectResponseSchema.parse(await loaded.json())).toEqual(
          project,
        );
      }
      expect(ids.size).toBe(2);
    });
  });

  it("attaches multiple folders on one machine and removes every folder without deleting the project", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-space" });
      seedPrimaryHost(harness.deps, host.id);
      const created = await harness.app.request("/api/v1/projects", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "Product",
          source: { type: "local_path", hostId: host.id, path: "/work/api" },
        }),
      });
      expect(created.status).toBe(201);
      const project = projectResponseSchema.parse(await created.json());
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/work/api",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const added = await harness.app.request(
        `/api/v1/projects/${project.id}/sources`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            type: "local_path",
            hostId: host.id,
            path: "/work/web",
          }),
        },
      );
      expect(added.status).toBe(201);
      const duplicate = await harness.app.request(
        `/api/v1/projects/${project.id}/sources`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            type: "local_path",
            hostId: host.id,
            path: "/work/web/",
          }),
        },
      );
      expect(duplicate.status).toBe(409);
      const loaded = await harness.app.request(
        `/api/v1/projects/${project.id}`,
      );
      const withFolders = projectResponseSchema.parse(await loaded.json());
      expect(withFolders.sources.map((source) => source.path).sort()).toEqual([
        "/work/api",
        "/work/web",
      ]);
      for (const source of withFolders.sources) {
        const removed = await harness.app.request(
          `/api/v1/projects/${project.id}/sources/${source.id}`,
          { method: "DELETE" },
        );
        expect(removed.status).toBe(200);
      }
      expect(getThread(harness.db, thread.id)?.projectId).toBe(project.id);
      expect(getEnvironment(harness.db, environment.id)?.path).toBe(
        "/work/api",
      );
      const remaining = await harness.app.request(
        `/api/v1/projects/${project.id}`,
      );
      expect(projectResponseSchema.parse(await remaining.json())).toMatchObject(
        { id: project.id, name: "Product", sources: [] },
      );
    });
  });
});
