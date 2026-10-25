import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { build, resolveConfig } from "vite";
import { build as bundleNode } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  localBuildVersionPlugin,
  readLocalBuildVersion,
  reserveLocalBuildVersion,
} from "../../vite-local-build";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function stateFile() {
  const directory = await mkdtemp(join(tmpdir(), "bb-build-version-"));
  directories.push(directory);
  return join(directory, "revision.json");
}

it("persists increasing versions across builds and release changes", async () => {
  const file = await stateFile();
  expect(await reserveLocalBuildVersion(file, "0.47.1")).toBe("0.47.1.1");
  expect(await reserveLocalBuildVersion(file, "0.47.1")).toBe("0.47.1.2");
  expect(await reserveLocalBuildVersion(file, "0.48.0")).toBe("0.48.0.3");
});

it("allocates distinct numbers to simultaneous explicit builds", async () => {
  const file = await stateFile();
  const versions = await Promise.all(
    Array.from({ length: 6 }, () => reserveLocalBuildVersion(file, "0.47.1")),
  );
  expect(new Set(versions).size).toBe(6);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ revision: 6 });
});

it("reports damaged state rather than reusing an old build number", async () => {
  const file = await stateFile();
  await writeFile(file, '{"revision":-1}');
  await expect(reserveLocalBuildVersion(file, "0.47.1")).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe('{"revision":-1}');
  await writeFile(file, '{"revision":9}');
  expect(await reserveLocalBuildVersion(file, "0.47.1")).toBe("0.47.1.10");
});

it("bundles a new version and manifest on each compilation while preserving the previous bundle's identity", async () => {
  const state = await stateFile();
  const directory = join(state, "..");
  const root = join(directory, "apps/app");
  await mkdir(root, { recursive: true });
  await mkdir(join(directory, "apps/desktop"), { recursive: true });
  await writeFile(
    join(directory, "apps/desktop/package.json"),
    '{"version":"0.47.1"}',
  );
  await writeFile(
    join(root, "index.html"),
    '<script type="module" src="/main.js"></script>',
  );
  await writeFile(
    join(root, "main.js"),
    'import { localBuildVersion } from "virtual:bb-local-build"; document.title = localBuildVersion;',
  );
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: join(root, "main.js"),
        formats: ["es"],
        fileName: "bundle",
      },
      outDir: join(root, "dist"),
    },
    plugins: [localBuildVersionPlugin()],
  });
  expect(
    JSON.parse(await readFile(join(root, "dist/local-build.json"), "utf8")),
  ).toEqual({ localBuildVersion: "0.47.1.1" });
  const files = await readdir(join(root, "dist"));
  const bundle = files.find((file) => /\.m?js$/u.test(file));
  if (bundle === undefined)
    throw new Error("Build did not produce a JavaScript bundle");
  const firstBundle = await readFile(join(root, "dist", bundle), "utf8");
  expect(firstBundle).toContain("0.47.1.1");
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: join(root, "main.js"),
        formats: ["es"],
        fileName: "bundle",
      },
      outDir: join(root, "dist"),
    },
    plugins: [localBuildVersionPlugin()],
  });
  expect(
    JSON.parse(await readFile(join(root, "dist/local-build.json"), "utf8")),
  ).toEqual({ localBuildVersion: "0.47.1.2" });
  expect(firstBundle).not.toContain("0.47.1.2");
});

it("dev starts and reading a version never increment the rebuild counter", async () => {
  const file = await stateFile();
  expect(await readLocalBuildVersion(file, "0.47.1")).toBe("0.47.1.0");
  const root = join(file, "../apps/app");
  await mkdir(root, { recursive: true });
  await mkdir(join(file, "../apps/desktop"), { recursive: true });
  await writeFile(
    join(file, "../apps/desktop/package.json"),
    '{"version":"0.47.1"}',
  );
  for (let attempt = 0; attempt < 2; attempt++)
    await resolveConfig(
      {
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [localBuildVersionPlugin()],
      },
      "serve",
    );
  await expect(
    readFile(join(file, "../.bb/local-build-revision.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await reserveLocalBuildVersion(file, "0.47.1")).toBe("0.47.1.1");
  expect(await readLocalBuildVersion(file, "0.47.1")).toBe("0.47.1.1");
});

it("reuses one reserved number throughout a desktop rebuild's nested compilations", async () => {
  const file = await stateFile();
  const root = join(file, "../apps/app");
  await mkdir(root, { recursive: true });
  await mkdir(join(file, "../apps/desktop"), { recursive: true });
  await writeFile(
    join(file, "../apps/desktop/package.json"),
    '{"version":"0.47.1"}',
  );
  const counter = join(file, "../.bb/local-build-revision.json");
  const reserved = await reserveLocalBuildVersion(counter, "0.47.1");
  vi.stubEnv("BB_LOCAL_BUILD_VERSION", reserved);
  for (let attempt = 0; attempt < 2; attempt++)
    await resolveConfig(
      {
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [localBuildVersionPlugin()],
      },
      "build",
    );
  expect(JSON.parse(await readFile(counter, "utf8"))).toEqual({ revision: 1 });
});

it("the desktop packaging entry point reserves exactly one number per requested rebuild", async () => {
  const file = await stateFile();
  const directory = join(file, "..");
  const script = join(directory, "apps/desktop/scripts/package-local.mjs");
  const bin = join(directory, "bin");
  const capture = join(directory, "captured-version");
  await mkdir(join(directory, "apps/desktop/scripts"), { recursive: true });
  await mkdir(bin);
  await writeFile(
    join(directory, "apps/desktop/package.json"),
    '{"version":"0.47.1"}',
  );
  await writeFile(
    join(bin, "pnpm"),
    '#!/bin/sh\nprintf "%s" "$BB_LOCAL_BUILD_VERSION" > "$BB_COUNTER_CAPTURE"\n',
  );
  await chmod(join(bin, "pnpm"), 0o755);
  await bundleNode({
    entryPoints: [
      fileURLToPath(
        new URL("../../../desktop/scripts/package-local.mjs", import.meta.url),
      ),
    ],
    outfile: script,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  for (const revision of [1, 2]) {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BB_COUNTER_CAPTURE: capture,
      },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(await readFile(capture, "utf8")).toBe(`0.47.1.${revision}`);
    expect(
      JSON.parse(
        await readFile(
          join(directory, ".bb/local-build-revision.json"),
          "utf8",
        ),
      ),
    ).toEqual({ revision });
  }
});
