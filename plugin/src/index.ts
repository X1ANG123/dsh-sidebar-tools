/**
 * Host half of the sidebar tools plugin: the terminal service, its routes, and
 * the configuration they read.
 *
 * The browser half ships through exports["./client"], discovered from the
 * package.json `dsh.client` declaration; both halves live in one package so an
 * install is one artifact.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Config } from './config.ts'
import { registerRoutes } from './host/routes.ts'
import { FaviconCache } from './host/favicon.ts'
import { RateLimiter, TokenStore } from './host/security.ts'
import { GuiTerminalService } from './host/terminals.ts'

export { Config }
export type { TerminalModeConfig } from './config.ts'

/** Cordis function-plugin name. */
export const name = 'ui-sidebar-tools'

/** Host-plane services: the route carrier, the trust fence, live agents, confinement, processes. */
export const inject = ['webServer', 'connection', 'agents', 'sandboxPolicy', 'subprocess']

/**
 * Host plugin body.
 * @param ctx - composition context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const terminals = new GuiTerminalService(ctx, config)
  const tokens = new TokenStore(config.csrfTokenTtlMs, config.csrfTokenMaxEntries)
  const opens = new RateLimiter(config.maxOpensPerMinute, 60_000)
  const favicons = new FaviconCache()
  registerRoutes({ ctx, config, terminals, tokens, opens, favicons })
  if (config.allowRemote) {
    ctx.logger.warn('ui-sidebar-tools: allowRemote is on; terminal routes serve callers outside loopback')
  }
  if (config.mode === 'danger-full-access') {
    ctx.logger.warn('ui-sidebar-tools: mode danger-full-access starts unconfined shells')
  }
  ctx.effect(() => () => terminals.dispose(), 'ui-sidebar-tools: terminal sessions')
}
