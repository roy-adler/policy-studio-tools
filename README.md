# Policy Studio Tools

VS Code extension for Axway Policy Studio projects: multi-project discovery, circuit search, policy flow visualization, and a Policy Studio sidebar.

Supports both Policy Studio project formats: the **YAML entity store** (Axway's current, primary format — `values.yaml` with `Policies/`, `APIs/`, or `META-INF/`) and the **legacy XML entity store** (`PrimaryStore.xml`).

## Features

- Discover Policy Studio projects in monorepos (YAML and XML layouts)
- Search circuits, filters, attributes, scripts, and references
- Jump to circuit definitions from references
- Visualize a policy's filter flow with green success and red failure paths
- Visualize inter-circuit reference graphs with entry points, cycles, and missing refs
- Validate URI path templates with live diagnostics
- Compare two policy snapshots semantically (circuits, scripts, paths, URLs)
- Export project documentation to Markdown
- Open and inspect `.trc` trace files in a structured viewer
- Policy Studio sidebar with project scope and tools



## Requirements

- VS Code 1.85 or newer
- No installation



## Development

```bash
npm ci
npm test
npm run compile
```

