/**
 * Resolves the dotted key path to add from the "Add key" toolbar action.
 *
 * Rules (per spec: "relative to current node or absolute"):
 * - If the trimmed input already contains a `.`, it is treated as a fully
 *   qualified, absolute dotted path from the root and used verbatim.
 * - Otherwise, if a node is currently selected in the tree, the input is
 *   treated as relative to that selection and joined onto it
 *   (`${selectedPath}.${input}`).
 * - Otherwise (no selection and no dot), the trimmed input is used as-is,
 *   i.e. treated as a new top-level key.
 */
export function resolveAddKeyPath(selectedPath: string | undefined, input: string): string {
  const trimmed = input.trim();

  if (trimmed.includes('.')) {
    return trimmed;
  }

  if (selectedPath) {
    return `${selectedPath}.${trimmed}`;
  }

  return trimmed;
}
