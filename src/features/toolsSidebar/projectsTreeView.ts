import type { ProjectsTreeNode, ProjectsTreeNodeKind } from './projectsTreeModel';

/** Horizontal step for each nesting level in the Projects tree. */
export const PROJECTS_TREE_INDENT_PX = 20;

const COLLAPSIBLE_KINDS = new Set<ProjectsTreeNodeKind>(['folder', 'workspaceFolder']);

const ICON_MARKUP: Record<string, string> = {
  folder:
    '<path d="M2 4.5V6H5.58579C5.71839 6 5.84557 5.94732 5.93934 5.85355L7.29289 4.5L5.93934 3.14645C5.84557 3.05268 5.71839 3 5.58579 3H3.5C2.67157 3 2 3.67157 2 4.5ZM1 4.5C1 3.11929 2.11929 2 3.5 2H5.58579C5.98361 2 6.36514 2.15804 6.64645 2.43934L8.20711 4H12.5C13.8807 4 15 5.11929 15 6.5V11.5C15 12.8807 13.8807 14 12.5 14H3.5C2.11929 14 1 12.8807 1 11.5V4.5ZM2 7V11.5C2 12.3284 2.67157 13 3.5 13H12.5C13.3284 13 14 12.3284 14 11.5V6.5C14 5.67157 13.3284 5 12.5 5H8.20711L6.64645 6.56066C6.36514 6.84197 5.98361 7 5.58579 7H2Z"/>',
  'root-folder':
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M4.5 7C2.019 7 0 9.019 0 11.5C0 13.981 2.019 16 4.5 16C6.981 16 9 13.981 9 11.5C9 9.019 6.981 7 4.5 7ZM4.5 15C2.57 15 1 13.43 1 11.5C1 9.57 2.57 8 4.5 8C6.43 8 8 9.57 8 11.5C8 13.43 6.43 15 4.5 15ZM7 11.5C7 12.881 5.881 14 4.5 14C3.119 14 2 12.881 2 11.5C2 10.119 3.119 9 4.5 9C5.881 9 7 10.119 7 11.5ZM15 6.5V11.5C15 12.881 13.881 14 12.5 14H10V13H12.5C13.328 13 14 12.328 14 11.5V6.5C14 5.672 13.328 5 12.5 5H8.207L7.207 6H5.586C5.719 6 5.846 5.947 5.94 5.854L7.294 4.5L5.94 3.146C5.846 3.052 5.719 3 5.586 3H3.5C2.672 3 2 3.672 2 4.5V6H1V4.5C1 3.119 2.119 2 3.5 2H5.586C5.984 2 6.365 2.158 6.647 2.439L8.208 4H12.501C13.882 4 15.001 5.119 15.001 6.5H15Z"/>',
  'symbol-key':
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.00098 5.5C7.63498 5.5 7.29598 5.619 7.00098 5.813V4.5C7.00098 4.224 6.77698 4 6.50098 4C6.22498 4 6.00098 4.224 6.00098 4.5V9.5C6.00098 9.776 6.22498 10 6.50098 10C6.71798 10 6.89798 9.86 6.96698 9.666C7.26998 9.873 7.62098 10 8.00098 10C9.10398 10 10.001 8.991 10.001 7.75C10.001 6.509 9.10398 5.5 8.00098 5.5ZM8.00098 9C7.44898 9 7.00098 8.439 7.00098 7.75C7.00098 7.061 7.44898 6.5 8.00098 6.5C8.55298 6.5 9.00098 7.061 9.00098 7.75C9.00098 8.439 8.55298 9 8.00098 9Z"/><path d="M12.749 10C11.646 10 10.749 8.991 10.749 7.75C10.749 6.509 11.646 5.5 12.749 5.5C12.892 5.5 14.001 5.605 14.001 6.236C14.001 6.511 13.777 6.736 13.5 6.736C13.3671 6.736 13.2817 6.68604 13.1896 6.6321C13.0814 6.5688 12.9639 6.5 12.749 6.5C12.197 6.5 11.749 7.061 11.749 7.75C11.749 8.439 12.197 9 12.749 9C12.9613 9 13.0789 8.93181 13.1874 8.8689C13.2804 8.81502 13.3667 8.765 13.5 8.765C13.779 8.765 14.001 8.992 14.001 9.264C14.001 9.897 12.887 10 12.749 10Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M1.89798 5.646C1.99098 5.553 2.36398 5.25 3.25198 5.25C4.12198 5.25 5.00098 5.765 5.00098 6.75V9.5C5.00098 9.776 4.77698 10 4.50098 10C4.36198 10 4.23698 9.943 4.14598 9.851C3.91198 9.937 3.62298 10 3.25098 10C1.93798 10 1.25098 9.246 1.25098 8.5C1.25098 7.754 1.93798 7 3.25098 7C3.55298 7 3.79698 7.023 4.00098 7.056V6.75C4.00098 6.256 3.28098 6.25 3.25098 6.25C2.78847 6.25 2.60167 6.36312 2.57928 6.37668L2.57698 6.378C2.38098 6.573 2.07798 6.561 1.88398 6.365C1.68898 6.17 1.70298 5.841 1.89798 5.646ZM3.25198 8C2.60298 8 2.25198 8.258 2.25198 8.5C2.25198 8.742 2.60298 9 3.25198 9C3.69898 9 3.90898 8.885 4.00198 8.811V8.074C3.85798 8.038 3.62398 8 3.25198 8Z"/>',
  'file-code':
    '<path d="M13.56 4.35L10.65 1.44C10.368 1.16009 9.98732 1.00208 9.58998 1H5.99998C5.47003 1.00158 4.96224 1.2128 4.58751 1.58753C4.21278 1.96227 4.00156 2.47005 3.99998 3V8.83C4.28127 8.9031 4.53719 9.05181 4.73998 9.26C4.84686 9.3602 4.93492 9.47874 4.99998 9.61V3C4.99998 2.73478 5.10534 2.48043 5.29287 2.29289C5.48041 2.10536 5.73476 2 5.99998 2H8.99998V4.5C8.99998 4.89782 9.15801 5.27936 9.43932 5.56066C9.72062 5.84196 10.1022 6 10.5 6H13V13C13 13.2652 12.8946 13.5196 12.7071 13.7071C12.5195 13.8946 12.2652 14 12 14H10.48L9.46998 15H12C12.5299 14.9984 13.0377 14.7872 13.4124 14.4125C13.7872 14.0377 13.9984 13.5299 14 13V5.41C13.9979 5.01266 13.8399 4.63202 13.56 4.35ZM10.5 5C10.3674 5 10.2402 4.94732 10.1464 4.85355C10.0527 4.75979 9.99998 4.63261 9.99998 4.5V2.21L12.79 5H10.5Z"/><path d="M3.47798 14.978C3.34548 14.9777 3.21852 14.9248 3.12498 14.831L1.14598 12.854C1.09942 12.8076 1.06247 12.7524 1.03727 12.6916C1.01206 12.6309 0.999084 12.5658 0.999084 12.5C0.999084 12.4342 1.01206 12.3691 1.03727 12.3084C1.06247 12.2476 1.09942 12.1924 1.14598 12.146L3.14598 10.146C3.23986 10.0521 3.3672 9.99937 3.49998 9.99937C3.63275 9.99937 3.76009 10.0521 3.85398 10.146C3.94787 10.2399 4.00061 10.3672 4.00061 10.5C4.00061 10.6328 3.94787 10.7601 3.85398 10.854L2.20698 12.5L3.83198 14.124C3.90209 14.1939 3.94985 14.2831 3.96922 14.3802C3.98858 14.4773 3.97868 14.578 3.94076 14.6695C3.90284 14.7609 3.83862 14.8391 3.75623 14.894C3.67384 14.9489 3.577 14.9782 3.47798 14.978Z"/><path d="M7.52198 14.978C7.42296 14.9782 7.32611 14.9489 7.24372 14.894C7.16134 14.8391 7.09711 14.7609 7.05919 14.6695C7.02128 14.578 7.01137 14.4773 7.03074 14.3802C7.05011 14.2831 7.09787 14.1939 7.16798 14.124L8.79298 12.5L7.14598 10.854C7.05209 10.7601 6.99935 10.6328 6.99935 10.5C6.99935 10.3672 7.05209 10.2399 7.14598 10.146C7.23986 10.0521 7.3672 9.99937 7.49998 9.99937C7.63275 9.99937 7.76009 10.0521 7.85398 10.146L9.85398 12.146C9.90054 12.1924 9.93748 12.2476 9.96269 12.3084C9.9879 12.3691 10.0009 12.4342 10.0009 12.5C10.0009 12.5658 9.9879 12.6309 9.96269 12.6916C9.93748 12.7524 9.90054 12.8076 9.85398 12.854L7.87498 14.831C7.78144 14.9248 7.65447 14.9777 7.52198 14.978Z"/>',
  check:
    '<path d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/>',
  refresh:
    '<path d="M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z"/>',
  warning:
    '<path d="M14.831 11.965L9.206 1.714C8.965 1.274 8.503 1 8 1C7.497 1 7.035 1.274 6.794 1.714L1.169 11.965C1.059 12.167 1 12.395 1 12.625C1 13.383 1.617 14 2.375 14H13.625C14.383 14 15 13.383 15 12.625C15 12.395 14.941 12.167 14.831 11.965ZM13.625 13H2.375C2.168 13 2 12.832 2 12.625C2 12.561 2.016 12.5 2.046 12.445L7.671 2.195C7.736 2.075 7.863 2 8 2C8.137 2 8.264 2.075 8.329 2.195L13.954 12.445C13.984 12.501 14 12.561 14 12.625C14 12.832 13.832 13 13.625 13ZM8.75 11.25C8.75 11.664 8.414 12 8 12C7.586 12 7.25 11.664 7.25 11.25C7.25 10.836 7.586 10.5 8 10.5C8.414 10.5 8.75 10.836 8.75 11.25ZM7.5 9V5.5C7.5 5.224 7.724 5 8 5C8.276 5 8.5 5.224 8.5 5.5V9C8.5 9.276 8.276 9.5 8 9.5C7.724 9.5 7.5 9.276 7.5 9Z"/>',
  info:
    '<path d="M8.49902 7.49998C8.49902 7.22384 8.27517 6.99998 7.99902 6.99998C7.72288 6.99998 7.49902 7.22384 7.49902 7.49998V10.5C7.49902 10.7761 7.72288 11 7.99902 11C8.27517 11 8.49902 10.7761 8.49902 10.5V7.49998ZM8.74807 5.50001C8.74807 5.91369 8.41271 6.24905 7.99903 6.24905C7.58535 6.24905 7.25 5.91369 7.25 5.50001C7.25 5.08633 7.58535 4.75098 7.99903 4.75098C8.41271 4.75098 8.74807 5.08633 8.74807 5.50001ZM8 1C4.13401 1 1 4.13401 1 8C1 11.866 4.13401 15 8 15C11.866 15 15 11.866 15 8C15 4.13401 11.866 1 8 1ZM2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8Z"/>',
  target:
    '<path d="M9 8C9 8.552 8.552 9 8 9C7.448 9 7 8.552 7 8C7 7.448 7.448 7 8 7C8.552 7 9 7.448 9 8ZM12 8C12 10.209 10.209 12 8 12C5.791 12 4 10.209 4 8C4 5.791 5.791 4 8 4C10.209 4 12 5.791 12 8ZM11 8C11 6.343 9.657 5 8 5C6.343 5 5 6.343 5 8C5 9.657 6.343 11 8 11C9.657 11 11 9.657 11 8ZM15 8C15 11.866 11.866 15 8 15C4.134 15 1 11.866 1 8C1 4.134 4.134 1 8 1C11.866 1 15 4.134 15 8ZM14 8C14 4.686 11.314 2 8 2C4.686 2 2 4.686 2 8C2 11.314 4.686 14 8 14C11.314 14 14 11.314 14 8Z"/>',
  'folder-library':
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.20702 4H12.5C13.881 4 15 5.119 15 6.5V11.5C15 12.881 13.881 14 12.5 14H10.113C10.1068 13.9809 10.1016 13.9615 10.0964 13.9421C10.0883 13.9117 10.0802 13.8813 10.068 13.852L9.71502 13H12.5C13.328 13 14 12.328 14 11.5V6.5C14 5.672 13.328 5 12.5 5H8.20702L6.64602 6.561C6.36402 6.842 5.98302 7 5.58502 7H0.999023V4.5C0.999023 3.119 2.11802 2 3.49902 2H5.58502C5.98302 2 6.36502 2.158 6.64602 2.439L8.20702 4ZM5.58502 6C5.71802 6 5.84502 5.948 5.93902 5.854L7.29302 4.5L5.93902 3.146C5.84502 3.053 5.71802 3 5.58502 3H3.49902C2.67102 3 1.99902 3.672 1.99902 4.5V6H5.58502Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M6.766 9.271C7.011 9.372 7.207 9.565 7.311 9.809L9.144 14.234C9.196 14.355 9.224 14.485 9.224 14.617C9.224 14.814 9.166 15.008 9.056 15.172C8.946 15.337 8.791 15.465 8.608 15.541L7.683 15.924C7.561 15.974 7.431 16 7.3 16C7.102 16 6.908 15.941 6.743 15.832C6.578 15.723 6.449 15.566 6.373 15.383L5 12.07V15C5 15.265 4.895 15.519 4.707 15.707C4.52 15.895 4.265 16 4 16H3C2.824 16 2.652 15.954 2.5 15.865C2.348 15.954 2.176 16 2 16H1C0.735 16 0.481 15.895 0.293 15.707C0.105 15.52 0 15.265 0 15V9C0 8.735 0.106 8.481 0.293 8.293C0.48 8.105 0.735 8 1 8H2C2.176 8 2.348 8.046 2.5 8.135C2.652 8.046 2.824 8 3 8H4C4.265 8 4.519 8.106 4.707 8.293C4.895 8.48 5 8.735 5 9V9.688C5.025 9.674 5.051 9.661 5.078 9.65L6 9.268C6.246 9.169 6.521 9.17 6.766 9.271ZM1 15H2V9H1V15ZM3 15H4V9H3V15ZM5.463 10.574L7.3 15L8.22 14.617L6.385 10.192L5.463 10.574Z"/>',
  'list-selection':
    '<path d="M2 3.5C2 3.22386 2.22386 3 2.5 3H10.5C10.7761 3 11 3.22386 11 3.5C11 3.77614 10.7761 4 10.5 4H2.5C2.22386 4 2 3.77614 2 3.5ZM2 11.5C2 11.2239 2.22386 11 2.5 11H9.5C9.77614 11 10 11.2239 10 11.5C10 11.7761 9.77614 12 9.5 12H2.5C2.22386 12 2 11.7761 2 11.5ZM2.5 7C2.22386 7 2 7.22386 2 7.5C2 7.77614 2.22386 8 2.5 8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H2.5Z"/>',
  'chevron-right':
    '<path d="M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z"/>',
  'chevron-down':
    '<path d="M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z"/>',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function glyph(markup: string): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">${markup}</svg>`;
}

