import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readLocalBuildVersion } from "../../../src/services/system/local-build-version.js";

it("reports only valid metadata from the frontend actually being served", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-frontend-version-"));
  try {
    expect(await readLocalBuildVersion(undefined)).toBeNull();
    expect(await readLocalBuildVersion(directory)).toBeNull();
    await writeFile(
      join(directory, "local-build.json"),
      '{"localBuildVersion":"0.47.1.12"}',
    );
    expect(await readLocalBuildVersion(directory)).toBe("0.47.1.12");
    await writeFile(
      join(directory, "local-build.json"),
      '{"localBuildVersion":12}',
    );
    expect(await readLocalBuildVersion(directory)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
