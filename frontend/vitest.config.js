import { defineConfig } from 'vitest/config'

// reduceMessage is a pure function, so no DOM is needed and the node
// environment keeps the suite fast. Add environment: 'jsdom' if component
// rendering tests are added later.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
