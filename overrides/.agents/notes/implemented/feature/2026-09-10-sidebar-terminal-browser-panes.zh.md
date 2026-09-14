# Agent Note：侧栏终端与浏览器 pane —— 一个沙箱内的 shell 与一个内嵌页面

Status: implemented

[English](2026-09-10-sidebar-terminal-browser-panes.md) | 中文

## Problem

右侧 Sidebar 能显示文本与工作区文件树，却没有任何能“跑起来”的东西。在 Web GUI 里 调试的人必须离开界面才能拿到 shell，而要读 agent 提到的网页，又得离开 GUI 所在的 浏览器标签页。

两个功能要一起做，而且都必须默认安全：一个是真正的交互式终端（`vim`、`top` 这类 全屏程序必须能用，不能只支持行输出），另一个是内嵌浏览器。两者都不能削弱 GUI 已有 的保证，终端尤其必须和模型自己的 shell 一样受限。

## Decision

一个双面包 `packages/client/ui-sidebar-tools` 贡献两个 tab 类型，以及终端背后的主机路由。

- **主机做仿真，浏览器只负责画。** 已经在树里的 `@xterm/headless`（工具卡片用的同一个 引擎）跑在主机上，每个 pane 收到的是序列化后的可见屏幕与样式分段。浏览器端因此完全 不需要终端渲染器：依赖面保持为零，pane 也得以复用输出卡片已有的调色板。读取仿真 buffer 属于 xterm 的 *proposed* API；版本由 lockfile 固定，并由两个 spec 守护升级。
- **终端永不比它的会话更宽。** 配置的模式（默认 `workspace-write`）会被钳制到会话自身的 模式，因此即使是完全访问的会话，默认拿到的仍是沙箱内的 pane——除非部署显式要求 `mode: session`。处于受限模式却没有 `ctx.sandbox` provider 时，终端拒绝启动，而不是 在无沙箱状态下运行。表头带有模式选择器：点击一次即循环切换 Mode（部署默认、read-only、 workspace-write、跟随会话）并重启 shell，而模式块始终显示主机实际生效的模式。 `danger-full-access` 根本不是客户端可选值，因此这个选择器只能收窄终端，永远无法让它 宽过所属会话。
- **内嵌 frame 是一个真实的浏览器文档，而绝不是本应用里的一把椅子。** 它被授予表单、脚本、站点自身 origin 与 popups：不透明 origin 会在读取 storage 时抛错、并让每个请求带上 `Origin: null`，这正是 pane 只剩一个任何站点都跑不起来的静态壳的原因；而页面的链接是页面自己的事——`target="_blank"` 按作者的本意打开，弹出的窗口继承同一套沙箱。让它安全的是这一对的另一半：本界面拒绝被任何页面内嵌，因此页面无法把 frame 导航到这里并继承本应用自身的路由。没有 `postMessage` 桥、没有代理、没有注入，也没有任何沙箱逃逸。frame 还在引擎支持时以 credential-less 方式加载：站点拿不到这个浏览器的 cookie，也不保留自己的存储；不支持该能力的引擎改用不透明 origin 的沙箱，pane 会说明这一点。浏览器 tab 的 chip 用**主机自己取回**的 logo 来命名被内嵌页面（自行解析域名、拒绝任何非公网解析结果，并把 socket 固定到已验证的地址，使「重新解析」无法把本进程指向读者自己的内网）——先试 `/favicon.ico` 等常见路径，再试页面自己声明的图标，不带凭据、重定向有次数上限且每一跳都重新校验、有字节上限、只接受图片字节、绝不访问私有地址，并带缓存；因为浏览器直连的 `<img>` 会带上该站点的 cookie，而匿名请求又需要站点并未授予的 CORS。
- **pane 骨架是共享的，不是复制的。** 文件 pane 的 body、表头行、图标控件与阻塞态文本行 被提升到 `ui-primitives`，成为 `PaneBody`、`PaneHeader`、`PaneIconButton`、`PaneStatus` 与 `PaneStatusLine`，`ui-sidebar-files` 也迁移到它们之上。复制 CSS 只能让两边“当下一致、 日后漂移”；两个包需要同一个控件，正是它该归共享所有者的时刻。
- **调色板只有一个来源。** `terminalCellStyle` 用与 `parseAnsiLines` 相同的两张表解析单元格 颜色，因此实时 pane 与工具结果卡片渲染同一条命令的结果完全一致。

## Security considerations

