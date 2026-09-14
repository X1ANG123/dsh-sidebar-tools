---
description: "What the sidebar tools layer adds to a dsh --profile surface: a sandboxed terminal pane and an embedded browser pane in the right Sidebar, plus the host routes that keep them local."
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-sidebar-tools

English | [中文](README.zh.md)

## Summary

This layer adds two tab types to the Web GUI's right Sidebar: a terminal running a real PTY inside the Session's sandbox, and a browser pane embedding a page beside the conversation. The terminal scrolls back through the host's retained lines, copies its output, and picks its own confinement; the browser searches or opens an address and loads the page credential-less, so the site never receives this browser's cookies. The package inserts one row — its own — so a profile that installs it gains both panes and the host routes behind them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

A literal, step-by-step walkthrough — every step with what you should see — ships beside this file in the published bundle (`QUICKSTART.md`); the sections below are the reference.

### Requirements

- DSH with the Web composition (`dsh web`), and a Chromium-based browser for the frame's credential-less isolation — another engine gets the stricter opaque-origin frame instead, and the pane says so.
- For the terminal: `pwsh`, `powershell`, or `bash` on `PATH`. On Windows the deployment's sandbox back end reports `partial` enforcement.
- For the checkout path below: Node and pnpm, as the repository's own `package.json` requires.

