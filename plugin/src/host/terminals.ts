/**
 * The GUI terminal service: one live PTY per pane, its serialized screen, and
 * every limit that keeps a hostile — or merely broken — caller from turning the
 * pane into a way to exhaust the host.
 *
 * Each session is a capability. Its id is 128 random bits, it is never reused,
 * and every call re-checks that the Agent it was opened for is still the live
 * owner of that Session. A reader that cannot keep up is dropped rather than
 * buffered, a terminal that nobody reads is closed after a grace period, and
 * disposal stops every shell this service started.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/host/terminals
 */

import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalHandle, SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'
import type { Config } from '../config.ts'
import {
  MAX_INPUT_LENGTH,
  type TerminalFailure,
  type TerminalFrame,
  type TerminalOpenResult,
  type TerminalModeChoice,
  type TerminalSandboxInfo,
  type TerminalScreenFrame,
  type TerminalStatus,
} from '../shared.ts'
import { ScreenEmulator } from './emulator.ts'
import { resolveTerminalTarget } from './session.ts'

/** Grace handed to the provider's TERM-to-KILL ladder on close. */
const TERMINAL_GRACE_MS = 5000
/** Input-rate window. */
const INPUT_WINDOW_MS = 1000

/** One live terminal and everything that must die with it. */
interface TerminalRecord {
  readonly id: string
  readonly sessionId: string
  readonly agentId: string
  readonly cols: number
  readonly rows: number
  readonly sandbox: TerminalSandboxInfo
  readonly handle: SubprocessTerminalHandle
  readonly emulator: ScreenEmulator
  readonly writers: Set<ServerResponse>
  seq: number
  lastFrame: string | undefined
  status: TerminalStatus
  frameTimer: NodeJS.Timeout | undefined
  graceTimer: NodeJS.Timeout | undefined
  idleTimer: NodeJS.Timeout | undefined
  lifeTimer: NodeJS.Timeout | undefined
  inputWindowStartedAt: number
  inputWindowBytes: number
  closed: boolean
}

/** One refusal, spelled once. */
function failure(code: TerminalFailure['code'], message: string): TerminalFailure {
  return { ok: false, code, message }
}

/** The GUI terminal service, held in the plugin's apply closure. */
export class GuiTerminalService {
  private readonly records = new Map<string, TerminalRecord>()
  /** Opens that have passed the cap check but not yet published a session. */
  private reserving = 0

  /**
   * @param ctx - composition context carrying agents, policy, sandbox, subprocess.
   * @param config - resolved configuration.
   */
  constructor(private readonly ctx: Context, private readonly config: Config) {}

