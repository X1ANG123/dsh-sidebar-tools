---
description: "这个侧栏工具层为 dsh --profile 提供的组合层：右侧 Sidebar 中一个沙箱内的终端 pane 与一个内嵌浏览器 pane，以及让它们只服务本机的主机路由。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-sidebar-tools

[English](README.md) | 中文

## Summary

这个层为 Web GUI 的右侧 Sidebar 增加两个 tab 类型：一个运行在会话沙箱内的真实 PTY 终端，以及一个在对话旁内嵌网页的浏览器 pane。终端可以回看主机保留的行、复制自己的输出，并自行挑选受限程度；浏览器既能搜索也能直接打开地址，并以 credential-less 方式加载页面，因此站点永远拿不到这个浏览器的 cookie。本包只插入一行——它自己——因此安装它的 profile 同时获得两个 pane 与终端背后的主机路由。

## Table of Contents

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

逐条照做的操作手册（每一步都写了“应该看到什么”）随包一起发布，见 `QUICKSTART.md`；下面是参考性说明。

### 前置条件

- 带 Web 组合的 DSH（`dsh web`），以及一个 Chromium 系浏览器，用于 frame 的 credential-less 隔离——其他引擎会改用更严格的不透明 origin 方案，pane 会说明这一点。
- 终端需要 `PATH` 上有 `pwsh`、`powershell` 或 `bash`。Windows 上部署的沙箱后端报告的强制程度是 `partial`。
- 走下面的源码检出路径需要 Node 与 pnpm，版本要求见仓库根 `package.json`。

