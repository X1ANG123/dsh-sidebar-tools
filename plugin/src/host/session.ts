/**
 * What one GUI terminal runs as: the live Session's Agent, the file-effect mode
 * this terminal runs under, and the argv that carries that confinement.
 *
 * Two rules live here. A terminal is never wider than the Session it was opened
 * from — an explicit mode narrows, and a mode the Session does not itself hold
 * is clamped down to it. And confinement is fail-closed: a confined mode with
 * no `ctx.sandbox` provider refuses to start rather than running unconfined.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/host/session
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Config } from '../config.ts'
import type { TerminalErrorCode, TerminalModeChoice, TerminalSandboxInfo } from '../shared.ts'

/** Widening order of the file-effect modes. */
const MODE_RANK: Record<SandboxMode, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
}

/**
 * Narrow one requested mode to the Session's own.
 * @param requested - the mode this deployment asked for.
 * @param sessionMode - the mode the Session itself holds.
 * @returns the narrower of the two, so a terminal never widens a Session.
 */
export function clampMode(requested: SandboxMode, sessionMode: SandboxMode): SandboxMode {
  return MODE_RANK[requested] <= MODE_RANK[sessionMode] ? requested : sessionMode
}

/** One terminal's resolved execution facts. */
export interface TerminalTarget {
  /** The live Agent that owns this Session; kept for the ownership recheck. */
  readonly agent: Agent
  /** The Session whose cwd bounds this terminal. */
  readonly session: Session
  /** Executable and arguments, already confined when the mode calls for it. */
  readonly argv: readonly string[]
  /** Working directory: the Session's workspace root. */
  readonly cwd: string
  /** Effective confinement facts, reported to the pane as they are. */
  readonly sandbox: TerminalSandboxInfo
}

/** Either the facts to spawn with, or the refusal to report. */
export type TerminalTargetResult =
  | { readonly ok: true; readonly target: TerminalTarget }
  | { readonly ok: false; readonly code: TerminalErrorCode; readonly message: string }

/**
 * This platform's quiet, non-profile shell arguments.
 * @param shell - the resolved executable path.
 * @returns arguments that keep the shell out of startup profiles.
 */
function defaultArgs(shell: string): string[] {
  const name = shell.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  if (name.startsWith('pwsh') || name.startsWith('powershell')) {
    // The line editor keeps a history file under the user's home, which the
    // Session's confinement refuses to write: an expected warning that reads
    // like a failure. In-session history still works; only the file is dropped.
    // A deployment that wants the file back overrides `shellArgs`.
    return ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'Set-PSReadLineOption -HistorySaveStyle SaveNothing']
  }
  if (name.startsWith('bash') || name === 'sh' || name.startsWith('zsh')) return ['-i']
  return []
}

/**
 * Resolve the shell to launch: the configured one, else this host's own.
 * @param ctx - composition context carrying the subprocess provider.
 * @param config - resolved configuration.
 * @returns the absolute executable path, or undefined when none resolves.
 */
async function resolveShell(ctx: Context, config: Config): Promise<string | undefined> {
  if (config.shellPath !== '') return config.shellPath
  const candidates = process.platform === 'win32' ? ['pwsh', 'powershell'] : [process.env.SHELL ?? 'bash']
  for (const candidate of candidates) {
    try {
      return await ctx.subprocess.resolveExecutable(candidate)
    } catch {
      // A name that does not resolve has exactly one meaning here: try the next.
    }
  }
  return undefined
}

/**
 * Resolve one Session's terminal target.
 * @param ctx - composition context carrying agents, policy, sandbox, subprocess.
 * @param config - resolved configuration.
 * @param sessionId - the Session the pane belongs to.
 * @param choice - the confinement the pane asked for; omitted uses the deployment's own.
 * @returns the spawn facts, or the refusal to answer with.
 */
export async function resolveTerminalTarget(
  ctx: Context,
  config: Config,
  sessionId: string,
  choice?: TerminalModeChoice,
): Promise<TerminalTargetResult> {
  // The registry's key type is its own; the route layer already validated the
  // string's shape and length before this point.
  const agent = ctx.agents.get(sessionId as Parameters<Context['agents']['get']>[0])
  if (agent === undefined) {
    return { ok: false, code: 'session-not-live', message: `no live agent owns session ${sessionId}` }
  }
  const session = agent.session
  const sessionPolicy = ctx.sandboxPolicy.resolve({ session })
  const asked = choice ?? config.mode
  const requested: SandboxMode = asked === 'session' ? sessionPolicy.mode : asked
  const mode = clampMode(requested, sessionPolicy.mode)
  // The service owns precedence and the workspace-root fallback; asking it for
  // the clamped mode keeps that ownership in one place.
  const policy: SandboxExecutionPolicy = ctx.sandboxPolicy.resolve({ session, mode })

  const shell = await resolveShell(ctx, config)
  if (shell === undefined) {
    return {
      ok: false,
      code: 'shell-unavailable',
      message: "no shell resolved: set this plugin's shellPath, or install pwsh/bash",
    }
  }
  const base = [shell, ...(config.shellArgs.length > 0 ? config.shellArgs : defaultArgs(shell))]

  if (policy.mode === 'danger-full-access') {
    return {
      ok: true,
      target: {
        agent,
        session,
        argv: base,
        cwd: policy.workspaceRoot,
        sandbox: { mode: policy.mode, enforcement: 'none', workspaceRoot: policy.workspaceRoot },
      },
    }
  }
  const sandbox = ctx.get('sandbox')
  if (sandbox === undefined) {
    // Fail closed: a confined mode with no provider must never become an
    // unconfined shell by accident.
    return {
      ok: false,
      code: 'sandbox-unavailable',
      message: `confinement mode "${policy.mode}" needs a ctx.sandbox provider; refusing to run unconfined`,
    }
  }
  const confined = sandbox.confine(base, { ...policy, mode: policy.mode })
  return {
    ok: true,
    target: {
      agent,
      session,
      argv: confined.argv,
      cwd: policy.workspaceRoot,
      sandbox: { mode: policy.mode, enforcement: confined.enforcement, workspaceRoot: policy.workspaceRoot },
    },
  }
}