  /**
   * Open one terminal for a Session.
   * @param sessionId - the Session the pane belongs to.
   * @param cols - requested grid width, already bounded by the route layer.
   * @param rows - requested grid height, already bounded by the route layer.
   * @param choice - the confinement the pane asked for; omitted uses the deployment's own.
   * @returns the published terminal, or the refusal to show.
   */
  async open(sessionId: string, cols: number, rows: number, choice?: TerminalModeChoice): Promise<TerminalOpenResult> {
    if (this.records.size + this.reserving >= this.config.maxSessions) {
      return failure('limit-reached', `at most ${String(this.config.maxSessions)} terminals may be live at once`)
    }
    // Reserve before the first await so two callers cannot both pass the cap.
    this.reserving += 1
    try {
      const resolved = await resolveTerminalTarget(this.ctx, this.config, sessionId, choice)
      if (!resolved.ok) return failure(resolved.code, resolved.message)
      const { target } = resolved
      const handle = await this.ctx.subprocess.spawnTerminal({
        argv: [...target.argv],
        cwd: target.cwd,
        env: { TERM: 'xterm-256color', DSH_SHELL: '1', DSH_SESSION_ID: sessionId },
        rows,
        cols,
        graceMs: TERMINAL_GRACE_MS,
      })
      const id = randomBytes(16).toString('hex')
      const emulator = new ScreenEmulator(
        cols,
        rows,
        this.config.scrollbackLines,
        this.config.vtReplies ? (data) => { void handle.write(data) } : undefined,
      )
      const record: TerminalRecord = {
        id,
        sessionId,
        agentId: target.agent.id,
        cols,
        rows,
        sandbox: target.sandbox,
        handle,
        emulator,
        writers: new Set<ServerResponse>(),
        seq: 0,
        lastFrame: undefined,
        status: { kind: 'running' },
        frameTimer: undefined,
        graceTimer: undefined,
        idleTimer: undefined,
        lifeTimer: undefined,
        inputWindowStartedAt: Date.now(),
        inputWindowBytes: 0,
        closed: false,
      }
      this.records.set(id, record)
      handle.output.on('data', (chunk: Buffer) => { this.onOutput(record, chunk.toString('utf8')) })
      handle.output.on('error', () => { /* the exit path reports the outcome */ })
      void handle.done.then(
        outcome => { this.onExit(record, { kind: 'exited', exitCode: outcome.exitCode, signal: outcome.signal }) },
        () => { this.onExit(record, { kind: 'exited', exitCode: null, signal: null }) },
      )
      this.armIdle(record)
      if (this.config.maxLifeMs > 0) {
        record.lifeTimer = setTimeout(() => { void this.close(record.id, 'lifetime reached') }, this.config.maxLifeMs)
      }
      this.log('open', { terminal: id, session: sessionId, mode: target.sandbox.mode })
      return {
        ok: true,
        terminalId: id,
        shell: target.argv[0] ?? '',
        cols,
        rows,
        sandbox: target.sandbox,
      }
    } catch (error) {
      return failure('shell-unavailable', error instanceof Error ? error.message : String(error))
    } finally {
      this.reserving -= 1
    }
  }

  /**
   * Attach one response as a frame reader, sending the current screen at once.
   * @param id - the terminal to read.
   * @param res - the streaming response to write frames to.
   * @returns false when no such terminal exists, so the caller can answer 404.
   */
  attach(id: string, res: ServerResponse): boolean {
    const record = this.records.get(id)
    if (record === undefined) return false
    if (record.graceTimer !== undefined) {
      clearTimeout(record.graceTimer)
      record.graceTimer = undefined
    }
    record.writers.add(res)
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    res.on('close', () => { this.detach(record, res) })
    if (record.status.kind === 'exited') {
      // A reconnecting pane learns the shell is gone instead of waiting forever.
      this.send(record, res, { kind: 'status', status: record.status })
      return true
    }
    const payload = this.serialize(record)
    if (payload !== undefined) {
      record.seq += 1
      record.lastFrame = payload
      this.send(record, res, payload)
    }
    return true
  }

  /**
   * Write input bytes into one terminal.
   * @param id - the terminal to write to.
   * @param data - the bytes to deliver, as text.
   * @returns the refusal, or undefined on success.
   */
  async input(id: string, data: string): Promise<TerminalFailure | undefined> {
    const record = this.check(id)
    if (record === undefined) return failure('unknown-terminal', `no terminal ${id}`)
    if (data.length > MAX_INPUT_LENGTH) return failure('bad-request', 'input payload is too long')
    const now = Date.now()
    if (now - record.inputWindowStartedAt >= INPUT_WINDOW_MS) {
      record.inputWindowStartedAt = now
      record.inputWindowBytes = 0
    }
    record.inputWindowBytes += Buffer.byteLength(data)
    if (record.inputWindowBytes > this.config.maxInputBytesPerSecond) {
      return failure('rate-limited', 'input rate exceeded')
    }
    this.armIdle(record)
    await record.handle.write(data)
    return undefined
  }

  /**
   * Deliver one signal to a terminal's foreground group.
   * @param id - the terminal to signal.
   * @param signal - the signal to deliver.
   * @returns the refusal, or undefined on success.
   */
  async signal(id: string, signal: SubprocessTerminalSignal): Promise<TerminalFailure | undefined> {
    const record = this.check(id)
    if (record === undefined) return failure('unknown-terminal', `no terminal ${id}`)
    if (record.status.kind === 'exited') return failure('unknown-terminal', `terminal ${id} has exited`)
    await record.handle.signalForeground(signal)
    return undefined
  }

