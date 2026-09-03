#!/usr/bin/env node
/**
 * What `pnpm create assemora` runs until there is a release to run instead.
 *
 * Not a stub that fails silently: somebody typed this because a README told them to,
 * and the useful answer is where the thing actually is. Exit 1, because nothing was
 * scaffolded and a script that continues on this is a script that continues on nothing.
 */
process.stderr.write(
  [
    'Assemora is not released yet, so there is nothing for this to scaffold.',
    '',
    'It runs from a checkout today:',
    '',
    '  git clone https://github.com/assemora/assemora.git',
    '  cd assemora && pnpm install && pnpm demo',
    '',
    'https://github.com/assemora/assemora',
    '',
  ].join('\n'),
)

process.exitCode = 1
