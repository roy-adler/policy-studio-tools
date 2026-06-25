# Feature: Project Detection

## Goal
Detect whether the opened workspace is an Axway Policy Studio project.

## User story
As a developer, I want the extension to recognize Policy Studio projects automatically, so that relevant tools only appear when useful.

## Inputs
- Workspace folder
- Policy Studio project markers at the workspace folder root:
  - **XML project:** `PrimaryStore.xml`
  - **YAML project:** `values.yaml` together with a `Policies`, `APIs`, or `META-INF` directory

## Behavior
- On workspace open, scan each workspace folder for the markers above.
- If detected, show "Policy Studio project detected" in the status bar.
- If not detected, keep all Policy Studio commands hidden or inactive.

## Acceptance criteria
- [x] Detects sample project in test/fixtures/sample-policy-project
- [x] Detects YAML sample project in test/fixtures/sample-yaml-policy-project
- [x] Does not activate features in normal folders
- [x] Status bar item appears only for detected projects
- [x] Unit test covers positive and negative detection