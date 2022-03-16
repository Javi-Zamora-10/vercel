import chalk from 'chalk';
import { join } from 'path';
import Client from '../util/client';
import { ProjectEnvTarget } from '../types';
import { emoji, prependEmoji } from '../util/emoji';
import getArgs from '../util/get-args';
import handleError from '../util/handle-error';
import setupAndLink from '../util/link/setup-and-link';
import logo from '../util/output/logo';
import stamp from '../util/output/stamp';
import { getPkgName } from '../util/pkg-name';
import {
  getLinkedProject,
  VERCEL_DIR,
  VERCEL_DIR_PROJECT,
} from '../util/projects/link';
import { writeProjectSettings } from '../util/projects/project-settings';
import envPull from './env/pull';

import type { Project, Org } from '../types';

const help = () => {
  return console.log(`
  ${chalk.bold(`${logo} ${getPkgName()} pull`)} [path]

 ${chalk.dim('Options:')}

    -h, --help                     Output usage information
    -A ${chalk.bold.underline('FILE')}, --local-config=${chalk.bold.underline(
    'FILE'
  )}   Path to the local ${'`vercel.json`'} file
    -Q ${chalk.bold.underline('DIR')}, --global-config=${chalk.bold.underline(
    'DIR'
  )}    Path to the global ${'`.vercel`'} directory
    -d, --debug                    Debug mode [off]
    --env [filename]               The file to write Development Environment Variables to [.env]
    -y, --yes                      Skip the confirmation prompt

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Pull the latest Project Settings from the cloud

    ${chalk.cyan(`$ ${getPkgName()} pull`)}
    ${chalk.cyan(`$ ${getPkgName()} pull ./path-to-project`)}
    ${chalk.cyan(`$ ${getPkgName()} pull --env .env.local`)}
    ${chalk.cyan(`$ ${getPkgName()} pull ./path-to-project --env .env.local`)}
`);
};

function processArgs(client: Client) {
  return getArgs(client.argv.slice(2), {
    '--yes': Boolean,
    '--env': String,
    '--debug': Boolean,
    '-d': '--debug',
    '-y': '--yes',
  });
}

function parseArgs(client: Client) {
  try {
    const argv = processArgs(client);

    if (argv['--help']) {
      help();
      return 2;
    }

    return argv;
  } catch (err) {
    handleError(err);
    return 1;
  }
}

type LinkResult = {
  org: Org;
  project: Project;
};
async function ensureLink(
  client: Client,
  cwd: string,
  yes: boolean
): Promise<LinkResult | number> {
  let link = await getLinkedProject(client, cwd);
  if (link.status === 'not_linked') {
    link = await setupAndLink(client, cwd, {
      autoConfirm: yes,
      successEmoji: 'link',
      setupMsg: 'Set up',
    });

    if (link.status === 'not_linked') {
      // User aborted project linking questions
      return 0;
    }
  }

  if (link.status === 'error') {
    return link.exitCode;
  }

  return { org: link.org, project: link.project };
}

async function pullAllEnvFiles(
  envFileRoot: string,
  client: Client,
  project: Project,
  argv: ReturnType<typeof processArgs>,
  cwd: string
): Promise<number> {
  const pullDeprecatedDevPromise = envPull(
    client,
    project,
    ProjectEnvTarget.Development,
    argv,
    [join(cwd, envFileRoot)], // deprecated location
    client.output
  );

  const devEnvFile = `${envFileRoot}.development.local`;
  const pullDevPromise = envPull(
    client,
    project,
    ProjectEnvTarget.Development,
    argv,
    [join(cwd, '.vercel', devEnvFile)],
    client.output
  );

  const previewEnvFile = `${envFileRoot}.preview.local`;
  const pullPreviewPromise = envPull(
    client,
    project,
    ProjectEnvTarget.Preview,
    argv,
    [join(cwd, '.vercel', previewEnvFile)],
    client.output
  );

  const prodEnvFile = `${envFileRoot}.production.local`;
  const pullProdPromise = envPull(
    client,
    project,
    ProjectEnvTarget.Production,
    argv,
    [join(cwd, '.vercel', prodEnvFile)],
    client.output
  );

  const [
    pullDeprecatedDevResultCode,
    pullDevResultCode,
    pullPreviewResultCode,
    pullProdResultCode,
  ] = await Promise.all([
    pullDeprecatedDevPromise,
    pullDevPromise,
    pullPreviewPromise,
    pullProdPromise,
  ]);

  return (
    pullDeprecatedDevResultCode ||
    pullDevResultCode ||
    pullPreviewResultCode ||
    pullProdResultCode ||
    0
  );
}

export default async function main(client: Client) {
  const argv = parseArgs(client);
  if (typeof argv === 'number') {
    return argv;
  }

  const cwd = argv._[1] || process.cwd();
  const yes = Boolean(argv['--yes']);
  const env = argv['--env'] ?? '.env';

  const link = await ensureLink(client, cwd, yes);
  if (typeof link === 'number') {
    return link;
  }

  const { project, org } = link;

  client.config.currentTeam = org.type === 'team' ? org.id : undefined;

  const pullResultCode = await pullAllEnvFiles(env, client, project, argv, cwd);
  if (pullResultCode !== 0) {
    return pullResultCode;
  }

  await writeProjectSettings(cwd, project, org);

  const settingsStamp = stamp();
  client.output.print(
    `${prependEmoji(
      `Downloaded project settings to ${chalk.bold(
        join(VERCEL_DIR, VERCEL_DIR_PROJECT)
      )} ${chalk.gray(settingsStamp())}`,
      emoji('success')
    )}\n`
  );

  return 0;
}