每个路由都按顺序经过三道门：组合层的浏览器信任围栏、loopback 判定（默认 `allowRemote: false`，因为这个 pane 交出的是主机 shell），以及变更类调用随请求头携带的 每页 CSRF 令牌。请求体必须是 `application/json`、按 64 KiB 上限读取并严格解析；标识符 必须匹配会话 id 的形状。终端是 128-bit capability，每次调用都重新对照其活动 Agent 校验； 流式路由不需要令牌，因为它是只读的，而 URL 里不该出现秘密。内嵌 frame 与本应用自身的 origin 是一对：frame 保留站点自身的 origin，真实页面才可能工作；而本界面对每个响应都拒绝被内嵌（`x-frame-options: DENY`、`content-security-policy: frame-ancestors 'none'`），因此这项授权无法被换成一张坐在本应用同源位置上的椅子。

终端的 argv 完全由配置与 `ctx.subprocess.resolveExecutable` 构造；浏览器只能向 PTY 写 字节，永远碰不到命令行。在 Windows 上，默认的 `pwsh` argv 还会关闭 PSReadLine 的历史 文件，因此受限 shell 不会因为写不了 profile 而报错。输出始终是读者自己的文本：表头会复制 pane 保留的全部内容，选中内容时 Ctrl+C 执行复制，没有选中时则发送中断。终端输出以文本节点渲染——包含标记的帧会原样显示为字面量——并且 本包不注册任何工具、命令或会话事件，因此被提示注入的模型无法触及这个 pane，shell 输出 也永不进入会话日志。

跟不上节奏的读取方会被丢弃而不是被缓冲；某个终端的序列化故障会被上报并关闭该终端， 而不是从定时器里抛出去。

## UI consistency

两个 pane 组装共享的 pane primitive，因此内边距、字号、表头语法、图标控件与阻塞态布局 在构造上就是文件 pane 的那一套。改动 `PaneBody` 会同时移动两边。终端网格停留在面板地面 上，而不是变成一张浮起的卡片——这与“面板是页面的一列”的规则一致。

## Testing

`tests/security.spec.ts` 覆盖安全原语，`tests/terminal-routes.spec.ts` 让每个路由都穿过 自己的门，`tests/session.spec.ts` 固定钳制表与失败关闭路径，`tests/emulator.spec.ts` 针对 真实引擎断言序列化屏幕，客户端 spec 则固定键位映射、地址策略与 frame 隔离。文件 pane 自己 的 13 个 spec 在迁移后原样通过。

## Alternatives considered

**在浏览器端渲染（客户端 xterm.js）。** 这样仿真器与视图同在一处，但会给浏览器包再加一个终端引擎；而且 pane 只能画出客户端自己收到的东西——主机本来就要为工具结果卡片仿真每一个终端，复用同一引擎才把依赖面保持为零。

**为浏览器 pane 做反向代理。** 代理被内嵌站点可以让 pane 改写响应头、也能隐藏站点自身地址，但它同时会让主机变成任意 URL 的开放代理，把 GUI 自身的 origin 重新推到不可信内容前面，并给被提示注入的模型一个请求伪造器。frame 因此保留站点自身的 origin——而这只在本界面拒绝被内嵌的前提下才成立。

**把文件 pane 的 CSS 复制过来。** 一个下午更省事，当天看起来也没问题。但任何一侧改动都会立刻漂移；把骨架提升到 `ui-primitives` 并让文件 pane 迁移过去，只付一次迁移成本，就让“一致”成为结构性的。

**不给终端做模式选择器**，只留配置。需要解释的状态更少，但排查提示注入报告的人必须改 profile 并重启主机，才能收窄一个已经打开的 shell。选择器只在会话范围内收窄、绝不放宽，因此它增加的是可达性，而非权限。

## Consequences

终端网格在打开时固定（终端原语没有 resize），pane 保留主机缓冲所留的行、丢弃更早的行，内容级动作目前放在 pane 头部而不是 tab 菜单席位。拒绝被内嵌的站点仍然无法显示，登录态也不会留在 frame 里（它以 credential-less 方式加载）；两种情况 pane 都提供系统浏览器。

有两件事在这里是事实记录而不是待办，因为网页本身做不到：拒绝被内嵌的站点无法在 pane 里渲染，跨源 frame 里的 `target="_blank"` 链接也无法被改到 pane 内——frame 不暴露 DOM、不暴露点击处理，也不给出弹窗句柄，只有顶层浏览上下文（桌面端）才可能做到其中任何一件。
