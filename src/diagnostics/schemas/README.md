# Workflow Schema Source

`forgejo-workflow.schema.json` is vendored from Forgejo runner:

- Module: `code.forgejo.org/forgejo/runner/v12`
- Version: `v12.12.0`
- Source path: `act/schema/workflow_schema.json`

Forgejo itself references this runner module from `forgejo.org/forgejo` and reads workflow
files through `act/model.ReadWorkflow` and `act/jobparser.Parse`.
