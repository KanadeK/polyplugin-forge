import { describe, expect, it } from "vitest";

import { planUpgrade } from "../../src/core/upgrade-planner.js";

describe("planUpgrade", () => {
  it("plans deterministic safe additions, replacements, and deletions", () => {
    const plan = planUpgrade(
      {
        "delete.txt": "old delete",
        "replace.txt": "old replace",
        "unchanged.txt": "same"
      },
      {
        "delete.txt": "old delete",
        "replace.txt": "old replace",
        "unchanged.txt": "same"
      },
      {
        "add.txt": "new file",
        "replace.txt": "new replace",
        "unchanged.txt": "same"
      }
    );

    expect(plan.canApplyAtomically).toBe(true);
    expect(plan.conflicts).toEqual([]);
    expect(plan.operations).toEqual([
      { kind: "add", path: "add.txt", content: "new file" },
      {
        kind: "delete",
        path: "delete.txt",
        expectedCurrent: "old delete"
      },
      {
        kind: "replace",
        path: "replace.txt",
        expectedCurrent: "old replace",
        content: "new replace"
      }
    ]);
    expect(plan.preserved).toContainEqual({
      path: "unchanged.txt",
      reason: "unchanged",
      current: { state: "present", content: "same" }
    });
  });

  it("preserves user-only additions, modifications, and deletions", () => {
    const plan = planUpgrade(
      {
        "deleted.txt": "base",
        "modified.txt": "base"
      },
      {
        "custom.txt": "user file",
        "modified.txt": "user edit"
      },
      {
        "deleted.txt": "base",
        "modified.txt": "base"
      }
    );

    expect(plan.canApplyAtomically).toBe(true);
    expect(plan.operations).toEqual([]);
    expect(plan.preserved).toEqual([
      {
        path: "custom.txt",
        reason: "user-added",
        current: { state: "present", content: "user file" }
      },
      {
        path: "deleted.txt",
        reason: "user-deleted",
        current: { state: "absent" }
      },
      {
        path: "modified.txt",
        reason: "user-modified",
        current: { state: "present", content: "user edit" }
      }
    ]);
  });

  it("recognizes user and template convergence without replacing", () => {
    const plan = planUpgrade(
      { "same-result.txt": "base" },
      { "new-template-file.txt": "next", "same-result.txt": "next" },
      { "new-template-file.txt": "next", "same-result.txt": "next" }
    );

    expect(plan.operations).toEqual([]);
    expect(
      plan.preserved.map(({ path, reason }) => ({ path, reason }))
    ).toEqual([
      { path: "new-template-file.txt", reason: "already-current" },
      { path: "same-result.txt", reason: "already-current" }
    ]);
  });

  it("preserves current content and emits all three materials on edit conflicts", () => {
    const plan = planUpgrade(
      { "plugin.ts": "base" },
      { "plugin.ts": "user edit" },
      { "plugin.ts": "template edit" }
    );

    expect(plan.canApplyAtomically).toBe(false);
    expect(plan.operations).toEqual([]);
    expect(plan.conflicts).toEqual([
      {
        path: "plugin.ts",
        reason: "both-modified",
        materialPlan: {
          preserve: "current",
          baseline: { state: "present", content: "base" },
          current: { state: "present", content: "user edit" },
          next: { state: "present", content: "template edit" }
        }
      }
    ]);
    expect(plan.preserved).toEqual([
      {
        path: "plugin.ts",
        reason: "conflict-preserve-current",
        current: { state: "present", content: "user edit" }
      }
    ]);
  });

  it("blocks a template addition that collides with a user-created file", () => {
    const plan = planUpgrade(
      {},
      { "new.ts": "user version" },
      { "new.ts": "template version" }
    );

    expect(plan.canApplyAtomically).toBe(false);
    expect(plan.conflicts[0]).toMatchObject({
      path: "new.ts",
      reason: "template-added-over-user-file",
      materialPlan: {
        preserve: "current",
        baseline: { state: "absent" },
        current: { state: "present", content: "user version" },
        next: { state: "present", content: "template version" }
      }
    });
  });

  it("blocks deleting a user-modified file and preserves its content", () => {
    const plan = planUpgrade(
      { "remove.ts": "base" },
      { "remove.ts": "user edit" },
      {}
    );

    expect(plan.canApplyAtomically).toBe(false);
    expect(plan.operations).toEqual([]);
    expect(plan.conflicts[0]).toMatchObject({
      reason: "template-deleted-user-modified",
      materialPlan: {
        preserve: "current",
        current: { state: "present", content: "user edit" },
        next: { state: "absent" }
      }
    });
  });

  it("blocks restoring a user-deleted file when the template also modified it", () => {
    const plan = planUpgrade(
      { "deleted.ts": "base" },
      {},
      { "deleted.ts": "template edit" }
    );

    expect(plan.canApplyAtomically).toBe(false);
    expect(plan.conflicts[0]).toEqual({
      path: "deleted.ts",
      reason: "template-modified-user-deleted",
      materialPlan: {
        preserve: "current",
        baseline: { state: "present", content: "base" },
        current: { state: "absent" },
        next: { state: "present", content: "template edit" }
      }
    });
    expect(plan.preserved[0]?.current).toEqual({ state: "absent" });
  });

  it("rejects unsafe managed paths before producing a plan", () => {
    expect(() => planUpgrade({ "../outside.txt": "base" }, {}, {})).toThrow(
      "baseline contains an unsafe managed path"
    );
    expect(() => planUpgrade({}, { "C:\\outside.txt": "user" }, {})).toThrow(
      "current contains an unsafe managed path"
    );
    expect(() => planUpgrade({}, {}, { "/absolute.txt": "next" })).toThrow(
      "next contains an unsafe managed path"
    );
  });
});
