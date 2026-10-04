# yoinks 下载按钮（UserScript + yoinks:// 协议）

在视频页面右下角显示一个「下载视频」按钮，点击后由本机 `yoinks` 下载当前页面。

不需要常驻进程：浏览器把 `yoinks://` 链接交给系统，系统按注册表里的协议命令拉起本机处理程序，处理程序再开一个终端窗口运行 `yoinks`。

```
点击按钮 → yoinks://dl?url=<编码后的视频地址>
        → Windows 按 HKCU\Software\Classes\yoinks 找到命令
        → wscript.exe launcher.vbs "<协议链接>"      （GUI 子系统，不闪黑窗）
        → node handler.mjs "<协议链接>"              （解析出视频地址）
        → start 打开新终端窗口运行 yoinks <视频地址>
```

## 安装

1. 双击 `install.cmd`，写入注册表项 `HKCU\Software\Classes\yoinks`（只影响当前用户，不需要管理员权限）。
2. 浏览器装用户脚本管理器（脚本猫 ScriptCat / Tampermonkey / Violentmonkey），把 `yoinks-download.user.js` 拖进去安装。
   脚本默认只走 `yoinks://` 协议，只用原生 DOM API，不申请任何 GM 权限；安装时看到的「在所有网站运行」来自 `@match *://*/*`，因为视频页判断是在脚本里做的。
3. 打开支持的视频页，点右下角按钮。**第一次**浏览器会问「是否打开 yoinks」，勾选「始终允许」，之后不再询问。

## 文件

| 文件 | 作用 |
|---|---|
| `yoinks-download.user.js` | 用户脚本：匹配视频页、显示按钮、发出 `yoinks://` 链接 |
| `handler.mjs` | 协议处理程序：还原视频地址，开终端运行 yoinks |
| `launcher.vbs` | 无窗口启动 handler.mjs（wscript 是 GUI 子系统，不会闪控制台） |
| `install.cmd` / `uninstall.cmd` | 注册 / 移除协议 |
| `bridge.mjs` + `start-bridge.cmd` | 备选的本地 HTTP 桥方案，见文末 |

## 关于「每次都要开一个终端窗口」

`yoinks` 0.3.1 是交互式 TUI：给它链接后会弹出格式选择器，需要按方向键选分辨率再回车。它的 README 把「`--best` / `--mp3` 跳过选择器」列为待办，目前尚未实现。所以点击按钮后会开一个终端窗口，需要你手动选一次格式。等上游支持非交互模式后，改 `handler.mjs` 里 `downloadInTerminal()` 拼的命令即可变成全静默下载。

如果想立刻要全静默，把 `handler.mjs` 里的 `yoinks "<url>"` 换成 yt-dlp（yoinks 首次运行时会把它下载到 `~/.yoinks/bin`）：

```
"%USERPROFILE%\.yoinks\bin\yt-dlp.exe" -f "bv*+ba/b" -o "%USERPROFILE%\Downloads\%(title)s.%(ext)s" "<url>"
```

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
