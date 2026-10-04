# yoinks 下载按钮（UserScript + yoinks:// 协议）

在视频页面右下角显示一个「下载视频」按钮，点击后由本机 `yoinks` 下载当前页面。

不需要常驻进程：浏览器把 `yoinks://` 链接交给系统，系统按注册表里的协议命令拉起本机处理程序，处理程序再开一个终端窗口运行 `yoinks`。

```
点击按钮 → yoinks://dl?url=<编码后的视频地址>
        → Windows 按 HKCU\Software\Classes\yoinks 找到命令
        → wscript.exe launcher.vbs "<协议链接>"      （GUI 子系统，不闪黑窗）
        → node handler.mjs "<协议链接>"              （解析出视频地址，并在后台盯着下载进度）
        → start 打开新终端窗口（有 pwsh 用 pwsh，否则 cmd）运行 yoinks <视频地址>
        → 下载完成后自动关窗
```

## 安装

1. 双击 `install.cmd`，写入注册表项 `HKCU\Software\Classes\yoinks`（只影响当前用户，不需要管理员权限）。
2. 浏览器装用户脚本管理器（脚本猫 ScriptCat / Tampermonkey / Violentmonkey），把 `yoinks-download.user.js` 拖进去安装。
   脚本默认只走 `yoinks://` 协议，只用原生 DOM API，不申请任何 GM 权限；安装时看到的「在所有网站运行」来自 `@match *://*/*`，因为视频页判断是在脚本里做的。
3. 打开支持的视频页，点右下角按钮。**第一次**浏览器会问「是否打开 yoinks」，勾选「始终允许」，之后不再询问。

可选：装了 PowerShell 7（`pwsh`）的话会用它在窗口里跑，并且下载完成后自动关窗；没装也能用，会回退到 `cmd`。

## 文件

| 文件 | 作用 |
|---|---|
| `yoinks-download.user.js` | 用户脚本：匹配视频页、显示按钮、发出 `yoinks://` 链接 |
| `handler.mjs` | 协议处理程序：还原视频地址，开终端跑 yoinks，并在下载完成后关窗 |
| `launcher.vbs` | 无窗口启动 handler.mjs（wscript 是 GUI 子系统，不会闪控制台） |
| `install.cmd` / `uninstall.cmd` | 注册 / 移除协议 |
| `bridge.mjs` + `start-bridge.cmd` | 备选的本地 HTTP 桥方案，见文末 |

## 关于那个终端窗口

`yoinks` 0.3.1 是交互式 TUI：给它链接后会弹出格式选择器，要按方向键选分辨率再回车；**下载完成后它也不会退出**，而是停在 `✓ yoinked!` 界面等你贴下一个链接（源码里 done 阶段只有 `^c quit`，没有自动退出）。它的 README 把「`--best` / `--mp3` 跳过选择器」列为待办，目前尚未实现。

所以点按钮后的流程是：开一个终端窗口 → 你选格式 → 下载完窗口自动关。

自动关窗只在 **pwsh（PowerShell 7）** 模式下有效。判断依据是 yoinks 每成功下载一次都会重写的 `~/.config/yoinks/history.json`：handler 启动时记下它的修改时间，之后每秒轮询，一旦变了就杀掉那个窗口的进程树（多等 2 秒，让你能瞥一眼保存路径）。

之所以不用轮询 `yt-dlp` 进程来判断，是因为格式探测阶段也会起 `yt-dlp`，拿“进程消失”当信号会把探测结束误判成下载完成。

| 情况 | 行为 |
|---|---|
| 有 pwsh | 用 pwsh 开窗，下载完自动关 |
| 没 pwsh | 回退到 `cmd`，功能照旧，但**不会**自动关窗，需要自己 Ctrl+C |
| 下载失败 | yoinks 停在错误界面、窗口保留——故意的，错误得让你看见 |
| 想连着下好几集 | 自动关窗会打断，把 `handler.mjs` 顶部的 `AUTO_CLOSE` 改成 `false` |
| 看门狗最多守多久 | 30 分钟，`WATCH_TIMEOUT_MS` 可调 |

## 想全静默（不要格式选择器）

把 `handler.mjs` 里 `openInPwsh()` / `openInCmd()` 拼的命令从 `yoinks <url>` 换成 yt-dlp（yoinks 首次运行时会把它下载到 `~/.yoinks/bin`）：

```
"%USERPROFILE%\.yoinks\bin\yt-dlp.exe" -f "bv*+ba/b" -o "%USERPROFILE%\Downloads\%(title)s.%(ext)s" "<url>"
```

yt-dlp 下完就退出，pwsh 随之结束、窗口自动关闭；看门狗发现 pwsh 没了也会自己收工。代价是固定拿最佳画质，没有格式选择器。

## 出问题时

`handler.mjs` 每次运行都会把收到的原始参数写进 `%TEMP%\yoinks-protocol.log`。如果解析失败，它会开一个终端窗口把这份日志打印出来——把内容发出来就能定位是浏览器传参形态变了。

单独验证解析逻辑：`node handler.mjs --selftest`。

各浏览器对协议 URL 里的 `%` 转义次数并不一致（有的原样传，有的再转义一次），所以 `extractUrl()` 会反复解码直到拿到 `http(s)://` 开头的结果，两种形态都做了自检覆盖。

## 支持的站点

`yoinks-download.user.js` 顶部的 `SITES` 数组是一组 URL 正则，命中才显示按钮：

YouTube、X/Twitter、Instagram、Threads、TikTok、B 站、Reddit、Vimeo、Dailymotion、Twitch、Facebook、微博、抖音、小红书。

yoinks 底层是 yt-dlp（1800+ 站点），想支持别的站点照着加一条正则即可。

## 卸载

双击 `uninstall.cmd` 移除协议注册，然后在用户脚本管理器里删掉脚本。

## 备选：本地 HTTP 桥

如果不想注册协议，可以改用 `bridge.mjs`：双击 `start-bridge.cmd` 启动一个监听 `127.0.0.1:8765` 的小服务，再把用户脚本里的 `MODE` 改成 `'bridge'`，并在元数据里补上 `@grant GM_xmlhttpRequest` 和 `@connect 127.0.0.1`（不补也能走 fetch，但部分站点严格的 CSP 会挡下来）。

桥的好处是页面能拿到回执（按钮会显示「已在终端打开」还是「桥未启动」），代价是要有个常驻进程，而且桥在跑的时候本机任何网页都能向它发请求触发下载窗口。协议模式没有这些问题，但页面无法得知调用是否成功。
