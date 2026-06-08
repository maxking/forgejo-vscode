Set up and launch the manual nested-repository detection test for Forgejo VS Code.

Steps:
1. Run `npm run compile` from the repository root.
2. Package the extension with `npm run package`.
3. Install the generated `.vsix` into Cursor with `cursor --install-extension <vsix> --force`.
4. Run `scripts/setup-manual-nested-repo-test.sh /tmp/forgejo-vscode-nested-manual --launch-cursor`.
5. Report the workspace path and remind the user to verify the Forgejo sidebar groups Pull Requests, Issues, Actions, and Releases by repository name.
6. Remind the user to open each nested `README.md`, run `Forgejo: Show Diagnostics`, and verify:
   - `repo-a/README.md` → `maxking/forgejo-vscode`
   - `repo-b/README.md` → `forgejo/forgejo`
   - `packages/repo-c/README.md` → `forgejo-contrib/forgejo-cli`
7. If `$ARGUMENTS` is present, use it as the workspace path instead of `/tmp/forgejo-vscode-nested-manual`.
