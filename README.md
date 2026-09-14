# 侧栏工具：终端 + 浏览器面板（DSH 插件）

**只想照着做？** 看 [QUICKSTART.md](QUICKSTART.md)——一步一步的操作手册（安装、日常操作、改配置、排错）。

DSH Web GUI 右侧 Sidebar 的两个 tab 类型：一个运行在会话沙箱内的真实 PTY 终端，以及一个在对话旁内嵌网页的浏览器面板。包内自包含，只插入自己这一行。

- 包路径（DSH 仓库内）：`packages/client/ui-sidebar-tools`
- 完整双语文档：[English](plugin/README.md) · [中文](plugin/README.zh.md)

## 功能

**终端**

- 真实 PTY（`pwsh` / `powershell` / `bash`），屏幕由主机用 `@xterm/headless` 仿真后推送，浏览器端零终端渲染依赖
- 沙箱内运行，默认 `workspace-write`；面板头部可**切换受限程度**，只能收窄、绝不放宽到超过所属会话
- **回看滚动**：主机保留的行（`scrollbackLines`，默认 1000）都能往上翻，新输出自动跟随、你上滚后不抢位置
- **复制**：可拖选；有选中时 Ctrl+C 复制，无选中时仍是中断；表头 ⧉ 一键复制保留的全部输出（报错可原样粘出）
- tab chip 实时显示 shell 状态（运行中 / 已退出）

**浏览器**

- 地址栏**既能搜索也能直接开网址**（非网址的词走搜索），后退 / 前进 / 刷新同排
- **隐私加载**：支持 `credentialless` 的引擎上，站点拿不到本浏览器的 cookie，其存储随文档销毁；不支持的引擎退回不透明 origin 沙箱并在面板内说明
- 主机**不代理**页面；tab chip 的站点 logo 由主机代取（连接前解析 DNS，只接受公网解析结果，并把 socket 固定到已验证的 IP，防止 DNS 重绑定）（无凭据、重定向有上限且逐跳校验、绝不访问私有地址、只接受图片、带缓存），取不到就只显示站点名
- 链接按网页本意跳转：同 frame 留在面板内，`target="_blank"` 开新窗口（弹窗继承同一套沙箱）

## 安装

### 方式一：装进一个 profile（已安装的 DSH）

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-client-ui-sidebar-tools
```

本包声明了 `dsh.bundle`，因此会链接进 profile、追加到 `dsh.profile.bundles`，并把 `cordis.patch.yml` 作为 profile 自身 patch 之前的最后一层激活。卸载：

```text
dsh plugin --profile <name> remove @deepseek-ai/dsh-client-ui-sidebar-tools
```

需要网络：依赖走 workspace 协议，pnpm 安装时会从 registry 解析版本。

### 方式二：从源码检出运行

```text
pnpm install
pnpm run build:lib:host
pnpm run build:lib:client
pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle
pnpm --filter @deepseek-ai/dsh-web-frontend run build
dsh web          # 然后硬刷新页面
```

`packages/bundle/web-app/cordis.patch.yml` 已包含本包，因此从检出启动的 `dsh web` 自带它。其他组合请自行加入这一行（写进 `$DSH_HOME/cordis.patch.yml` 或 profile 自己的 patch）：

```yaml
- insert:
    - id: ui-sidebar-tools
      name: '@deepseek-ai/dsh-client-ui-sidebar-tools'
