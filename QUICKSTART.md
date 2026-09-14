# 快速上手（一步一步照着做）

这份文档只讲操作：每一步写清楚「做什么」和「应该看到什么」。概念与安全细节见 [README](README.md) 与 [包文档](plugin/README.zh.md)。

---

## 一、安装（选一种情况）

### 情况 A：你的电脑上已经装好了 DSH

**第 1 步：把插件装进你启动 DSH 时用的那个 profile**

```text
dsh plugin --profile <你的 profile 名> add @deepseek-ai/dsh-client-ui-sidebar-tools
```

- `<你的 profile 名>` 换成你平时 `dsh web --profile xxx` 里的那个名字（不确定就跑一次 `dsh plugin --profile <名字> list` 看能不能通）。
- 应该看到：pnpm 安装成功，profile 目录里出现这个包的链接，profile 的 `dsh.profile.bundles` 里多了本包。
- 需要联网（依赖要走 registry 解析版本）。

**第 2 步：重启 DSH**

停掉当前进程，重新启动。主机部分只在启动时加载，不重启看不到新面板。

**第 3 步：刷新浏览器页面**

在 GUI 页面按 **Ctrl + Shift + R**（硬刷新）。看到新面板需要这一步，因为客户端代码是重新打包的。

**第 4 步：确认装上了**

- 右侧 Sidebar 的起始页（guide 页）应该多出两个入口框：**终端** 与 **浏览器**。
- 如果没看到：打开浏览器控制台，请求 `GET /gui-terminal/token`（同源，例如 `fetch('/gui-terminal/token')`）。返回 `404` = 主机部分没加载（回到第 2 步重启）；返回 `401/403` 或一个 token = 已加载。

**第 5 步：打开终端**

在起始页点「终端」。应该看到：黑底的终端区域，1～2 秒内出现 shell 提示符。点一下终端区域，然后敲 `echo hi` 回车，应该回显 `hi`。

**第 6 步：打开浏览器**

回起始页点「浏览器」。在地址栏输入 `example.com` 回车。应该看到：站点在面板里加载出来。再输入 `hello world` 回车，应该走搜索。

---

### 情况 B：你要从源码检出里跑起来

按顺序执行（每一步都等上一步结束）：

1. `pnpm install`
2. `pnpm run build:lib:host`
3. `pnpm run build:lib:client`
4. `pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-tools bundle`
5. `pnpm --filter @deepseek-ai/dsh-web-frontend run build`
6. 启动：`dsh web`
7. 浏览器里 **Ctrl + Shift + R** 硬刷新
8. 右侧 Sidebar → 起始页 → **终端**，再回起始页 → **浏览器**

检出的 bundle 已经包含本插件，所以不需要额外加配置行。

**改完代码之后要不要重启？**

| 你改了什么 | 要做什么 |
| --- | --- |
| `src/host/**`、`src/index.ts`、`src/config.ts` | 重启 DSH（主机部分只在启动时加载） |
| `src/client/**`（面板界面） | 第 4 步那条 `bundle` 命令 + 硬刷新 |
| `packages/client/**` 里的库（如 `ui-primitives`） | 第 3 步 + 第 5 步 + 硬刷新 |
| `cordis.patch.yml` 或 profile 的 patch | 保存即生效（用户 patch 文件是实时监听的） |

---

## 二、日常怎么用

| 你想做的事 | 怎么做 | 应该看到 |
| --- | --- | --- |
| 在终端里打字 | 先点一下终端区域，再敲键盘 | 字符出现在提示符后 |
| 看更早的输出 | 鼠标滚轮在终端区域往上滚 | 之前滚出屏幕的行能看到（上限＝主机 `scrollbackLines`，默认 1000 行） |
| 复制一段报错 | 按住左键拖选，然后 **Ctrl + C** | 选中的文字进了剪贴板（有选中时 Ctrl+C 是复制） |
| 复制全部输出 | 点终端表头的 **⧉** 按钮 | 保留的全部内容进剪贴板，按钮短暂显示“已复制” |
| 中断正在跑的命令 | 没有任何选中时按 **Ctrl + C** | 命令被中断（和普通终端一致） |
| 换一个更严格的沙箱 | 点表头的模式块（写着「默认/只读/可写/会话」） | shell 重启，模式块显示主机实际生效的模式 |
| 再开一个终端 | 回起始页再点一次「终端」 | **新开一个 tab**（不会跳回原来那个） |
| 关掉某个 tab | 点该 tab 上的关闭按钮 | tab 消失 |