  /**
   * Close one terminal and forget it.
   * @param id - the terminal to close.
   * @param reason - diagnostic reason recorded in the log.
   */
  async close(id: string, reason = 'closed by request'): Promise<void> {
    const record = this.records.get(id)
    if (record === undefined) return
    this.log('close', { terminal: id, session: record.sessionId, reason })
    await this.terminate(record)
  }

  /** Stop every terminal this service started. */
  async dispose(): Promise<void> {
    const records = [...this.records.values()]
    await Promise.all(records.map(async record => { await this.terminate(record) }))
  }

  /** How many terminals are live right now, for tests and diagnostics. */
  get size(): number {
    return this.records.size
  }

  /**
   * Resolve a live terminal, re-checking that its Session is still owned by the
   * Agent that opened it.
   * @param id - the terminal id from the wire.
   * @returns the record, or undefined when it is unknown or orphaned.
   */
  private check(id: string): TerminalRecord | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    const agent = this.ctx.agents.get(record.agentId as Parameters<Context['agents']['get']>[0])
    if (agent === undefined) return undefined
    return record
  }

  /**
   * Feed one output chunk into the emulator and schedule a frame.
   * @param record - the terminal that produced the bytes.
   * @param text - the decoded chunk.
   */
  private onOutput(record: TerminalRecord, text: string): void {
    if (record.closed) return
    this.armIdle(record)
    void record.emulator.write(text).then(
      () => { this.scheduleFrame(record) },
      () => { /* a failed write surfaces on the frame path, not here */ },
    )
  }

  /** Arm the frame timer if one is not already pending and someone is reading. */
  private scheduleFrame(record: TerminalRecord): void {
    if (record.closed || record.frameTimer !== undefined || record.writers.size === 0) return
    record.frameTimer = setTimeout(() => {
      record.frameTimer = undefined
      this.flush(record)
    }, this.config.frameIntervalMs)
  }

  /** Serialize the screen and broadcast it when it changed. */
  private flush(record: TerminalRecord): void {
    if (record.closed || record.writers.size === 0) return
    const payload = this.serialize(record)
    if (payload === undefined) return
    if (payload === record.lastFrame) return
    record.seq += 1
    record.lastFrame = payload
    this.broadcast(record, payload)
  }

  /**
   * One frame, serialized and bounded — never letting an emulator fault escape
   * into a timer callback, where it would take the host process down.
   * @param record - the terminal to serialize.
   * @returns the serialized frame, or undefined once a failure was reported.
   */
  private serialize(record: TerminalRecord): string | undefined {
    try {
      return JSON.stringify(this.boundFrame(record.emulator.serialize(record.seq + 1, this.config.color)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log('frame-failed', { terminal: record.id })
      this.broadcast(record, JSON.stringify({ kind: 'error', message }))
      void this.close(record.id, 'screen serialization failed')
      return undefined
    }
  }

  /**
   * Keep one frame inside the configured byte ceiling by dropping rows from the
   * top: the newest lines and the cursor are what a reader needs.
   * @param frame - the serialized screen.
   * @returns the frame, or a top-trimmed version of it.
   */
  private boundFrame(frame: TerminalScreenFrame): TerminalScreenFrame {
    if (Buffer.byteLength(JSON.stringify(frame)) <= this.config.frameMaxBytes) return frame
    const keepFrom = Math.max(0, frame.cursor.y - 1)
    return {
      ...frame,
      rows: frame.rows.slice(keepFrom),
      ...(frame.runs === undefined ? {} : { runs: frame.runs.slice(keepFrom) }),
    }
  }

  /**
   * Write one serialized frame to every reader, dropping readers that stopped
   * reading rather than buffering their backlog.
   * @param record - the terminal whose frame this is.
   * @param payload - the serialized frame.
   */
  private broadcast(record: TerminalRecord, payload: string): void {
    for (const writer of [...record.writers]) {
      if (writer.writableLength > this.config.clientBufferMaxBytes) {
        // A reader that cannot keep up is dropped: buffering a shell's output
        // forever is how a pane becomes a memory exhaustion.
        this.log('drop-slow-reader', { terminal: record.id })
        record.writers.delete(writer)
        writer.destroy()
        continue
      }
      this.send(record, writer, payload)
    }
    if (record.writers.size === 0 && record.status.kind === 'running') this.armGrace(record)
  }

  /**
   * Write one already-serialized frame to one reader.
   * @param record - the terminal the frame belongs to.
   * @param res - the reader.
   * @param frame - the frame, or its serialized form.
   */
  private send(record: TerminalRecord, res: ServerResponse, frame: TerminalFrame | string): void {
    if (res.writableEnded || res.destroyed) {
      record.writers.delete(res)
      return
    }
    const payload = typeof frame === 'string' ? frame : JSON.stringify(frame)
    res.write(`data: ${payload}\n\n`)
  }

  /**
   * One reader left: keep the terminal for the grace period, then close it.
   * @param record - the terminal nobody reads.
   */
  private armGrace(record: TerminalRecord): void {
    if (record.closed || record.graceTimer !== undefined) return
    record.graceTimer = setTimeout(() => {
      record.graceTimer = undefined
      void this.close(record.id, 'no reader attached')
    }, this.config.detachGraceMs)
  }

  /** Restart the idle timer, which closes a terminal nobody is using. */
  private armIdle(record: TerminalRecord): void {
    if (record.idleTimer !== undefined) clearTimeout(record.idleTimer)
    if (this.config.idleTimeoutMs === 0) return
    record.idleTimer = setTimeout(() => {
      record.idleTimer = undefined
      void this.close(record.id, 'idle')
    }, this.config.idleTimeoutMs)
  }

  /** Forget one reader, starting the grace period when the last one leaves. */
  private detach(record: TerminalRecord, res: ServerResponse): void {
    record.writers.delete(res)
    if (record.writers.size === 0) this.armGrace(record)
  }

  /**
   * Report a terminal's exit to its readers and release it.
   * @param record - the terminal that exited.
   * @param status - the status to report.
   */
  private onExit(record: TerminalRecord, status: TerminalStatus): void {
    if (record.closed) return
    record.status = status
    this.log('exit', {
      terminal: record.id,
      session: record.sessionId,
      code: status.kind === 'exited' ? String(status.exitCode ?? 'signal') : 'running',
    })
    for (const writer of [...record.writers]) this.send(record, writer, { kind: 'status', status })
    this.release(record)
  }

  /**
   * Terminate one terminal and drop every resource attached to it.
   * @param record - the terminal to release.
   */
  private async terminate(record: TerminalRecord): Promise<void> {
    if (record.closed) return
    record.closed = true
    this.records.delete(record.id)
    this.clearTimers(record)
    for (const writer of [...record.writers]) {
      record.writers.delete(writer)
      if (!writer.writableEnded) writer.end()
    }
    try {
      await record.handle.terminate()
    } finally {
      record.emulator.dispose()
    }
  }

  /** Drop one record's timers. */
  private clearTimers(record: TerminalRecord): void {
    for (const timer of [record.frameTimer, record.graceTimer, record.idleTimer, record.lifeTimer]) {
      if (timer !== undefined) clearTimeout(timer)
    }
    record.frameTimer = undefined
    record.graceTimer = undefined
    record.idleTimer = undefined
    record.lifeTimer = undefined
  }

  /** Release an exited terminal without terminating it again. */
  private release(record: TerminalRecord): void {
    if (record.closed) return
    record.closed = true
    this.records.delete(record.id)
    this.clearTimers(record)
    for (const writer of [...record.writers]) {
      record.writers.delete(writer)
      if (!writer.writableEnded) writer.end()
    }
    record.emulator.dispose()
  }

  /**
   * Audit one lifecycle event: ids and reasons only, never terminal content.
   * @param event - the event name.
   * @param fields - identifying fields.
   */
  private log(event: string, fields: Record<string, string | number>): void {
    this.ctx.logger.info(`gui-terminal ${event} ${JSON.stringify(fields)}`)
  }
}