```

### 打开面板

右侧 Sidebar 的 guide 页在「文件」之后列出**终端**与**浏览器**；点一次开一个 tab，再点会**再开一个新 tab**。面板最多两格，所以终端与网页可以并排。

### 改动后要不要重启

| 改动 | 需要什么 |
|---|---|
| `src/host/**`、`src/index.ts`、`src/config.ts` | 重启主机（loader 按 specifier 缓存模块） |
| `src/client/**` | `pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle` + 硬刷新 |
| `packages/client/**` 的库源码（如 `ui-primitives`） | `pnpm run build:lib:client` + `pnpm --filter @deepseek-ai/dsh-web-frontend run build` + 硬刷新 |
| `cordis.patch.yml` / profile patch | 实时（监听只覆盖用户 patch 文件） |

## 配置

写在 profile 自己的 patch 里；每个值都有默认值：

```yaml
- id: ui-sidebar-tools
  config:
    mode: workspace-write        # read-only | workspace-write | session | danger-full-access
    allowRemote: false           # 只服务 loopback 调用方
    shellPath: ''                # 留空则解析 pwsh/powershell 或 $SHELL/bash
    shellArgs: []                # 额外 argv；留空用本平台的安静默认值
    scrollbackLines: 1000        # 回看深度
    color: true                  # 帧里携带 SGR 颜色
    vtReplies: true              # 回答终端查询（pwsh 行编辑器需要）
    maxSessions: 8               # 进程内活动终端数
    idleTimeoutMs: 3600000       # 无输入无输出的存活时间
    maxLifeMs: 28800000          # 单个终端的绝对寿命
```

完整字段（含帧尺寸、限流、CSRF 令牌等 22 项）见[包 README](plugin/README.zh.md#配置)。

### 怎么改配置

1. 找到最后生效的那份 patch：profile 自己的 `<profile 目录>/cordis.patch.yml`，或整个安装的 `$DSH_HOME/cordis.patch.yml`。顺序是「先本包 bundle patch、后用户 patch」，所以用户文件覆盖默认值。
2. 写入或扩展该行——**行的 `config` 是整体替换**，要保留的值一起写上：

   ```yaml
   - id: ui-sidebar-tools
     config:
       mode: read-only
       scrollbackLines: 5000
   ```

3. 保存：patch 监听实时重载**用户** patch 文件；**第一次新增这一行**需要重启（主机半只在启动时加载）。
4. 核对：设置 `allowRemote` 或 `mode: danger-full-access` 时启动日志会各打印一条；终端表头始终显示主机**实际强制**的模式（钳制后的结果）。
5. 浏览器面板没有任何配置项：沙箱、credential-less 加载与地址策略是安全姿态的常量，不是可调项。

最常被问到的几项：`mode: read-only`（不能写文件）、`mode: session`（与会话同宽）、`scrollbackLines: 5000`、`shellPath: 'C:\Program Files\Git\bin\bash.exe'` + `shellArgs: ['--login', '-i']`（Windows Git Bash）、`shellPath: /bin/zsh`（macOS）。

## 安全与隐私

- 每个路由都按顺序经过三道门：组合层信任围栏（拒绝被重绑定的 Host、跨站发起方、不透明 `Origin`）、loopback 判定、变更类调用的每页 CSRF 令牌；请求体必须 `application/json` 且按 64 KiB 上限读取并严格解析
- 终端是 128-bit capability，每次调用都重新对照活动 Agent 校验；沙箱失败时**拒绝启动**而不是无沙箱运行
- 面板所在界面**拒绝被任何页面内嵌**（`x-frame-options: DENY` + `frame-ancestors 'none'`），因此被内嵌页面无法把 frame 导航到本界面并继承其路由
- 浏览器面板不代理、不注入、无 `postMessage` 桥；站点拿不到本浏览器的 cookie
- 本包不注册任何工具、命令或会话事件，**对模型不可见**，shell 输出也不进入会话日志

## 做不到的功能（平台限制）

下面是 Web 平台本身的边界，不是待办：在网页里无论怎么改都做不到，只有 Electron 桌面端（顶层浏览上下文 / `webview`）可以。

1. **拒绝被内嵌的站点无法在面板里显示。** `google.com`、`github.com` 一类站点会发 `X-Frame-Options` / `frame-ancestors`，浏览器直接拒绝在任何 iframe 内渲染；面板会提示并提供「用系统浏览器打开」。
2. **页面自己用新窗口打开的链接无法被改到面板内。** 跨源 frame 不暴露 DOM、不暴露点击处理，也不给出弹窗句柄，`sandbox` 只能「允许」或「拦掉」。同 frame 的链接一直留在面板内；拦掉则什么都不开。
3. **拿不到页面自己的标题与 DOM。** 所以 tab chip 显示主机名，而不是页面 `<title>`。
4. **登录态无法保留在面板里**（有意为之）：frame 以 credential-less 加载，站点收不到 cookie。
5. **被内嵌页面无法下载文件或打开模态框**（沙箱不授予 `allow-downloads` / `allow-modals`）。
6. **终端不支持 resize**：PTY 原语没有 resize，网格在打开时固定；改过面板宽度后请新开一个终端。
7. **回看深度有上限**：到主机 `scrollbackLines` 为止；全屏程序（`vim`、`top`）不留历史。
8. **站点 logo 取不到时不显示图标**：主机只接受它能为该站点背书的图标（标准路径或页面声明、重定向有上限且逐跳校验、仅图片、拒绝私有地址），否则只显示站点名，不自造图标。

## 开发

```text
pnpm exec vitest run packages/client/ui-sidebar-tools/tests
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsc -b tsconfig.client.json
```

## 许可

MIT（与本仓库其他部分一致，见仓库根 `LICENSE`）。