浏览器面板：

| 你想做的事 | 怎么做 | 应该看到 |
| --- | --- | --- |
| 打开网址 | 输入完整地址（如 `docs.example.com`）回车 | 页面加载 |
| 搜索 | 输入词（如 `rust 教程`）回车 | 走搜索引擎 |
| 后退 / 前进 / 刷新 | 用表头左侧三个图标 | 地址栏同步变化 |
| 站内跳转 | 直接点页面里的链接 | 同 frame 的链接留在面板里；页面自己要开新窗口的链接会开在你的浏览器里 |
| 想让页面在外面的浏览器打开 | 页面空白提示里点「用系统浏览器打开」 | 系统浏览器打开该地址 |
| 换回这个页面 | tab 上的 chip 显示站点 logo + 主机名，鼠标悬停显示完整地址 | —— |

---

## 三、改一个配置（以“让终端不能写文件”为例）

**第 1 步：找到要改的文件**

profile 自己的 patch 文件：`<profile 目录>/cordis.patch.yml`（就是第 1 步 `dsh plugin` 安装到的那个目录）。整个安装也可以用 `$DSH_HOME/cordis.patch.yml`。

**第 2 步：在文件里加上这一段**

```yaml
- id: ui-sidebar-tools
  config:
    mode: read-only
```

注意：**一个行的 `config` 是整体替换**，不是合并。所以如果你之前还设置过别的值（比如 `scrollbackLines`），要一起写在这个 `config:` 下面。

**第 3 步：保存**

- 如果文件里**本来就有**这一行：保存后即时生效，不用重启。
- 如果是**第一次新增**这一行：需要重启 DSH。

**第 4 步：核对**

终端表头的模式块现在应显示只读；设置 `allowRemote: true` 或 `mode: danger-full-access` 时，启动日志还会各打印一条告警。

常用配置对照：

| 想要 | 写什么 |
| --- | --- |
| 终端不能写文件 | `mode: read-only` |
| 终端和会话同样宽 | `mode: session` |
| 回看 5000 行 | `scrollbackLines: 5000` |
| Windows 上用 Git Bash | `shellPath: 'C:\Program Files\Git\bin\bash.exe'` 加 `shellArgs: ['--login', '-i']` |
| macOS 上用 zsh | `shellPath: /bin/zsh` |
| 让别的机器访问 GUI | `allowRemote: true`（会让能连上端口的人都拿到 shell，请配合 loopback 或认证代理） |

浏览器面板**没有任何配置项**：它的沙箱、隐私加载方式和地址策略是固定的安全设定。

---

## 四、出问题先看这张表

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 起始页里没有「终端 / 浏览器」 | 主机部分没加载 | 请求 `GET /gui-terminal/token`：`404` 就重启 DSH |
| 更新后面板空白 | 浏览器用了缓存的客户端代码 | **Ctrl + Shift + R** 硬刷新 |
| 页面提示站点拒绝被内嵌（如 google.com） | 站点自己不允许被放进 frame（`X-Frame-Options`） | 点「用系统浏览器打开」。网页里无法绕过 |
| 终端只能看一屏、往上滚不动 | 主机没重启（旧版本帧里没有回看信息） | 重启 DSH，再硬刷新 |
| tab 上没有站点 logo，只有名字 | 主机无法为该站点确认图标 | 属正常回退：宁可不显示，也不自造图标 |
| 终端尺寸不对/被切 | 网格在打开时固定，之后改宽度不重排 | 关掉再新开一个终端 |
| 登录某个站点后一刷新就掉 | 面板以 credential-less 加载，站点拿不到 cookie | 需要登录的站点请用系统浏览器 |
