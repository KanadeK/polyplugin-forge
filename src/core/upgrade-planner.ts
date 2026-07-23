export type FileSnapshot = Readonly<Record<string, string>>;

export type UpgradeOperation =
  | {
      readonly kind: "add";
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly kind: "replace";
      readonly path: string;
      readonly expectedCurrent: string;
      readonly content: string;
    }
  | {
      readonly kind: "delete";
      readonly path: string;
      readonly expectedCurrent: string;
    };

export type PreserveReason =
  | "unchanged"
  | "already-current"
  | "user-added"
  | "user-modified"
  | "user-deleted"
  | "already-removed"
  | "conflict-preserve-current";

export interface PreservedPath {
  readonly path: string;
  readonly reason: PreserveReason;
  readonly current: FileMaterial;
}

export type UpgradeConflictReason =
  | "template-added-over-user-file"
  | "both-modified"
  | "template-deleted-user-modified"
  | "template-modified-user-deleted";

export type FileMaterial =
  | {
      readonly state: "present";
      readonly content: string;
    }
  | {
      readonly state: "absent";
    };

export interface ConflictMaterialPlan {
  readonly preserve: "current";
  readonly baseline: FileMaterial;
  readonly current: FileMaterial;
  readonly next: FileMaterial;
}

export interface UpgradeConflict {
  readonly path: string;
  readonly reason: UpgradeConflictReason;
  readonly materialPlan: ConflictMaterialPlan;
}

export interface UpgradePlan {
  readonly canApplyAtomically: boolean;
  readonly operations: readonly UpgradeOperation[];
  readonly preserved: readonly PreservedPath[];
  readonly conflicts: readonly UpgradeConflict[];
}

interface FileState {
  readonly exists: boolean;
  readonly content: string;
}

const SAFE_PATH_SEGMENT = /^[^./\\][^/\\]*$|^\.[^./\\][^/\\]*$/u;

function validateSnapshot(name: string, snapshot: FileSnapshot): void {
  for (const [path, content] of Object.entries(snapshot)) {
    if (
      path.length === 0 ||
      path.includes("\0") ||
      path.includes("\\") ||
      path.startsWith("/") ||
      /^[A-Za-z]:/u.test(path) ||
      path
        .split("/")
        .some(
          (segment) =>
            segment.length === 0 ||
            segment === "." ||
            segment === ".." ||
            !SAFE_PATH_SEGMENT.test(segment)
        )
    ) {
      throw new TypeError(`${name} contains an unsafe managed path`);
    }
    if (typeof content !== "string") {
      throw new TypeError(`${name} contains non-text file content`);
    }
  }
}

function state(snapshot: FileSnapshot, path: string): FileState {
  if (!Object.hasOwn(snapshot, path)) {
    return { exists: false, content: "" };
  }
  return { exists: true, content: snapshot[path] ?? "" };
}

function material(fileState: FileState): FileMaterial {
  return fileState.exists
    ? { state: "present", content: fileState.content }
    : { state: "absent" };
}

function same(left: FileState, right: FileState): boolean {
  return (
    left.exists === right.exists &&
    (!left.exists || left.content === right.content)
  );
}

export function planUpgrade(
  baseline: FileSnapshot,
  current: FileSnapshot,
  next: FileSnapshot
): UpgradePlan {
  validateSnapshot("baseline", baseline);
  validateSnapshot("current", current);
  validateSnapshot("next", next);

  const paths = [
    ...new Set([
      ...Object.keys(baseline),
      ...Object.keys(current),
      ...Object.keys(next)
    ])
  ].sort((left, right) => left.localeCompare(right));
  const operations: UpgradeOperation[] = [];
  const preserved: PreservedPath[] = [];
  const conflicts: UpgradeConflict[] = [];

  const preserve = (
    path: string,
    reason: PreserveReason,
    currentState: FileState
  ): void => {
    preserved.push({
      path,
      reason,
      current: material(currentState)
    });
  };

  const conflict = (
    path: string,
    reason: UpgradeConflictReason,
    baselineState: FileState,
    currentState: FileState,
    nextState: FileState
  ): void => {
    conflicts.push({
      path,
      reason,
      materialPlan: {
        preserve: "current",
        baseline: material(baselineState),
        current: material(currentState),
        next: material(nextState)
      }
    });
    preserve(path, "conflict-preserve-current", currentState);
  };

  for (const path of paths) {
    const baselineState = state(baseline, path);
    const currentState = state(current, path);
    const nextState = state(next, path);

    if (!baselineState.exists) {
      if (!currentState.exists && nextState.exists) {
        operations.push({
          kind: "add",
          path,
          content: nextState.content
        });
      } else if (currentState.exists && !nextState.exists) {
        preserve(path, "user-added", currentState);
      } else if (currentState.exists && nextState.exists) {
        if (same(currentState, nextState)) {
          preserve(path, "already-current", currentState);
        } else {
          conflict(
            path,
            "template-added-over-user-file",
            baselineState,
            currentState,
            nextState
          );
        }
      }
      continue;
    }

    if (currentState.exists && nextState.exists) {
      if (same(currentState, nextState)) {
        preserve(
          path,
          same(currentState, baselineState) ? "unchanged" : "already-current",
          currentState
        );
      } else if (same(currentState, baselineState)) {
        operations.push({
          kind: "replace",
          path,
          expectedCurrent: currentState.content,
          content: nextState.content
        });
      } else if (same(nextState, baselineState)) {
        preserve(path, "user-modified", currentState);
      } else {
        conflict(path, "both-modified", baselineState, currentState, nextState);
      }
      continue;
    }

    if (currentState.exists && !nextState.exists) {
      if (same(currentState, baselineState)) {
        operations.push({
          kind: "delete",
          path,
          expectedCurrent: currentState.content
        });
      } else {
        conflict(
          path,
          "template-deleted-user-modified",
          baselineState,
          currentState,
          nextState
        );
      }
      continue;
    }

    if (!currentState.exists && nextState.exists) {
      if (same(nextState, baselineState)) {
        preserve(path, "user-deleted", currentState);
      } else {
        conflict(
          path,
          "template-modified-user-deleted",
          baselineState,
          currentState,
          nextState
        );
      }
      continue;
    }

    preserve(path, "already-removed", currentState);
  }

  return {
    canApplyAtomically: conflicts.length === 0,
    operations,
    preserved,
    conflicts
  };
}
