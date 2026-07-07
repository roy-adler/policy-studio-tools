# Policy Studio Tools

VS Code extension for Axway Policy Studio projects: multi-project discovery, circuit search, policy flow visualization, and a Policy Studio sidebar.

Supports both Policy Studio project formats: the **YAML entity store** (Axway's current, primary format — `values.yaml` with `Policies/`, `APIs/`, or `META-INF/`) and the **legacy XML entity store** (`PrimaryStore.xml`).

## Features

- Discover Policy Studio projects in monorepos (YAML and XML layouts)
- Search circuits, filters, attributes, scripts, and references
- Jump to circuit definitions from references
- Visualize a policy's filter flow with green success and red failure paths
- Policy Studio sidebar with project scope and tools

## Requirements

- VS Code 1.85 or newer

## Development

```bash
npm ci
npm test
npm run compile
```