function iconHtml(iconId: string | undefined): string {
  const markup = iconId ? ICON_MARKUP[iconId] : undefined;
  if (!markup) {
    return '<span class="icon" aria-hidden="true"></span>';
  }
  return `<span class="icon" aria-hidden="true">${glyph(markup)}</span>`;
}

function twistieHtml(collapsible: boolean, expanded: boolean): string {
  if (!collapsible) {
    return '<span class="twistie" aria-hidden="true"></span>';
  }
  const markup = expanded ? ICON_MARKUP['chevron-down'] : ICON_MARKUP['chevron-right'];
  return `<span class="twistie" aria-hidden="true">${glyph(markup)}</span>`;
}

function rowCommand(node: ProjectsTreeNode): string | undefined {
  if (node.command) {
    return node.command;
  }
  if (node.kind === 'project' && node.projectId) {
    return 'policyStudioTools.setActiveProject';
  }
  return undefined;
}

function renderNode(
  node: ProjectsTreeNode,
  collapsed: ReadonlySet<string>,
  depth: number,
): string {
  const collapsible = COLLAPSIBLE_KINDS.has(node.kind) && (node.children?.length ?? 0) > 0;
  const expanded = collapsible && !collapsed.has(node.id);
  const command = rowCommand(node);
  const width = depth * PROJECTS_TREE_INDENT_PX;
  const children =
    expanded && node.children ? renderProjectsTreeRows(node.children, collapsed, depth + 1) : '';

  const expandedAttr = collapsible
    ? ` data-expanded="${expanded ? 'true' : 'false'}" aria-expanded="${expanded ? 'true' : 'false'}"`
    : '';
  const commandAttr = command ? ` data-command="${escapeHtml(command)}"` : '';
  const projectAttr = node.projectId ? ` data-project-id="${escapeHtml(node.projectId)}"` : '';
  const titleAttr = node.tooltip ? ` title="${escapeHtml(node.tooltip)}"` : '';

  return (
    `<div class="row" role="treeitem" tabindex="0" data-id="${escapeHtml(node.id)}" data-depth="${depth}" data-kind="${escapeHtml(node.kind)}"${commandAttr}${projectAttr}${expandedAttr} aria-level="${depth + 1}"${titleAttr}>` +
    `<span class="guides" style="width:${width}px"></span>` +
    twistieHtml(collapsible, expanded) +
    iconHtml(node.iconId) +
    `<span class="label">${escapeHtml(node.label)}</span>` +
    (node.description ? `<span class="description">${escapeHtml(node.description)}</span>` : '') +
    `</div>${children}`
  );
}

