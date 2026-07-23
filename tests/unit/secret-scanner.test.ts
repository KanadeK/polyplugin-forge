import { describe, expect, it } from "vitest";

import {
  scanFilesForSecrets,
  scanTextForSecrets
} from "../../src/core/secret-scanner.js";

describe("scanTextForSecrets", () => {
  it("detects specific credential families without echoing matched values", () => {
    const githubToken = `ghp_${"a".repeat(36)}`;
    const awsKey = `AKIA${"B".repeat(16)}`;
    const openAiKey = `sk-proj-${"c".repeat(32)}`;
    const jwt = `eyJ${"d".repeat(12)}.${"e".repeat(12)}.${"f".repeat(12)}`;
    const content = [
      `github=${githubToken}`,
      `aws=${awsKey}`,
      `openai=${openAiKey}`,
      `jwt=${jwt}`,
      "-----BEGIN PRIVATE KEY-----"
    ].join("\n");

    const diagnostics = scanTextForSecrets(content, "release.env");
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "secret.github-token",
      "secret.aws-access-key",
      "secret.openai-api-key",
      "secret.jwt",
      "secret.private-key"
    ]);
    for (const secret of [githubToken, awsKey, openAiKey, jwt]) {
      expect(serialized).not.toContain(secret);
    }
    expect(diagnostics[0]).toMatchObject({
      path: "release.env",
      severity: "error",
      hint: "line 1, column 8; remove the credential and reference a runtime secret instead"
    });
  });

  it("detects assigned credentials and URL credentials", () => {
    const password = "correct horse battery staple";
    const urlPassword = "url-password-123";
    const diagnostics = scanTextForSecrets(
      [
        `password = "${password}"`,
        `DATABASE_URL=postgres://admin:${urlPassword}@localhost/app`
      ].join("\n"),
      ".env"
    );
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "secret.assigned-value",
      "secret.url-credentials"
    ]);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(urlPassword);
  });

  it("ignores deterministic placeholders and runtime references", () => {
    const diagnostics = scanTextForSecrets(
      [
        "API_KEY=${API_KEY}",
        "password=change-me",
        'client_secret="<CLIENT_SECRET>"',
        "auth_token=process.env.AUTH_TOKEN",
        "secret=redacted"
      ].join("\n"),
      ".env.example"
    );

    expect(diagnostics).toEqual([]);
  });

  it("deduplicates an assigned value also recognized as a specific token", () => {
    const token = `gho_${"z".repeat(36)}`;
    const diagnostics = scanTextForSecrets(`access_token="${token}"`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("secret.github-token");
    expect(JSON.stringify(diagnostics)).not.toContain(token);
  });
});

describe("scanFilesForSecrets", () => {
  it("returns deterministic path and source order", () => {
    const firstSecret = "q".repeat(20);
    const secondSecret = "r".repeat(20);
    const diagnostics = scanFilesForSecrets([
      {
        path: "z.env",
        content: `api_key="${firstSecret}"`
      },
      {
        path: "a.env",
        content: `password="${secondSecret}"`
      }
    ]);
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.map(({ path }) => path)).toEqual(["a.env", "z.env"]);
    expect(serialized).not.toContain(firstSecret);
    expect(serialized).not.toContain(secondSecret);
  });
});
