import * as vscode from 'vscode';
import packageJson from '../../../package.json';
import { isWorkflowFilePath, validateWorkflowText } from '../../diagnostics/workflowDiagnostics';
import workflowSchema from '../../diagnostics/schemas/forgejo-workflow.schema.json';

describe('workflowDiagnostics', () => {
  const workflowPath = '/workspace/.forgejo/workflows/test.yml';

  test('recognizes Forgejo and compatible workflow locations', () => {
    expect(isWorkflowFilePath('/repo/.forgejo/workflows/ci.yml')).toBe(true);
    expect(isWorkflowFilePath('/repo/.gitea/workflows/ci.yaml')).toBe(true);
    expect(isWorkflowFilePath('/repo/.github/workflows/ci.yml')).toBe(true);
    expect(isWorkflowFilePath('/repo/docs/ci.yml')).toBe(false);
  });

  test('uses the vendored Forgejo runner workflow schema', () => {
    expect(workflowSchema.version).toBe('workflow-v1.0');
    expect(workflowSchema.definitions['workflow-root']).toBeDefined();
    expect(workflowSchema.definitions['workflow-root'].mapping.properties['enable-openid-connect']).toBe('workflow-enable-openid-connect');
    expect(workflowSchema.definitions['container-registry-credentials'].mapping.properties.password).toEqual({ type: 'non-empty-string' });
    expect(workflowSchema.definitions['service-container-registry-credentials'].mapping.properties.password).toEqual({ type: 'non-empty-string' });
  });

  test('contributes the Forgejo schema to YAML language tooling', () => {
    expect(packageJson.contributes.yamlValidation).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileMatch: [
          '.forgejo/workflows/*.{yml,yaml}',
          '.gitea/workflows/*.{yml,yaml}',
        ],
        url: './out/diagnostics/schemas/forgejo-workflow.schema.json',
      }),
    ]));
  });

  test('accepts a basic workflow with one job', () => {
    const issues = validateWorkflowText([
      'name: Test',
      'on:',
      '  pull_request:',
      'jobs:',
      '  test:',
      '    runs-on: docker',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - run: npm test',
    ].join('\n'), workflowPath);

    expect(issues).toEqual([]);
  });

  test('accepts Forgejo-specific runner workflow fields', () => {
    const issues = validateWorkflowText([
      'name: Test',
      'enable-email-notifications: true',
      'enable-openid-connect: true',
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: docker',
      '    steps:',
      '      - run: npm test',
    ].join('\n'), workflowPath);

    expect(issues).toEqual([]);
  });

  test('does not enforce runner schema required metadata that Forgejo does not check', () => {
    const issues = validateWorkflowText('name: Missing pieces\n', workflowPath);

    expect(issues).toEqual([]);
  });

  test('reports local YAML syntax problems without network access', () => {
    const issues = validateWorkflowText([
      'name: [Broken',
      'on: push',
      'jobs:',
      '\ttest:',
      '    steps:',
    ].join('\n'), workflowPath);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(issue => issue.severity === vscode.DiagnosticSeverity.Error)).toBe(true);
  });

  test('does not report incomplete jobs when the runner schema checker accepts the present fields', () => {
    const issues = validateWorkflowText([
      'on: push',
      'jobs:',
      '  test:',
      '    name: Test',
    ].join('\n'), workflowPath);

    expect(issues).toEqual([]);
  });

  test('does not report incomplete steps when the runner schema checker accepts the present fields', () => {
    const issues = validateWorkflowText([
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: docker',
      '    steps:',
      '      - name: Missing command',
    ].join('\n'), workflowPath);

    expect(issues).toEqual([]);
  });

  test('reports unknown expression contexts from the bundled schema', () => {
    const issues = validateWorkflowText([
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: docker',
      '    if: bogus.KEY',
      '    steps:',
      '      - run: npm test',
    ].join('\n'), workflowPath);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Unknown Variable Access bogus',
        severity: vscode.DiagnosticSeverity.Error,
      }),
    ]));
  });

  test('reports expression function arity from the bundled schema', () => {
    const issues = validateWorkflowText([
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: docker',
      '    if: always("unexpected")',
      '    steps:',
      '      - run: npm test',
    ].join('\n'), workflowPath);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Too many parameters for always expected <= 0 got 1',
      }),
    ]));
  });

  test('accepts aliases like the runner schema checker', () => {
    const issues = validateWorkflowText([
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: &runner docker',
      '    steps:',
      '      - run: npm test',
      '  lint:',
      '    runs-on: *runner',
      '    steps:',
      '      - run: npm run lint',
    ].join('\n'), workflowPath);

    expect(issues).toEqual([]);
  });

  test('skips mappings with YAML merge keys like the runner schema checker', () => {
    const issues = validateWorkflowText([
      'on: push',
      'jobs:',
      '  test:',
      '    <<: &job_base',
      '      unknown-job-property: true',
      '    steps:',
      '      - run: npm test',
    ].join('\n'), workflowPath);

    expect(issues).toEqual([]);
  });

  test('rejects unknown top-level properties through the bundled schema', () => {
    const issues = validateWorkflowText([
      'name: Test',
      'triggers: push',
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: docker',
      '    steps:',
      '      - run: npm test',
    ].join('\n'), workflowPath);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Unknown workflow property "triggers".',
      }),
    ]));
  });
});
