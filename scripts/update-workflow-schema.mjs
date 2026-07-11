#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRunnerVersion = 'v12.11.1';
const runnerVersion = process.env.FORGEJO_RUNNER_VERSION ?? process.argv[2] ?? defaultRunnerVersion;
const runnerModule = `code.forgejo.org/forgejo/runner/v12@${runnerVersion}`;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const schemaDir = path.join(repoRoot, 'src', 'diagnostics', 'schemas');
const schemaPath = path.join(schemaDir, 'forgejo-workflow.schema.json');
const readmePath = path.join(schemaDir, 'README.md');

function sanitizePasswordPropertyMappings(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      sanitizePasswordPropertyMappings(item);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (value.mapping?.properties?.password === 'non-empty-string') {
    value.mapping.properties.password = { type: 'non-empty-string' };
  }

  for (const item of Object.values(value)) {
    sanitizePasswordPropertyMappings(item);
  }
}

// Upstream forgejo/act's vendored schema is stricter than the runner actually
// enforces: `concurrency.cancel-in-progress` only accepts strings, and step
// `with` values only accept strings (rejecting bare YAML numbers/booleans
// like `fetch-depth: 0`). Relax both so the bundled validator doesn't flag
// workflows the runner accepts. See src/diagnostics/schemas forgejo-workflow
// tests for regression coverage.
function relaxWorkflowValidatorTypes(schema) {
  const definitions = schema.definitions;
  if (!definitions) {
    return;
  }

  const cancelInProgress = definitions['concurrency-mapping']?.mapping?.properties?.['cancel-in-progress'];
  if (cancelInProgress?.type === 'non-empty-string') {
    cancelInProgress.type = 'concurrency-cancel-in-progress';
    definitions['concurrency-cancel-in-progress'] = {
      description: cancelInProgress.description,
      'one-of': ['boolean', 'non-empty-string'],
    };
  }

  const stepWithMapping = definitions['step-with']?.mapping;
  if (stepWithMapping?.['loose-value-type'] === 'string') {
    stepWithMapping['loose-value-type'] = 'step-with-value';
    definitions['step-with-value'] = {
      description: 'An input value. The runner coerces scalars to strings, so plain numbers and booleans (for example `fetch-depth: 0`) are valid alongside strings.',
      'one-of': ['string', 'boolean', 'number'],
    };
  }
}

let downloadOutput;
try {
  downloadOutput = execFileSync('go', ['mod', 'download', '-json', runnerModule], {
    encoding: 'utf8',
  });
} catch (error) {
  downloadOutput = error.stdout?.toString() ?? '';
  if (!downloadOutput) {
    throw error;
  }
}
const downloadInfo = JSON.parse(downloadOutput);
if (downloadInfo.Error) {
  throw new Error(downloadInfo.Error);
}

copyFileSync(path.join(downloadInfo.Dir, 'act', 'schema', 'workflow_schema.json'), schemaPath);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
sanitizePasswordPropertyMappings(schema);
relaxWorkflowValidatorTypes(schema);
writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
writeFileSync(readmePath, `# Workflow Schema Source

\`forgejo-workflow.schema.json\` is vendored from Forgejo runner:

- Module: \`code.forgejo.org/forgejo/runner/v12\`
- Version: \`${runnerVersion}\`
- Source path: \`act/schema/workflow_schema.json\`

Forgejo itself references this runner module from \`forgejo.org/forgejo\` and reads workflow
files through \`act/model.ReadWorkflow\` and \`act/jobparser.Parse\`.
`);

console.log(`Updated workflow schema from ${runnerModule}`);
