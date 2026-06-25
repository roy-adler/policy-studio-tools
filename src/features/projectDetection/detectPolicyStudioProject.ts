import * as fs from 'fs';
import * as path from 'path';

export const XML_PROJECT_MARKER = 'PrimaryStore.xml';
export const YAML_VALUES_MARKER = 'values.yaml';
export const YAML_PROJECT_DIRECTORIES = ['Policies', 'APIs', 'META-INF'] as const;

function isXmlPolicyStudioProject(folderPath: string): boolean {
  return fs.existsSync(path.join(folderPath, XML_PROJECT_MARKER));
}

function isYamlPolicyStudioProject(folderPath: string): boolean {
  const valuesPath = path.join(folderPath, YAML_VALUES_MARKER);
  if (!fs.existsSync(valuesPath)) {
    return false;
  }

  return YAML_PROJECT_DIRECTORIES.some((directory) =>
    fs.existsSync(path.join(folderPath, directory)),
  );
}

export function isPolicyStudioProject(folderPath: string): boolean {
  return isXmlPolicyStudioProject(folderPath) || isYamlPolicyStudioProject(folderPath);
}
