# Feature: Project Detection

## Goal

Detect Policy Studio projects in the opened workspace — at the workspace root **and** at nested paths in monorepos. Provide low-level marker checks used by the multi-project registry (`000-multi-project-monorepo.md`).

## User Story

As a developer, I want the extension to recognize Policy Studio projects automatically wherever they live in the repo, so that relevant tools activate and target the correct project roots.

## Inputs

- Workspace folder(s)
- Policy Studio project markers at a **candidate directory** (not only the workspace root):
  - **XML project:** `PrimaryStore.xml`
  - **YAML project:** `values.yaml` together with a `Policies`, `APIs`, or `META-INF` directory
- Discovery settings from `000-multi-project-monorepo.md` (`scanDepth`, `includePaths`, `excludePaths`)

## Outputs

- Boolean: whether **any** Policy Studio project exists in the workspace (`policyStudio.projectDetected`)
- `PolicyStudioProject[]` registered via the project registry (see `000-multi-project-monorepo.md`)
- Status bar item:
  - Single project: `Policy Studio: <name>`
  - Multiple projects: `Policy Studio: N projects` (click opens scope picker)

## Behaviour

- Expose primitive `isPolicyStudioProject(directoryPath): boolean` (marker check only).
- On workspace open, run nested discovery per `000-multi-project-monorepo.md` and populate the project registry.
- If at least one project is found, set `policyStudio.projectDetected` and show the status bar item.
- If none are found, keep Policy Studio commands hidden or inactive.
- Re-run discovery when workspace folders change or when marker files are created/deleted (debounced).

## Edge Cases

- Workspace root is a normal folder but nested projects exist → still activate.
- Workspace root itself is a Policy Studio project **and** nested projects exist → register both unless nested path is inside the root project tree.
- `values.yaml` present without companion directories → not a YAML project (negative case).
- Normal folder with no markers anywhere → no activation.

## Acceptance Criteria

- [x] Detects sample project in `test/fixtures/sample-policy-project`
- [x] Detects YAML sample project in `test/fixtures/sample-yaml-policy-project`
- [x] Does not activate features in normal folders
- [x] Status bar item appears only when at least one project is detected
- [x] Unit test covers positive and negative marker detection
- [ ] Discovers two nested projects in `test/fixtures/monorepo/two-projects`
- [ ] Does not treat excluded paths (e.g. `node_modules`) as projects
- [ ] `isPolicyStudioProject` remains usable independently of registry scan

## Future Ideas

- Detect project flavour/version from `PrimaryStore.xml` or `values.yaml` metadata.
- Warn when markers look stale or incomplete.
