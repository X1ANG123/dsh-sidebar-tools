/**
 * A shared fixture: a fully specified configuration, so a test states only what
 * it is about.
 */
import type { Config } from '../src/config.ts'
import { Config as schema } from '../src/config.ts'

/**
 * The plugin's defaults, optionally overridden.
 * @param overrides - the fields this test cares about.
 * @returns a complete, validated configuration.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  // Schemastery types its argument as the fully specified *source* object while
  // every field here carries a schema default; the cast states exactly that
  // "no input" is a valid call.
  return { ...schema({} as Config), ...overrides }
}
