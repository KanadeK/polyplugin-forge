import { diagnostic } from "./diagnostics.js";

import type { Diagnostic } from "./model.js";

export interface SecretScanSource {
  readonly path: string;
  readonly content: string;
}

interface SecretDetector {
  readonly code: string;
  readonly label: string;
  readonly pattern: RegExp;
  readonly priority: number;
  readonly candidate?: (match: RegExpExecArray) => string;
  readonly ignorePlaceholders?: boolean;
}

interface SecretFinding {
  readonly detector: SecretDetector;
  readonly start: number;
  readonly end: number;
}

const DETECTORS: readonly SecretDetector[] = [
  {
    code: "secret.private-key",
    label: "private-key material",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gu,
    priority: 100
  },
  {
    code: "secret.github-token",
    label: "GitHub access token",
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
    priority: 95
  },
  {
    code: "secret.aws-access-key",
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
    priority: 95
  },
  {
    code: "secret.openai-api-key",
    label: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
    priority: 95
  },
  {
    code: "secret.slack-token",
    label: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
    priority: 95
  },
  {
    code: "secret.jwt",
    label: "JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
    priority: 90
  },
  {
    code: "secret.url-credentials",
    label: "URL-embedded credentials",
    pattern:
      /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@[^\s/]+(?:\/[^\s]*)?/giu,
    priority: 85
  },
  {
    code: "secret.assigned-value",
    label: "assigned credential value",
    pattern:
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s#;,]+))/giu,
    priority: 10,
    candidate: (match) => match[2] ?? match[3] ?? match[4] ?? "",
    ignorePlaceholders: true
  }
];

const PLACEHOLDER_VALUE =
  /^(?:<[^>]+>|\$\{[^}]+\}|(?:process\.)?env(?:ironment)?[.[].*|(?:your|replace|insert)[-_ ]?(?:api[-_ ]?key|token|password|secret)(?:[-_ ]?here)?|example|sample|dummy|fake|placeholder|change[-_ ]?me|redacted|not[-_ ]?a[-_ ]?secret|null|undefined)$/iu;

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length < 8 || PLACEHOLDER_VALUE.test(trimmed);
}

function overlaps(left: SecretFinding, right: SecretFinding): boolean {
  return left.start < right.end && right.start < left.end;
}

function compareByLocation(left: SecretFinding, right: SecretFinding): number {
  return (
    left.start - right.start ||
    left.detector.code.localeCompare(right.detector.code)
  );
}

function mergeByLocation(
  left: readonly SecretFinding[],
  right: readonly SecretFinding[]
): readonly SecretFinding[] {
  const merged: SecretFinding[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length || rightIndex < right.length) {
    const leftFinding = left[leftIndex];
    const rightFinding = right[rightIndex];
    if (leftFinding === undefined) {
      if (rightFinding === undefined) {
        break;
      }
      merged.push(rightFinding);
      rightIndex += 1;
    } else if (
      rightFinding === undefined ||
      compareByLocation(leftFinding, rightFinding) <= 0
    ) {
      merged.push(leftFinding);
      leftIndex += 1;
    } else {
      merged.push(rightFinding);
      rightIndex += 1;
    }
  }

  return merged;
}

function selectNonOverlappingFindings(
  candidates: readonly SecretFinding[]
): readonly SecretFinding[] {
  const prioritized = [...candidates].sort(
    (left, right) =>
      right.detector.priority - left.detector.priority ||
      compareByLocation(left, right)
  );
  let accepted: readonly SecretFinding[] = [];
  let candidateIndex = 0;

  // Equal-priority candidates arrive in source order. Accepted intervals are
  // kept sorted and non-overlapping, so each priority group needs only one
  // forward pass before a linear merge with higher-priority findings.
  while (candidateIndex < prioritized.length) {
    const priority = prioritized[candidateIndex]?.detector.priority;
    const acceptedAtPriority: SecretFinding[] = [];
    let acceptedIndex = 0;

    while (
      candidateIndex < prioritized.length &&
      prioritized[candidateIndex]?.detector.priority === priority
    ) {
      const candidate = prioritized[candidateIndex];
      candidateIndex += 1;
      if (candidate === undefined) {
        continue;
      }

      while (
        acceptedIndex < accepted.length &&
        (accepted[acceptedIndex]?.end ?? 0) <= candidate.start
      ) {
        acceptedIndex += 1;
      }

      const higherPriorityFinding = accepted[acceptedIndex];
      const previousAtPriority = acceptedAtPriority.at(-1);
      if (
        (higherPriorityFinding !== undefined &&
          overlaps(higherPriorityFinding, candidate)) ||
        (previousAtPriority !== undefined &&
          overlaps(previousAtPriority, candidate))
      ) {
        continue;
      }

      acceptedAtPriority.push(candidate);
    }

    accepted = mergeByLocation(accepted, acceptedAtPriority);
  }

  return accepted;
}

function collectFindings(content: string): readonly SecretFinding[] {
  const candidates: SecretFinding[] = [];

  for (const detector of DETECTORS) {
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    let match = pattern.exec(content);
    while (match !== null) {
      const candidate = detector.candidate?.(match) ?? match[0];
      if (!detector.ignorePlaceholders || !isPlaceholder(candidate)) {
        candidates.push({
          detector,
          start: match.index,
          end: match.index + match[0].length
        });
      }

      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
      match = pattern.exec(content);
    }
  }

  return selectNonOverlappingFindings(candidates);
}

export function scanTextForSecrets(
  content: string,
  path = "<memory>"
): readonly Diagnostic[] {
  const findings = collectFindings(content);
  let offset = 0;
  let line = 1;
  let column = 1;

  return findings.map((finding) => {
    while (offset < finding.start) {
      if (content[offset] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      offset += 1;
    }

    return diagnostic(
      finding.detector.code,
      `Potential ${finding.detector.label} detected.`,
      "error",
      path,
      `line ${String(line)}, column ${String(
        column
      )}; remove the credential and reference a runtime secret instead`
    );
  });
}

export function scanFilesForSecrets(
  sources: readonly SecretScanSource[]
): readonly Diagnostic[] {
  return [...sources]
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap(({ path, content }) => scanTextForSecrets(content, path));
}