### 安装进 profile

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-client-ui-sidebar-tools
dsh plugin --profile <name> remove @deepseek-ai/dsh-client-ui-sidebar-tools
```

`dsh plugin` 会把参数转交给 profile 目录里的 pnpm；本包声明了 `dsh.bundle`，因此 安装会把它链接进 profile、追加到 `dsh.profile.bundles`，并把 `cordis.patch.yml` 作为 profile 自身 patch 之前的最后一层激活。该行从已安装的包目录解析，这正是 patch 写包名而不是仓库路径的原因。没有 `dsh.bundle` 的包仍可安装，但不会激活任何 层，并会给出警告。

从源码检出目录出发，`pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle` 再 `pnpm pack` 会产出一个 tarball，内含 `lib/index.js`、`lib/client.js`、类型声明与 patch；`dsh plugin --profile <name> add ./<tarball>` 安装的就是这份预构建产物， 因此不会请求任何构建权限。发布到 registry 同理。**本包在本地安装需要网络**：它的 依赖使用 workspace 协议，pnpm 会在安装时把它们替换为从 registry 解析出的版本。

### 从源码检出安装

1. 构建检出发行的产物。主机半与客户端半是两个独立产品：

   ```text
   pnpm install
   pnpm run build:lib:host
   pnpm run build:lib:client
   pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle
   pnpm --filter @deepseek-ai/dsh-web-frontend run build
   ```

2. 激活这一层。`packages/bundle/web-app/cordis.patch.yml` 已经列出本包，因此从检出启动的 `dsh web` 自带它。其他组合自行加入这一行——写进 `$DSH_HOME/cordis.patch.yml`，或写进 profile 自己的 patch（它在各 bundle 层之后应用）：

   ```yaml
   - insert:
       - id: ui-sidebar-tools
         name: '@deepseek-ai/dsh-client-ui-sidebar-tools'
   ```

3. 按改动内容决定重启还是刷新：

   | 改动 | 需要什么 |
   |---|---|
   | `src/host/**`、`src/index.ts`、`src/config.ts` | 重启主机：loader 按 specifier 缓存模块，新的主机半只在启动时加载 |
   | `src/client/**` | `pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle` 后硬刷新——客户端 bundle 直接从磁盘提供 |
   | `packages/client/**` 的**库**源码（如 `ui-primitives`） | `pnpm run build:lib:client` **以及** `pnpm --filter @deepseek-ai/dsh-web-frontend run build`，再硬刷新 |
   | `cordis.patch.yml` / profile patch | 实时：patch 监听只重载用户 patch 文件，不含 bundle patch |

### 打开这两个 pane

打开右侧 Sidebar。它的 guide 页在「文件」之后列出**终端**与**浏览器**；点其中一个会在该格打开一个 tab，再点同一个会再开一个 tab，而不是聚焦已有的那个。面板最多两格，所以终端与网页可以并排。无需其他开关：终端的主机路由随主机半启动，浏览器 pane 是纯客户端代码。

### 确认它已加载

- 在浏览器控制台请求 GUI 同源的 `GET /gui-terminal/token`：`401`/`403` 是信任围栏在拒绝不可信调用方，返回 token 说明主机半已生效，`404` 则说明它根本没加载。
- Sidebar 的 guide 页出现那两个额外的入口框。
- 打开**终端**会在会话工作区里启动 shell；打开**浏览器**会看到地址栏占位文案「搜索或输入网址」。

### 配置

每个值都有默认值；只设置部署确实想要不同的项，写在 profile 自己的 patch 里。行的 `config` 是整体替换而非合并。

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

`mode` 只会收窄、绝不放宽：无论它要求什么，都会被钳制到会话自身的模式，因此终端 永远不会比它所依附的会话更宽。设 `mode: session` 表示完全跟随会话，包括 `danger-full-access` 的会话。pane 自带的模式选择器在运行时同样只能收窄，永远无法越过会话。

### 怎么改配置

1. 找到最后生效的那份 patch。profile 自己的是 `<profile 目录>/cordis.patch.yml`——也就是 `dsh plugin --profile <name>` 安装到的目录；整个安装也可以用 `$DSH_HOME/cordis.patch.yml`。层的顺序是「先本包的 bundle patch、后用户 patch 文件」，所以用户文件覆盖默认值。
2. 写入或扩展该行。**行的 `config` 是整体替换而不是合并**，所以要保留的值必须一并写上；没写的字段回落到本包默认值：

   ```yaml
   - id: ui-sidebar-tools
     config:
       mode: read-only
       scrollbackLines: 5000
   ```

3. 保存；如果是**第一次新增这一行**则重启。patch 监听会实时重载**用户** patch 文件，因此改一个已有行无需重启；新增行是启动期改动，因为主机半只在启动时加载。
4. 核对实际生效的值。有两个选项会在启动日志里各打印一条：`allowRemote` 与 `mode: danger-full-access`；终端表头则始终显示主机**实际强制**的模式——那是钳制后的结果，而不是你写下的值。

最常被问到的几项：

| 想要 | 设置 |
|---|---|
| 一个不能写文件的终端 | `mode: read-only` |
| 终端与会话同样宽 | `mode: session` |
| 回看 5000 行 | `scrollbackLines: 5000` |
| Windows 上用 Git Bash | `shellPath: 'C:\Program Files\Git\bin\bash.exe'`，`shellArgs: ['--login', '-i']` |
| macOS 上用 zsh | `shellPath: /bin/zsh` |
| 让别的机器访问 GUI | `allowRemote: true`——见下 |

`allowRemote: true` 会让每个能连上端口的调用方都拿到 shell，因此请把 Web 服务保持在 loopback，或在前面放一层需要认证的代理。浏览器面板没有任何配置项：它的沙箱、credential-less 加载与地址策略都是安全姿态的常量，而不是可调项；想要不同的行为要改代码，而不是配置文件。

### 你会得到什么

| 行 | 行为归属 |
|---|---|
| `ui-sidebar-tools`（本包） | `terminal` 与 `browser` 两个 tab 类型、它们的 store、它们的传输，以及终端所驱动的主机路由 |

终端 pane 自带传输：由主机做屏幕仿真并推送，因此浏览器端不需要任何终端渲染器。 浏览器 pane 是纯客户端代码——它不新增任何主机路由；唯一为它服务的路由是主机自己取站点图标的那次查询，而不是页面的代理。

**License：** MIT，与本包所在的仓库同一许可（[LICENSE](../../../LICENSE)）；发布出去的副本适用同样的条款。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`cordis.patch.yml` 只有一行插入行，写的是本包：

```yaml
- insert:
    - id: ui-sidebar-tools
      name: '@deepseek-ai/dsh-client-ui-sidebar-tools'
```

patch 不含 `config:`、不含表达式，评审者一行就能读完整个层。行的 `config` 是整体 替换而非合并。

| 源码 | 负责什么 |
|---|---|
| [`src/index.ts`](src/index.ts) | 主机插件主体：服务、令牌、限流器，以及两条启动告警 |
| [`src/config.ts`](src/config.ts) | 配置 schema 与全部默认值 |
| [`src/shared.ts`](src/shared.ts) | 路由路径、帧结构，以及路由强制的各种上限 |
| [`src/host/security.ts`](src/host/security.ts) | loopback 判定、CSRF 令牌、限流器与有界请求体读取 |
| [`src/host/session.ts`](src/host/session.ts) | 会话 → Agent → 沙箱策略，以及「绝不放宽」规则 |
| [`src/host/emulator.ts`](src/host/emulator.ts) | 无头仿真器与屏幕序列化 |
| [`src/host/terminals.ts`](src/host/terminals.ts) | 活动终端、帧合并，以及全部限额 |
| [`src/host/routes.ts`](src/host/routes.ts) | 六个路由，每个都在三道门之后 |
| [`src/client/index.ts`](src/client/index.ts) | 两个 tab 类型、它们的字典与主体 |

### 安全模型

每个请求都按顺序经过三道门：组合层的浏览器信任围栏 （`ctx.connection.requestRejection`，会拒绝被重绑定的 Host、跨站发起方与不透明 `Origin`）、把主机 shell 留在本机的 loopback 判定，以及变更类调用的每页 CSRF 令牌。 请求体必须是 `application/json`，按 64 KiB 上限读取并严格解析；标识符必须匹配会话 id 的形状；一个终端就是一个 128-bit capability，每次调用都会重新对照其活动 Agent 校验。

内嵌 frame 被授予 `allow-forms allow-scripts allow-same-origin allow-popups`：真实页面需要自身 origin 才能保留 storage、调用自己的接口、维持会话；而页面的链接是页面自己的事，因此 `target="_blank"` 链接按作者的本意打开——弹出的窗口继承同一套沙箱，所以它绝不是逃逸通道。这项授权与另外两件事成对存在。web server 拒绝被任何页面内嵌（`x-frame-options: DENY`、`content-security-policy: frame-ancestors 'none'`）：把 frame 导航到本界面的页面因此无法继承本应用自身的路由——这正是授权 origin 否则会打开的那条路径。而 frame 在引擎支持时以 credential-less 方式加载：站点永远拿不到这个浏览器的 cookie，它的存储也是一个随文档销毁的分区；不支持该能力的引擎改用不透明 origin 的沙箱（`allow-forms allow-scripts`），pane 会说明这一点。该 pane 仍然拒绝内嵌本界面自身的 origin，从不代理、从不注入，不带任何 `postMessage` 桥，也不授予任何沙箱逃逸：顶层导航、模态与下载全部排除。拒绝被内嵌的页面仍然无法显示，登录态也永远不会留在 pane 里（因为从不发送 cookie）；两种情况 pane 都提供系统浏览器。

终端以会话工作区为工作目录，在会话的沙箱边界内运行，环境中的凭据由子进程 provider 清除。沙箱是**文件效果**边界，不是权限边界：它管写入，不管网络可达性与进程可见性， 且 Windows ACL 后端报告的强制程度是 `partial`。pane 会显示实际生效的模式与强制程度。输出是读者自己的文本：表头的复制控件把 pane 保留的全部内容放进剪贴板，选中内容后 Ctrl+C 也会复制——没有选中时它仍是终端一直以来发送的中断。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [右侧 Sidebar](../../../docs/subsystems/sidebar-right.zh.md) —— 停靠面、tab 类型注册表，以及本包注册的各个席位
- [沙箱](../../../docs/subsystems/sandbox.zh.md) —— 文件效果模式、按调用解析的策略与强制程度报告
- [子进程](../../../docs/subsystems/subprocess.zh.md) —— 终端进程原语与 `spawnTerminal`
- [Web Client Slots](../../../docs/subsystems/slots.zh.md) —— body 如何进入 `sidebar.right.pane.tab`
- [Web UI 样式参考](../../../docs/web-styling.zh.md) —— token、primitive 与 pane 语法

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, no command, and no session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **回看只到主机缓冲为止。** pane 保留主机 `scrollback` 所留的行，并把它们画在实时屏幕之上；更早的行已经丢弃，而全屏程序（`vim`、`top`）独占 pane，不保留历史。
- **网格尺寸固定。** 终端的行列在打开时确定：子进程终端原语没有 resize，因此把 pane 变窄不会让 shell 重排。
- **两个 tab 的 chip 都是实时的。** 终端的跟随 shell 状态；浏览器的显示它正在展示的页面——站点自己的 logo，由**本主机**代取而不是浏览器直连，因此不会有 cookie 或 referrer 到达站点：先试 `/favicon.ico` 等常见路径，再试页面自己声明的图标，重定向有次数上限且每一跳都重新校验，绝不访问私有地址，只接受图片字节，并带缓存。主机无法确认的站点只显示它的名字——pane 不会自造图标。
- **pane 看不到被内嵌页面内部。** 跨源 frame 既不暴露 `<title>` 也不暴露 DOM，所以 chip 显示的是主机名而不是页面标题；页面自己在新窗口打开的链接由浏览器打开，无法被改到 pane 内。拒绝被内嵌（`X-Frame-Options`、`frame-ancestors`）的站点完全无法显示，pane 会说明并给出系统浏览器入口。
- **在 guide 页每次点选都会新开一个 tab。** 两个类型都声明了 `opensNewTab`，因此第二次点「终端」或「浏览器」是新开一个 tab，而不是聚焦已有的那个。终端网格在打开时固定，所以调整 pane 宽度后请新开一个。
- **内容级动作放在 pane 头部**，而不是 `sidebar.right.tab.menu.item` 席位。
- **本界面自身的 origin 不能被任何页面内嵌**，这是有意为之：web server 对每个响应都返回 `x-frame-options: DENY` 与 `frame-ancestors 'none'`。
- **登录态永远不会留在 pane 里**，这是有意为之：frame 以 credential-less 方式加载，站点根本收不到 cookie。
- 本 patch 不附带任何配置：想要不同 `mode` 的部署在自己的 profile patch 里写。
- **拒绝被内嵌的站点完全无法显示。** `X-Frame-Options` 与 `frame-ancestors` 是站点自己的决定，任何浏览器都不会把它渲染进 frame；pane 会说明并给出系统浏览器入口。要在 pane 内渲染它，需要一个顶层浏览上下文（桌面端的 `webview`），网页无法自行创建。
- **页面自己在新窗口打开的链接无法被拉进 pane。** 跨源 frame 不暴露 DOM、不暴露点击处理，也不给出它创建的弹窗句柄；沙箱只能选择允许或拦掉。同 frame 的链接一直留在 pane 内，而拦掉的结果是什么都不开——所以这里选择允许。
- **chip 拿不到页面自己的标题。** 跨源 frame 既不暴露 `<title>` 也不暴露 DOM，因此 chip 显示的是主机名。
- **被内嵌页面无法下载文件或打开模态框。** 沙箱不授予 `allow-downloads` 与 `allow-modals`，这些操作不会有任何效果。
- **logo 查询会解析并固定它连接到的地址。** 文本上私有的主机名被拒绝，DNS 的每一条解析结果都必须是公网地址，且 socket 固定到已验证的那个地址——因此「检查之后重新解析」的名字无法借这条路由到达读者自己的内网或云元数据地址。读者自己打开的私有 origin 例外；主机仍无法为该站点确认 logo 时只显示站点名。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作上下文——点击展开</summary>

屏幕读取使用 `@xterm/headless` 的 proposed buffer API——这是唯一能看到渲染结果屏幕 的途径——并直接读取引擎的颜色模式与调色板。本包通过 lockfile 固定引擎版本，并由两个 spec 守护升级：`tests/emulator.host.spec.ts` 断言序列化后的屏幕，`terminalCellStyle` 的 parity spec 断言这里画出的单元格与工具结果卡片对同一颜色给出相同样式。

主机半的改动需要一个新的模块 URL 才能在不重启的情况下生效：loader 按 specifier 缓存， 因此本机试用的 patch 行指向 `lib/index.js` 的一个带版本号的副本。

### 测试与门禁

```text
pnpm exec vitest run packages/client/ui-sidebar-tools/tests
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsc -b tsconfig.client.json
```

</details>
