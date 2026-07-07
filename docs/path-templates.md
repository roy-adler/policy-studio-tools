# Path template examples

Valid URI path templates for Policy Studio routing configuration.

## Static paths

- `/api/v1/pets`
- `/health`
- `/api/v1/orders/{orderId}/items`

## Path parameters

- `/api/v1/pets/{petId}` — single path parameter
- `/api/v1/pets/{petId}/orders/{orderId}` — multiple distinct parameters

## Regex-constrained parameters

- `/files/{path:.*}` — regex constraint after `:` (platform-specific; verify against your API Gateway version)

## Rules of thumb

- Start absolute paths with `/`
- Use unique placeholder names within a template
- Avoid `*` and `**` wildcards in path segments
- Collapse accidental `//` segments
- Trailing `/` may change matching behaviour

See `policyStudio.pathTemplate` diagnostics in the editor for live validation.