### Install into a profile

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-client-ui-sidebar-tools
dsh plugin --profile <name> remove @deepseek-ai/dsh-client-ui-sidebar-tools
```

`dsh plugin` forwards to pnpm in the profile directory, and this package declares `dsh.bundle`, so the install links it into the profile, appends it to `dsh.profile.bundles`, and activates `cordis.patch.yml` as the last layer before the profile's own patch. The row resolves from the installed package directory, which is why the patch names the package rather than a repository path. A package without `dsh.bundle` still installs, but activates no layer and warns.

From a checkout, `pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle` then `pnpm pack` produces one tarball carrying `lib/index.js`, `lib/client.js`, the declarations, and the patch; `dsh plugin --profile <name> add ./<tarball>` installs that prebuilt artifact, so no build permission is requested. Publishing to a registry works the same way. **A local install of this package needs network access**: its dependencies use the workspace protocol, which pnpm replaces with versions resolved from the registry at install time.

### Install from a checkout

1. Build what a checkout serves. The host half and the client half are separate products:

   ```text
   pnpm install
   pnpm run build:lib:host
   pnpm run build:lib:client
   pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle
   pnpm --filter @deepseek-ai/dsh-web-frontend run build
   ```

2. Activate the layer. `packages/bundle/web-app/cordis.patch.yml` already lists this package, so a `dsh web` started from the checkout has it. Any other composition adds the row itself — in `$DSH_HOME/cordis.patch.yml`, or in the profile's own patch, which is applied after the bundle layers:

   ```yaml
   - insert:
       - id: ui-sidebar-tools
         name: '@deepseek-ai/dsh-client-ui-sidebar-tools'
   ```

3. Restart, then refresh, according to what changed:

   | Change | What it needs |
   |---|---|
   | `src/host/**`, `src/index.ts`, `src/config.ts` | Restart the host: the loader caches modules by specifier, so the new host half is only loaded at boot |
   | `src/client/**` | `pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle`, then a hard refresh — the client bundle is served from disk |
   | `packages/client/**` library sources (e.g. `ui-primitives`) | `pnpm run build:lib:client` **and** `pnpm --filter @deepseek-ai/dsh-web-frontend run build`, then a hard refresh |
   | `cordis.patch.yml` / a profile patch | Live: the patch watcher reloads user patch files, but not bundle patches |

### Turn the panes on

Open the right Sidebar. Its guide page lists **Terminal** and **Browser** after **Files**; picking one opens a tab in that pane, and picking either again opens another tab rather than focusing the one already there. The panel holds up to two panes, so a terminal and a page can sit side by side. Nothing else needs enabling: the terminal's host routes come up with the host half, and the browser pane is pure client code.

### Check that it loaded

- Request `GET /gui-terminal/token` on the GUI's own origin from the browser's console: `401`/`403` is the trust fence refusing an untrusted caller, and a token body means the host half is live; `404` means it is not loaded at all.
- The Sidebar's guide page shows the two extra entry boxes.
- Opening **Terminal** starts a shell in the Session's workspace; opening **Browser** shows the address bar with *Search or type a URL*.

### Configuration

Every value has a default; set only what a deployment wants to differ, in the profile's own patch. A row's `config` replaces the row's whole configuration, not a merged subset.

```yaml
- id: ui-sidebar-tools
  config:
    mode: read-only              # read-only | workspace-write | session | danger-full-access
    allowRemote: false           # loopback callers only, unless a deployment opts in
    shellPath: ''                # absolute shell; empty resolves pwsh/powershell or $SHELL/bash
    shellArgs: []                # extra argv; empty means this platform's quiet defaults
    defaultCols: 100             # grid requested when the pane reports no size
    maxCols: 400                 # largest accepted column request
    defaultRows: 30
    maxRows: 200
    frameIntervalMs: 40          # screen frames are coalesced to at most one per interval
    frameMaxBytes: 262144        # serialized frame ceiling; rows past it are dropped
    clientBufferMaxBytes: 524288 # a reader past this is dropped, never buffered further
    detachGraceMs: 15000         # how long a terminal survives its last reader leaving
    idleTimeoutMs: 3600000       # how long it survives with no input and no output
    maxLifeMs: 28800000          # absolute lifetime of one terminal
    maxSessions: 8               # live terminals across the process
    maxOpensPerMinute: 10        # open requests per minute per caller address
    maxInputBytesPerSecond: 262144
    csrfTokenTtlMs: 3600000      # lifetime of one CSRF token
    csrfTokenMaxEntries: 64
    scrollbackLines: 1000        # how far the pane can scroll back
    color: true                  # carry SGR color runs in frames
    vtReplies: true              # answer terminal queries; pwsh's line editor needs them
```

`mode` narrows, never widens: whatever it asks for is clamped to the Session's own mode, so a terminal is never broader than the Session it was opened from. Setting `mode: session` follows the Session exactly, including a `danger-full-access` one. The pane's own mode picker narrows the same way at run time and can never widen past the Session.

### How to apply a configuration

1. Find the patch that applies last. A profile's own patch is `<profile directory>/cordis.patch.yml` — the directory `dsh plugin --profile <name>` installs into — and a whole installation may also use `$DSH_HOME/cordis.patch.yml`. Layers apply in order: this package's bundle patch first, the user patch file after it, so the user file wins.
2. Write or extend the row. **A row's `config` replaces the row's whole configuration** rather than merging with it, so repeat every value you want to keep — anything left out falls back to this package's defaults:

   ```yaml
   - id: ui-sidebar-tools
     config:
       mode: read-only
       scrollbackLines: 5000
   ```

3. Save, and restart if the row is new. The patch watcher reloads *user* patch files live, so editing an existing row takes effect without a restart; adding the row for the first time is a boot-time change, because the host half only loads at boot.
4. Check what actually took. Two options log a line at startup — `allowRemote` and `mode: danger-full-access` — and the terminal header always shows the mode the host really enforced, which is the clamped result rather than the value written.

The changes people ask for first:

| Want | Set |
|---|---|
| A terminal that cannot write | `mode: read-only` |
| A terminal as broad as its Session | `mode: session` |
| Keep 5000 lines of scrollback | `scrollbackLines: 5000` |
| Git Bash on Windows | `shellPath: 'C:\Program Files\Git\bin\bash.exe'`, `shellArgs: ['--login', '-i']` |
| zsh on macOS | `shellPath: /bin/zsh` |
| Reach the GUI from another machine | `allowRemote: true` — see below |

`allowRemote: true` answers every caller that can reach the port with a shell, so keep the Web server bound to loopback or put an authenticating proxy in front of it. The browser pane has no configuration of its own: its sandbox, its credential-less load, and its address policy are constants of the security posture rather than settings. A deployment that wants different ones changes the code, not a config file.

### What you get

| Row | Behaviour owner |
|---|---|
| `ui-sidebar-tools` (this package) | The `terminal` and `browser` tab types, their stores, their transport, and the host routes the terminal drives |

The terminal pane carries its own transport: the host emulates the screen and streams it, so the browser needs no terminal renderer. The browser pane is pure client code — it adds no host route at all; the one route that carries its tab chip's logo is the host's own lookup, not a proxy for the page.

**License:** MIT, the same license as the repository this package lives in ([LICENSE](../../../LICENSE)). A published copy carries the same terms.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`cordis.patch.yml` holds one insert row, naming this package:

```yaml
- insert:
    - id: ui-sidebar-tools
      name: '@deepseek-ai/dsh-client-ui-sidebar-tools'
```

The patch carries no `config:` and no expressions, so a reviewer reads the whole layer in one line. A row's `config` replaces the row's whole configuration, not a merged subset.

| Source | What it owns |
|---|---|
| [`src/index.ts`](src/index.ts) | The host plugin body: the service, the tokens, the limiter, and the two boot warnings |
| [`src/config.ts`](src/config.ts) | The configuration schema and every default |
| [`src/shared.ts`](src/shared.ts) | Route paths, wire frames, and the bounds the routes enforce |
| [`src/host/security.ts`](src/host/security.ts) | The loopback test, CSRF tokens, the rate limiter, and bounded body readers |
| [`src/host/session.ts`](src/host/session.ts) | Session → Agent → confinement, and the never-widen rule |
| [`src/host/emulator.ts`](src/host/emulator.ts) | The headless emulator and the screen serializer |
| [`src/host/terminals.ts`](src/host/terminals.ts) | Live terminals, frame coalescing, and every limit |
| [`src/host/routes.ts`](src/host/routes.ts) | The six routes, each behind all three gates |
| [`src/client/index.ts`](src/client/index.ts) | The two tab types, their dictionaries, and their bodies |

### Security model

Three gates guard every request, in order: the composition's browser-trust fence (`ctx.connection.requestRejection`, which refuses a rebound Host, a cross-site initiator, and an opaque `Origin`), a loopback check that keeps a host shell local, and a per-page CSRF token for mutating calls. Bodies must be `application/json`, are read against a 64 KiB ceiling, and are parsed strictly; identifiers must match the Session-id shape; a terminal is a 128-bit capability that is re-checked against its live Agent on every call.

The embedded frame is granted `allow-forms allow-scripts allow-same-origin allow-popups`: a real page needs its own origin to keep storage, call its own API, and hold a session, and a page's links are the page's business, so a `target="_blank"` link opens the way its author intended — a popup inherits this sandbox, so it is never a way out of it. That grant is paired with two other facts. The web server refuses to be framed at all (`x-frame-options: DENY`, `content-security-policy: frame-ancestors 'none'`), so a page that navigated its frame here could not inherit this app's own routes — the one path the origin grant would otherwise open. And the frame is loaded credential-less wherever the engine supports it, so the site never receives this browser's cookies and its storage is a partition that dies with the document; an engine without that support gets the opaque-origin sandbox instead (`allow-forms allow-scripts`), and the pane says so. The pane still refuses to frame this interface's own origin, never proxies or injects, carries no `postMessage` bridge, and grants no sandbox escape: top-level navigation, modals, and downloads all stay out. Pages that refuse to be embedded still cannot be shown, and a login never survives in the pane because no cookie is ever sent; the pane offers the system browser for both.

The terminal runs the Session's workspace as its working directory, under the Session's confinement, with credentials scrubbed from its environment by the subprocess provider. The sandbox is a file-effect boundary, not a privilege boundary: it governs writes, not network reach or process visibility, and the Windows ACL backend reports `partial` enforcement. The pane shows the effective mode and how completely the host enforces it. Output is text a reader owns: the header's copy control puts everything the pane retains on the clipboard, and Control+C copies a selection — with nothing selected it stays the interrupt a terminal has always sent.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Right Sidebar](../../../docs/subsystems/sidebar-right.md) — the docking surface, tab-type registry, and the seats this package registers into
- [Sandbox](../../../docs/subsystems/sandbox.md) — the file-effect modes, per-call policy, and enforcement reporting
- [Subprocess](../../../docs/subsystems/subprocess.md) — the terminal-process primitive and `spawnTerminal`
- [Web Client Slots](../../../docs/subsystems/slots.md) — how a body reaches `sidebar.right.pane.tab`
- [Web UI style reference](../../../docs/web-styling.md) — tokens, primitives, and the pane grammar

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, no command, and no session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Scrollback stops where the host's buffer does.** The pane keeps the lines the host's `scrollback` retains and draws them above the live screen; older lines are gone, and a full-screen program (`vim`, `top`) owns the pane and keeps no history.
- **Fixed grid size.** A terminal's columns and rows are fixed when it is opened: the subprocess terminal primitive has no resize, so narrowing the pane does not reflow the shell.
- **Both tab chips are live.** The terminal's follows the shell's status, and the browser's names the page it is showing — the site's own logo, fetched by this host rather than by the browser so no cookie or referrer ever reaches the site: `/favicon.ico` and the other well-known paths first, then the icons the page declares, through a bounded redirect chain re-checked at every hop, never a private address, image bytes only, cached. A site whose logo the host cannot vouch for shows its name alone — the pane invents no icon.
- **The pane cannot see inside the page it frames.** A cross-origin frame exposes neither its `<title>` nor its DOM, so the chip names the host rather than the page, and a link the page opens in a new window is opened by the browser, not redirected into the pane. A site that refuses framing (`X-Frame-Options`, `frame-ancestors`) cannot be shown at all; the pane says so and offers the system browser.
- **Each pick on the guide page opens a new tab.** Both types declare `opensNewTab`, so a second Terminal or Browser pick is a second tab rather than a focus on the one already there. A terminal's grid is fixed at open, so open a new one after resizing the pane.
- **Content actions live in the pane header,** not in the `sidebar.right.tab.menu.item` seat.
- **This interface's own origin cannot be framed,** by design: the web server answers every request with `x-frame-options: DENY` and `frame-ancestors 'none'`.
- **A login never survives in the pane,** by design: the frame loads credential-less, so the site receives no cookie at all.
- The patch ships no configuration: a deployment that wants a different `mode` writes it in its own profile patch.
- **A site that refuses framing cannot be shown at all.** `X-Frame-Options` and `frame-ancestors` are the site's own decision, and no browser renders such a page inside a frame; the pane says so and offers the system browser. Rendering it in the pane needs a top-level browsing context (the desktop shell's `webview`), which a web page cannot create.
- **A link the page opens in a new window cannot be pulled into the pane.** A cross-origin frame exposes no DOM, no click handler, and no handle on the popup it creates; the sandbox can only allow popups or block them. Same-frame links do stay in the pane, and blocking would open nothing at all — which is why popups are allowed.
- **The chip cannot show the page's own title.** A cross-origin frame exposes neither its `<title>` nor its DOM, so the chip names the host instead.
- **The framed page cannot download a file or open a modal.** The sandbox grants neither `allow-downloads` nor `allow-modals`, so those actions do nothing.
- **The logo lookup resolves and pins the address it connects to.** A hostname that is textually private is refused, every DNS answer must be a public address, and the socket is pinned to the address that was checked — so a name that re-resolves after the check cannot reach the reader's own network or a cloud metadata address through this route. A private origin the reader opened themselves is exempt, and a site whose logo the host still cannot vouch for shows its name alone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The screen reader uses `@xterm/headless`'s proposed buffer API — the only way to see the rendered screen — and reads the engine's color modes and palette directly. The package pins the engine through the lockfile, and two specs guard an upgrade: `tests/emulator.host.spec.ts` asserts the serialized screen, and the `terminalCellStyle` parity spec asserts that a cell painted here resolves to the same style a tool-result card gives the same color.

A host-half change needs a fresh module URL to be picked up without a restart: the loader caches by specifier, so a live trial points its patch row at a revisioned copy of `lib/index.js`.

### Tests and gates

```text
pnpm exec vitest run packages/client/ui-sidebar-tools/tests
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsc -b tsconfig.client.json
```

</details>
