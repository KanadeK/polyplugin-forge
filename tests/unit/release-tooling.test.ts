import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDeterministicZip,
  releaseArtifactNames,
  writeChecksums
} from "../../scripts/package-release.js";
import { parseChecksumManifest } from "../../scripts/release-check.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("release packaging", () => {
  it("uses the exact v0.1.0 artifact contract", () => {
    expect(releaseArtifactNames("polyplugin-forge", "0.1.0")).toEqual({
      tarball: "polyplugin-forge-0.1.0-npm.tgz",
      templates: {
        mcp: "polyplugin-forge-0.1.0-template-mcp.zip",
        vscode: "polyplugin-forge-0.1.0-template-vscode.zip",
        chrome: "polyplugin-forge-0.1.0-template-chrome.zip",
        webhook: "polyplugin-forge-0.1.0-template-webhook.zip"
      },
      matrix: "polyplugin-forge-0.1.0-compatibility-matrix.html",
      checksums: "SHA256SUMS.txt"
    });
  });

  it("creates byte-identical, ordered ZIP output", () => {
    const entries = [
      { path: "template/z.txt", content: Buffer.from("z\n") },
      { path: "template/a.txt", content: Buffer.from("a\n") }
    ];

    const first = createDeterministicZip(entries);
    const second = createDeterministicZip([...entries].reverse());
    expect(digest(first)).toBe(digest(second));

    const unpacked = unzipSync(first);
    expect(Object.keys(unpacked).sort()).toEqual([
      "template/a.txt",
      "template/z.txt"
    ]);
    const firstFile = unpacked["template/a.txt"];
    expect(firstFile).toBeDefined();
    if (firstFile === undefined) {
      throw new Error("Expected template/a.txt in archive");
    }
    expect(strFromU8(firstFile)).toBe("a\n");
  });

  it.each([
    "../escape.txt",
    "/absolute.txt",
    "C:/drive.txt",
    "template\\windows.txt",
    "template/./ambiguous.txt",
    "template/\0bad.txt"
  ])("rejects unsafe archive path %s", (path) => {
    expect(() =>
      createDeterministicZip([{ path, content: Buffer.from("unsafe") }])
    ).toThrow("Unsafe archive path");
  });

  it("rejects duplicate archive paths", () => {
    expect(() =>
      createDeterministicZip([
        { path: "template/file.txt", content: Buffer.from("first") },
        { path: "template/file.txt", content: Buffer.from("second") }
      ])
    ).toThrow("Duplicate archive path");
  });

  it("writes and parses a complete checksum manifest", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "polyplugin-checksum-test-")
    );
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "a.zip"), "alpha");
    await writeFile(join(directory, "b.tgz"), "bravo");

    const content = await writeChecksums(directory, ["b.tgz", "a.zip"]);
    const parsed = parseChecksumManifest(content);

    expect([...parsed.keys()]).toEqual(["a.zip", "b.tgz"]);
    expect(parsed.get("a.zip")).toBe(
      digest(await readFile(join(directory, "a.zip")))
    );
  });

  it("rejects malformed or duplicate checksum entries", () => {
    expect(() => parseChecksumManifest("not-a-checksum\n")).toThrow(
      "invalid entry"
    );
    const hash = "a".repeat(64);
    expect(() =>
      parseChecksumManifest(`${hash}  asset.zip\n${hash}  asset.zip\n`)
    ).toThrow("duplicate entry");
  });
});