export function renderProjectsTreeRows(
  nodes: ProjectsTreeNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): string {
  return nodes.map((node) => renderNode(node, collapsed, depth)).join('');
}

export function projectsTreeShell(cspSource: string, nonce: string): string {
  const indent = `${PROJECTS_TREE_INDENT_PX}px`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${escapeHtml(cspSource)}; script-src 'nonce-${escapeHtml(nonce)}';" />
  <style>
    :root { --projects-tree-indent: ${indent}; }
    body {
      margin: 0;
      padding: 2px 0 8px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: transparent;
    }
    #tree { outline: none; }
    .row {
      display: flex;
      align-items: center;
      height: 22px;
      line-height: 22px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
    }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .row:focus {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .guides {
      flex: none;
      align-self: stretch;
      background-image: repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--projects-tree-indent) - 1px),
        var(--vscode-tree-indentGuidesStroke, rgba(128, 128, 128, 0.55)) calc(var(--projects-tree-indent) - 1px),
        var(--vscode-tree-indentGuidesStroke, rgba(128, 128, 128, 0.55)) var(--projects-tree-indent)
      );
    }
    .twistie, .icon {
      width: 16px;
      height: 16px;
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon { margin-right: 4px; }
    .icon svg, .twistie svg { display: block; }
    .label { overflow: hidden; text-overflow: ellipsis; }
    .description {
      margin-left: 8px;
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row:focus .description { color: inherit; opacity: 0.85; }
    .row[data-kind="warning"] .icon { color: var(--vscode-editorWarning-foreground); }
  </style>
</head>
<body>
  <div id="tree" role="tree" tabindex="0"></div>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    const tree = document.getElementById('tree');
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'render') return;
      const activeId = document.activeElement && document.activeElement.getAttribute('data-id');
      tree.innerHTML = message.html;
      if (activeId) {
        const next = tree.querySelector('[data-id="' + CSS.escape(activeId) + '"]');
        if (next) next.focus();
      }
    });
    function activate(row) {
      vscode.postMessage({
        type: 'activate',
        id: row.dataset.id,
        command: row.dataset.command || '',
        projectId: row.dataset.projectId || '',
        kind: row.dataset.kind || '',
      });
    }
    tree.addEventListener('click', (event) => {
      const row = event.target.closest('.row');
      if (row) activate(row);
    });
    tree.addEventListener('keydown', (event) => {
      const current = event.target.closest && event.target.closest('.row');
      if (!current) return;
      const all = Array.from(tree.querySelectorAll('.row'));
      const index = all.indexOf(current);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        all[Math.min(all.length - 1, index + 1)].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        all[Math.max(0, index - 1)].focus();
      } else if (event.key === 'ArrowRight' && current.dataset.expanded === 'false') {
        event.preventDefault();
        activate(current);
      } else if (event.key === 'ArrowLeft' && current.dataset.expanded === 'true') {
        event.preventDefault();
        activate(current);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(current);
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
