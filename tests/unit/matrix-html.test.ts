import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  renderCompatibilityHtml
} from "../../src/reporters/matrix-html.js";

describe("renderCompatibilityHtml", () => {
  it("renders evidence and status counts into a self-contained report", () => {
    const output = renderCompatibilityHtml({
      title: "Release matrix",
      generatedAt: "2026-07-23T00:00:00.000Z",
      cells: [
        {
          pluginId: "hello-mcp",
          environmentId: "linux-node22-mcp",
          status: "compatible-tested",
          checks: [
            {
              constraint: "Node range",
              passed: true,
              evidence: "22.17.0 satisfies >=22"
            }
          ],
          permissionEnforcement: []
        }
      ]
    });

    expect(output).toContain("<strong>1</strong><span>Tested</span>");
    expect(output).toContain("22.17.0 satisfies &gt;=22");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("<script");
  });

  it("escapes plugin-controlled values", () => {
    const dangerous = '<img src=x onerror="alert(1)">';
    const output = renderCompatibilityHtml({
      title: dangerous,
      generatedAt: dangerous,
      cells: [
        {
          pluginId: dangerous,
          environmentId: dangerous,
          status: "invalid",
          checks: [],
          permissionEnforcement: []
        }
      ]
    });

    expect(output).not.toContain(dangerous);
    expect(output).toContain(escapeHtml(dangerous));
  });

  it("renders failed checks, permission enforcement, and every status", () => {
    const statuses = [
      "compatible-unverified",
      "incompatible",
      "invalid"
    ] as const;
    const output = renderCompatibilityHtml({
      title: "Policy matrix",
      generatedAt: "2026-07-23T00:00:00.000Z",
      cells: statuses.map((status, index) => ({
        pluginId: `plugin-${String(index)}`,
        environmentId: `environment-${String(index)}`,
        status,
        checks: [
          {
            constraint: "runtime probe",
            passed: false,
            evidence: "probe failed"
          }
        ],
        permissionEnforcement: [
          {
            permissionId: "network",
            enforcement: "runtime"
          }
        ]
      }))
    });

    expect(output).toContain('class="fail"');
    expect(output).toContain("network · runtime");
    expect(output).toContain("<strong>1</strong><span>Unverified</span>");
    expect(output).toContain("<strong>1</strong><span>Incompatible</span>");
    expect(output).toContain("<strong>1</strong><span>Invalid</span>");
  });
});
