import { expect, it } from 'vitest'

import { PACKAGE } from './index.js'

it('builds and exports its own package name', () => {
  expect(PACKAGE).toBe('@assemora/cli')
})
