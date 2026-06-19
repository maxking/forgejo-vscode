#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
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
writeFileSync(readmePath, `# Workflow Schema Source

\`forgejo-workflow.schema.json\` is vendored from Forgejo runner:

- Module: \`code.forgejo.org/forgejo/runner/v12\`
- Version: \`${runnerVersion}\`
- Source path: \`act/schema/workflow_schema.json\`

Forgejo itself references this runner module from \`forgejo.org/forgejo\` and reads workflow
files through \`act/model.ReadWorkflow\` and \`act/jobparser.Parse\`.
`);

console.log(`Updated workflow schema from ${runnerModule}`);
