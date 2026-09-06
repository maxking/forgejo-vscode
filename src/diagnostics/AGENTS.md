# Forgejo Workflow Validator Maintenance

These instructions apply to `workflowDiagnostics.ts`, its schemas, and its focused tests. Keep this file current whenever upstream validator research reveals a new compatibility rule or an intentional local divergence.

## Upstream Authority and Version

- Match the validator embedded in the Forgejo runner version used by Forgejo, not the archived `forgejo/act` main branch in isolation.
- The current local pin is `code.forgejo.org/forgejo/runner/v12@v12.12.0`, recorded in `scripts/update-workflow-schema.mjs` and `schemas/README.md`.
- Forgejo runner v12.12.0 validator source: <https://code.forgejo.org/forgejo/runner/src/tag/v12.12.0/act/schema/schema.go>
- Forgejo runner v12.12.0 workflow schema: <https://code.forgejo.org/forgejo/runner/src/tag/v12.12.0/act/schema/workflow_schema.json>
- Forgejo calls this validator through `act/model.ReadWorkflow(..., true)` and `act/jobparser.Parse`.
- `forgejo/act` was archived in July 2025 and transplanted into the runner repository: <https://code.forgejo.org/forgejo/act>. Use it only for history, not as the release-version authority.
- The archived `forgejo/act` main schema declares `concurrency.cancel-in-progress` as `boolean`, while runner v12.12.0 still declares `non-empty-string` and accepts boolean YAML through scalar text. Do not copy isolated schema definitions from archived main or patch generated schema types to hide a TypeScript decoding mismatch.
- Before changing the pin, check the runner module in [Forgejo's current `go.mod`](https://code.forgejo.org/forgejo/forgejo/src/branch/forgejo/go.mod), then inspect the matching runner tag. Update the schema, provenance README, tests, and this file together.

## Semantics That Must Match Runner

The TypeScript validator is a local port of runner's `schema.Node.UnmarshalYAML` traversal. Preserve these non-obvious behaviors:

- Resolve YAML aliases before validation. If a mapping contains a YAML merge key (`<<`), skip validation of that whole mapping because runner does the same.
- Check embedded `${{ ... }}` expressions before schema shape/type checks. A valid expression short-circuits the remaining type check for that node.
- Build expression context cumulatively from the parent and selected definition. Built-in functions are `contains`, `endsWith`, `format`, `join`, `startsWith`, `toJson`, and `fromJson`; functions such as `hashFiles`, `success`, `failure`, `always`, and `cancelled` come from schema contexts rather than the unconditional built-in list.
- When no expression context exists, runner permits only literal/identifier expression roots and rejects function calls, dereferences, and operators. `${{ insert }}` mapping keys are allowed only when the mapping has expression context.
- Probe `one-of` definitions in declared order and accept the first branch with no errors. Do not select branches heuristically from keys such as `run` or `uses`. The VS Code port flattens failed-branch diagnostics instead of reproducing Go's nested `errors.Join` text so users retain actionable ranges; acceptance behavior must still match runner.
- A schema `string` means any YAML scalar. Runner's `checkString` reads `yaml.Node.Value` and does not require the decoded Go value to have a string tag. Numbers, booleans, and null scalars therefore pass string definitions. This is the root cause and fix for GitHub issue #29: `cancel-in-progress: true` and `with.fetch-depth: 0` must validate without patching the vendored schema.
- Runner's `StringDefinition` decoder recognizes `constant` and `is-expression`, but not the schema's `require-non-empty` metadata. Do not enforce `require-non-empty` locally unless upstream begins doing so.
- Number definitions behave like `yaml.Node.Decode(&float64)`, including plain underscored/base-prefixed numbers, infinities, and NaN; quoted numbers are strings and must not pass a number-only definition.
- Boolean definitions behave like typed `yaml.v3` boolean decoding. In addition to plain `true`/`false`, runner accepts YAML 1.1 compatibility strings `y/n`, `yes/no`, and `on/off`, including quoted forms. Quoted `"true"` is a string and must not pass a boolean-only definition.
- Null definitions accept YAML null scalars. Allowed-value definitions compare against textual `yaml.Node.Value`.
- Runner currently records `required` mapping metadata but does not enforce missing properties during schema traversal. Do not add required-property checks without an upstream change.

## Known Approximation

Runner uses `github.com/rhysd/actionlint` for a real expression lexer, parser, and AST walk. The TypeScript port uses bounded local parsing and regex-based function/variable inspection, so expression grammar diagnostics are the largest remaining fidelity gap. Keep this limitation explicit. If expression validation is substantially extended, prefer a maintained Actions expression parser or differential fixtures against runner over adding isolated regexes.

The npm `yaml` parser and Go `yaml.v3` do not expose identical decoded values for every scalar. Helpers such as `scalarText`, `canDecodeRunnerNumber`, and `canDecodeRunnerBoolean` intentionally emulate the Go behavior. Add a focused parity fixture whenever another scalar edge case is found.

## Updating From Upstream

1. Identify the runner version referenced by Forgejo's `go.mod`.
2. Diff that tag's `act/schema/schema.go` against the behavior documented above. Update the TypeScript traversal for semantic changes.
3. Change `defaultRunnerVersion` in `scripts/update-workflow-schema.mjs` and run `node scripts/update-workflow-schema.mjs`. The script makes the copied Go-module-cache file writable and preserves the Open VSX password-property sanitization.
4. Compare schemas semantically (for example with sorted `jq` output) before accepting formatting-only churn.
5. Add or update focused fixtures in `src/__tests__/diagnostics/workflowDiagnostics.test.ts`. Cover both acceptance and rejection, especially scalar tags, `one-of`, aliases/merges, mapping expressions, functions, and contexts.
6. Update `schemas/README.md`, the root README News entry, the root `AGENTS.md` durable guidance, and this research file.
7. Run `npm run lint`, `npm run test:unit`, and `npm run compile`.

Workflow validation must remain local and bounded. Never download schemas, binaries, actions, or repository content during activation or document validation. Do not invoke or download the full `forgejo-runner` binary for editor diagnostics. Its [`validate --workflow --path` command](https://code.forgejo.org/forgejo/runner/src/tag/v12.12.0/internal/app/cmd/validate.go) emits human-oriented output and requires temporary files for unsaved buffers; the [v12.12.0 release](https://code.forgejo.org/forgejo/runner/releases/tag/v12.12.0) publishes only Linux amd64/arm64 executables, not every VS Code host platform.
