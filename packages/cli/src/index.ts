#!/usr/bin/env node
import { Command } from 'commander';
import { createApp } from './create.js';

const program = new Command();

program
  .name('pas')
  .description('ProAppStore CLI — create, develop, and publish pro apps.')
  .version('1.0.0');

program
  .command('create <app-id>')
  .description('Scaffold a new pro app with SDK, hooks, and Tailwind.')
  .option('--skip-install', 'Skip pnpm install')
  .option('--skip-git', 'Skip git init')
  .action(async (appId: string, opts: { skipInstall?: boolean; skipGit?: boolean }) => {
    await createApp(appId, opts);
  });

program
  .command('login')
  .description('Sign in with GitHub (shared identity with `fas`).')
  .action(() => {
    process.stdout.write(
      'pas login is not yet implemented.\n' +
        'For now: run `fas login` (from @freeappstore/cli) — pro shares the same identity.\n',
    );
    process.exit(2);
  });

program
  .command('publish')
  .description('Open the ProAppStore publisher portal for the current repo.')
  .action(() => {
    process.stdout.write('pas publish: coming soon.\n');
    process.exit(2);
  });

program.parseAsync().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`pas: ${msg}\n`);
  process.exit(1);
});
