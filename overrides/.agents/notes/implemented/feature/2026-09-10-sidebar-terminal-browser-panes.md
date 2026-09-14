# Agent Note: sidebar terminal and browser panes — a sandboxed shell and an embedded page

Status: implemented

English | [中文](2026-09-10-sidebar-terminal-browser-panes.zh.md)

## Problem

The right Sidebar could show text and a workspace tree, but nothing that runs. A person debugging in the Web GUI had to leave it to get a shell, and reading a web page the agent mentioned meant leaving the browser tab the GUI lives in.

Two features were wanted together, and both had to be safe by default: a real interactive terminal (a full-screen program like `vim` or `top` has to work, not just line output), and an embedded browser. Neither could weaken what the GUI already guarantees, and the terminal in particular had to be as confined as the model's own shell.

## Decision

One dual-face plugin package, `packages/client/ui-sidebar-tools`, contributes two tab types and the host routes behind the terminal.

- **The host emulates, the browser draws.** `@xterm/headless` — already in the tree as the tool-card engine — runs on the host, and each pane receives a serialized visible screen with style runs. The browser needs no terminal renderer at all, which kept the dependency surface at zero and let the pane reuse the palette the output cards already use. Reading the emulated buffer is xterm's *proposed* API; the version is pinned by the lockfile and two specs guard an upgrade.
- **The terminal is never wider than its Session.** The configured mode (default `workspace-write`) is clamped to the Session's own, so a full-access Session still gets a sandboxed pane unless a deployment asks otherwise with `mode: session`. A confined mode with no `ctx.sandbox` provider refuses to start rather than running unconfined. The pane header carries the picker: one click cycles the Mode (the deployment's default, read-only, workspace-write, follow the Session) and restarts the shell, while the chip keeps showing the mode the host actually enforced. `danger-full-access` is not a client choice at all, so the picker can narrow a terminal and never widen it past its Session.
- **The embedded frame is a real browser document, and never a seat in this app.** It is granted forms, scripts, the site's own origin, and popups, because an opaque origin throws on storage access and sends `Origin: null`, which is what made the pane a static shell no site could work in — and because a page's own links are the page's business: a `target="_blank"` link opens the way its author intended, and the popup inherits this sandbox. What keeps that safe is the other half of the pair: this interface refuses to be framed at all, so a page cannot navigate its frame here and inherit the app's own routes. There is no `postMessage` bridge, no proxy, and no injection, and no sandbox escape. The frame also loads credential-less wherever the engine supports it, so the site receives none of this browser's cookies and keeps no storage of its own; an engine without that support gets the opaque-origin sandbox instead, and the pane says so. The browser tab's chip names the framed page with a logo the host fetches itself — resolving the name there, refusing any answer that is not a public address, and pinning the socket to the address it checked, so a name that re-resolves cannot aim this process at the reader's own network — `/favicon.ico` and the other well-known paths first, then the icons the page declares, with no credentials, a bounded redirect chain re-checked at every hop, a byte ceiling, image bytes only, never a private address, cached — because a browser-side `<img>` would carry the site's cookies and an anonymous one needs CORS the site does not grant.
- **The pane shell is shared, not copied.** The files pane's body, header, icon control, and blocked-state lines were lifted into `ui-primitives` as `PaneBody`, `PaneHeader`, `PaneIconButton`, `PaneStatus`, and `PaneStatusLine`, and `ui-sidebar-files` was migrated onto them. Copying the CSS would have made the panes agree once and drift afterwards; two packages that need one control is exactly when it belongs in the shared owner.
- **The palette has one source.** `terminalCellStyle` resolves a cell's colors from the same tables `parseAnsiLines` uses, so a live pane and a tool-result card render one command identically.

## Security considerations

Three gates guard every route, in order: the composition's browser-trust fence, a loopback check (`allowRemote: false` by default, because the pane hands out a host shell), and a per-page CSRF token carried in a header for mutating calls. Bodies must be `application/json`, are read against a 64 KiB ceiling, and are parsed strictly; identifiers must match the Session-id shape. A terminal is a 128-bit capability, re-checked against its live Agent on every call, and the stream route needs no token because it is read-only and the URL must not carry a secret. The embedded frame and the app's own origin are one pair: the frame keeps the site's own origin so a real page works at all, and this interface refuses to be framed (`x-frame-options: DENY`, `content-security-policy: frame-ancestors 'none'` on every response), so that grant cannot be turned into a same-origin seat inside the app.

The terminal's argv is built entirely from configuration and `ctx.subprocess.resolveExecutable`; the browser can only write bytes into a PTY, never a command line. On Windows the default `pwsh` argv also silences PSReadLine's history file, so a confined shell does not fail on a profile it cannot write. Output stays the reader's text: the header copies everything the pane retains, and Control+C copies a selection while interrupting when nothing is selected. Terminal output is rendered as text nodes — a frame containing markup stays literal — and the package registers no tool, no command, and no session event, so a prompt-injected model cannot reach the pane and shell output never enters the session log.

A reader that cannot keep up is dropped rather than buffered, and one terminal's serializer fault is reported and closed rather than thrown out of a timer.

## UI consistency

The two panes compose the shared pane primitives, so padding, type scale, header grammar, icon control, and blocked-state layout are the files pane's by construction. A change to `PaneBody` moves both. The terminal grid stays on the panel's ground rather than becoming a raised card, matching the rule that the panel is a column of the page.

## Testing

`tests/security.spec.ts` covers the primitives, `tests/terminal-routes.spec.ts` drives every route through its gates, `tests/session.spec.ts` pins the clamp table and the fail-closed path, `tests/emulator.spec.ts` asserts the serialized screen against the real engine, and the client specs pin the key map, the address policy, and the frame's isolation from the source. The files pane's own thirteen specs pass unchanged after the migration.

## Alternatives considered

**A renderer in the browser (xterm.js on the client).** It would have kept the emulator and the view in one place, but it adds a second terminal engine to the browser bundle, and the pane could then only draw what the client itself received — the host already emulates every terminal for the tool-result cards, so reusing that engine kept the dependency surface at zero.

**A reverse proxy for the browser pane.** Proxying the framed site would let the pane rewrite headers and would hide the site's own address, but it would also make the host an open proxy for arbitrary URLs, put the GUI's own origin back in front of untrusted content, and hand a prompt-injected model a request forger. The frame keeps the site's own origin instead, which is sound only because this interface refuses to be framed.

**Copying the files pane's CSS into the new pane.** Cheaper for one afternoon, and it would have looked right on the day. It also guarantees drift the first time either pane changes; lifting the shell into `ui-primitives` and migrating the files pane onto it costs one migration and makes agreement structural.

**Shipping the terminal with no mode picker,** configured only. Fewer states to explain, but a person debugging a prompt-injection report would have to edit a profile and restart the host to narrow a shell that is already open. The picker only narrows within the Session and never widens it, so it adds reach without adding authority.

## Consequences

A terminal's grid is fixed when it opens (the terminal primitive has no resize), the pane keeps the lines the host's buffer retains and drops older ones, and content actions live in the pane header rather than the tab-menu seat. A site that refuses to be embedded still cannot be shown, and no login survives in the frame because it loads credential-less; the pane offers the system browser for both.

Two things are recorded here as facts rather than plans, because a web page cannot do them at all: a site that refuses framing cannot be rendered inside a pane, and a `target="_blank"` link inside a cross-origin frame cannot be redirected into it — the frame exposes no DOM, no click handler, and no popup handle, so only a top-level browsing context (the desktop shell) could do either.
