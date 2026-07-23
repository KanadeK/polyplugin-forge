import type { CompatibilityCell, CompatibilityStatus } from "../core/model.js";

export interface MatrixHtmlInput {
  readonly title: string;
  readonly generatedAt: string;
  readonly cells: readonly CompatibilityCell[];
}

const STATUS_LABELS: Readonly<Record<CompatibilityStatus, string>> = {
  "compatible-tested": "Tested",
  "compatible-unverified": "Unverified",
  incompatible: "Incompatible",
  invalid: "Invalid"
};

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character] ?? character
  );
}

function countByStatus(
  cells: readonly CompatibilityCell[]
): Readonly<Record<CompatibilityStatus, number>> {
  const counts: Record<CompatibilityStatus, number> = {
    "compatible-tested": 0,
    "compatible-unverified": 0,
    incompatible: 0,
    invalid: 0
  };
  for (const cell of cells) {
    counts[cell.status] += 1;
  }
  return counts;
}

function renderChecks(cell: CompatibilityCell): string {
  return cell.checks
    .map(
      (check) =>
        `<li class="${check.passed ? "pass" : "fail"}"><strong>${escapeHtml(check.constraint)}</strong><span>${escapeHtml(check.evidence)}</span></li>`
    )
    .join("");
}

function renderEnforcement(cell: CompatibilityCell): string {
  if (cell.permissionEnforcement.length === 0) {
    return '<span class="muted">No permissions</span>';
  }
  return cell.permissionEnforcement
    .map(
      ({ permissionId, enforcement }) =>
        `<span class="enforcement">${escapeHtml(permissionId)} · ${escapeHtml(enforcement)}</span>`
    )
    .join("");
}

export function renderCompatibilityHtml(input: MatrixHtmlInput): string {
  const counts = countByStatus(input.cells);
  const rows = input.cells
    .map(
      (cell) => `<tr>
        <th scope="row">${escapeHtml(cell.pluginId)}</th>
        <td>${escapeHtml(cell.environmentId)}</td>
        <td><span class="status ${cell.status}">${STATUS_LABELS[cell.status]}</span></td>
        <td><ul class="checks">${renderChecks(cell)}</ul></td>
        <td class="enforcements">${renderEnforcement(cell)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0a0d12; color: #edf3f8; }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(circle at 12% -10%, #173342 0, transparent 35rem), #0a0d12; }
    main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 4rem 0; }
    header { display: grid; gap: .75rem; margin-bottom: 2rem; }
    .eyebrow { color: #6ce5c2; font: 700 .76rem/1.2 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 0; max-width: 18ch; font-size: clamp(2.2rem, 7vw, 5.7rem); line-height: .95; letter-spacing: -.055em; }
    .lede { max-width: 66ch; color: #aebbc6; font-size: 1rem; line-height: 1.65; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .7rem; margin: 2rem 0; }
    .metric { border: 1px solid #29343d; background: #10161d; border-radius: .75rem; padding: 1rem; }
    .metric strong { display: block; font-size: 1.8rem; }
    .metric span { color: #8fa0ad; font-size: .78rem; text-transform: uppercase; letter-spacing: .07em; }
    .table-wrap { overflow-x: auto; border: 1px solid #29343d; border-radius: .9rem; background: #0d1218; }
    table { width: 100%; min-width: 920px; border-collapse: collapse; }
    th, td { padding: 1rem; border-bottom: 1px solid #222c34; text-align: left; vertical-align: top; }
    thead th { color: #8fa0ad; font: 700 .72rem/1.2 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; background: #111820; }
    tbody th { font-size: .93rem; }
    tbody tr:last-child > * { border-bottom: 0; }
    .status { display: inline-flex; border-radius: 999px; padding: .28rem .58rem; font: 700 .7rem/1 ui-monospace, monospace; }
    .compatible-tested { color: #072118; background: #6ce5c2; }
    .compatible-unverified { color: #211a03; background: #e8cb65; }
    .incompatible, .invalid { color: #2a0909; background: #ff8b88; }
    .checks { display: grid; gap: .55rem; margin: 0; padding: 0; list-style: none; }
    .checks li { display: grid; grid-template-columns: .5rem minmax(8rem, .55fr) 1fr; gap: .5rem; align-items: start; color: #aebbc6; font-size: .78rem; }
    .checks li::before { content: ""; width: .42rem; height: .42rem; margin-top: .28rem; border-radius: 50%; background: #6ce5c2; }
    .checks li.fail::before { background: #ff8b88; }
    .checks strong { color: #dbe5ed; font-weight: 650; }
    .enforcements { display: grid; gap: .4rem; }
    .enforcement { width: fit-content; border: 1px solid #30404b; border-radius: .4rem; padding: .28rem .4rem; color: #b8c6d0; font: .7rem/1 ui-monospace, monospace; }
    .muted, footer { color: #758692; }
    footer { margin-top: 1rem; font: .75rem/1.5 ui-monospace, monospace; }
    @media (max-width: 720px) { main { padding-top: 2.5rem; } .summary { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">PolyPlugin Forge · compatibility evidence</div>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="lede">A declaration is not a test. Each cell exposes the constraints and evidence behind its status, including how permissions are enforced.</p>
    </header>
    <section class="summary" aria-label="Compatibility summary">
      <div class="metric"><strong>${String(counts["compatible-tested"])}</strong><span>Tested</span></div>
      <div class="metric"><strong>${String(counts["compatible-unverified"])}</strong><span>Unverified</span></div>
      <div class="metric"><strong>${String(counts.incompatible)}</strong><span>Incompatible</span></div>
      <div class="metric"><strong>${String(counts.invalid)}</strong><span>Invalid</span></div>
    </section>
    <div class="table-wrap">
      <table>
        <caption class="muted">Plugin compatibility by deterministic environment fixture</caption>
        <thead><tr><th scope="col">Plugin</th><th scope="col">Environment</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Permission enforcement</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <footer>Generated ${escapeHtml(input.generatedAt)} · self-contained HTML · no remote assets</footer>
  </main>
</body>
</html>
`;
}
