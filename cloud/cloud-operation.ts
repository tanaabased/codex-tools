import { realpath } from 'node:fs/promises';

import { checkCloudSkill } from './cloud-check.ts';
import { cloudProject, type CloudProject } from './cloud-config.ts';
import { packageCloudSkills } from './package-cloud-skills.ts';

type CloudCommand = 'cloud package' | 'cloud verify';

interface CloudOperation {
  command: CloudCommand;
  project: CloudProject;
  root: string;
}

export async function resolveCloudOperation(
  command: CloudCommand,
  configPath: string | undefined,
  packageDirectory: string | undefined,
): Promise<CloudOperation> {
  const project = await cloudProject(configPath, command);
  const root = command === 'cloud verify' ? await realpath(packageDirectory!) : project.root;
  return { command, project, root };
}

export async function runCloudOperation(
  { command, project, root }: CloudOperation,
  env: NodeJS.ProcessEnv,
) {
  if (command === 'cloud package') {
    const skills = await packageCloudSkills(project, env);
    return { ok: true, status: 'packaged', skills } as const;
  }
  for (const skill of project.skills) await checkCloudSkill(project, skill, root);
  const skills = project.skills.map((skill) => skill.dir);
  return { ok: true, status: 'verified', skills } as const;
}
