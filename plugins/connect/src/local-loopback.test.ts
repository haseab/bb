import { describe, expect, it } from "vitest";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";

describe("resolveLocalCloudLoopbackUrl", () => {
  it("targets Vite for source-development pairings with supported Cloud origins", () => {
    expect(
      resolveLocalCloudLoopbackUrl("http://sawyer.localhost:8787", "11001"),
    ).toBe("http://127.0.0.1:11001");
    expect(
      resolveLocalCloudLoopbackUrl(
        "https://sawyer-chinamax.vibecodethis.site",
        "11001",
      ),
    ).toBe("http://127.0.0.1:11001");
    expect(
      resolveLocalCloudLoopbackUrl("http://sawyer.vibecodethis.site", "11001"),
    ).toBeNull();
    expect(
      resolveLocalCloudLoopbackUrl(
        "https://sawyer.vibecodethis.site",
        undefined,
      ),
    ).toBeNull();
    expect(
      resolveLocalCloudLoopbackUrl("https://sawyer.getbb.app", "11001"),
    ).toBe("http://127.0.0.1:11001");
    expect(
      resolveLocalCloudLoopbackUrl("http://sawyer.localhost:8787", undefined),
    ).toBeNull();
  });

  it("keeps packaged builds and unrelated origins off the development UI", () => {
    for (const origin of [
      "https://sawyer.getbb.app",
      "https://sawyer.vibecodethis.site",
    ]) {
      expect(resolveLocalCloudLoopbackUrl(origin, undefined)).toBeNull();
      for (const port of ["0", "65536", "invalid"]) {
        expect(resolveLocalCloudLoopbackUrl(origin, port)).toBeNull();
      }
    }
    for (const origin of [
      "http://sawyer.getbb.app",
      "https://getbb.app.example.com",
      "https://example.com",
    ]) {
      expect(resolveLocalCloudLoopbackUrl(origin, "11001")).toBeNull();
    }
  });
});
