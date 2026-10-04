// yoinks 协议处理器
//
// 由 launcher.vbs 调用：node handler.mjs "yoinks://dl?url=..."
// 职责：从协议 URL 里还原出视频链接，在一个新终端窗口里运行 yoinks 下载。
//
// 优先用 pwsh（PowerShell 7）跑，没有就回退到 cmd。
// pwsh 模式下还会盯着 yoinks 的历史文件：下载一完成就把窗口关掉（可用 AUTO_CLOSE 关掉）。
//
// 自检：node handler.mjs --selftest

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const LOG = join(tmpdir(), 'yoinks-protocol.log')

// yoinks 每成功下载一次就重写这个文件，用它当作"下载完成"的信号。
// 它的 done 阶段是常驻的（等你贴下一个链接，^c 才退出），所以不能靠等进程结束。
const HISTORY = join(homedir(), '.config', 'yoinks', 'history.json')

const AUTO_CLOSE = true // 下载完成后自动关窗，仅 pwsh 模式有效
const CLOSE_DELAY_MS = 2000 // 关窗前留一点时间，让 done 界面（保存路径）露个面
const WATCH_TIMEOUT_MS = 30 * 60 * 1000 // 看门狗最长守 30 分钟

// URL 最终会写进临时 .cmd / .ps1 脚本。双引号会打破引号包裹，换行会插入新命令，一律拒绝。
const REJECT = /["`\r\n]/

function isSafeUrl(u) {
  return (
    typeof u === 'string' &&
    u.length > 0 &&
    u.length <= 2048 &&
    /^https?:\/\//i.test(u) &&
    !REJECT.test(u)
  )
}

// 各浏览器（以及 Windows 本身）对自定义协议 URL 里的 % 转义次数不一致：
// 有的原样传，有的会把 % 再转义一次。所以反复解码，直到拿到 http(s) 开头的地址。
function extractUrl(raw) {
  const text = String(raw || '')
  // 去掉 yoinks: 或 yoinks://host 前缀，留下 ?url=… 或直接跟在后面的内容
  const after = text.replace(/^yoinks:(\/\/[^?]*)?\??/i, '')
  const matched = /(?:^|&)url=([^&]*)/i.exec(after)
  let value = matched ? matched[1] : after

  for (let i = 0; i < 3; i++) {
    if (/^https?:\/\//i.test(value)) break
    try {
      const next = decodeURIComponent(value)
      if (next === value) break
      value = next
    } catch {
      break // 百分号序列不完整，保持原样交给下面的校验
    }
  }
  return value
}

// cmd 里百分号要写成 %%，否则会被当变量展开
const cmdQuote = (s) => `"${String(s).replace(/%/g, '%%')}"`
// PowerShell 单引号字符串：内部单引号翻倍即可，$ 和反引号都失去特殊含义
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function hasPwsh() {
  try {
    execFileSync('where.exe', ['pwsh'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// 写一个临时脚本再交给 start 执行：既避开手工拼接 cmd 命令行的转义陷阱，
// 又能借 start 打开一个真正可见的终端窗口。
function startWindow(shell, extraArgs, scriptFile) {
  const args = ['/c', 'start', '', shell, ...extraArgs, scriptFile]
  const child = spawn('cmd.exe', args, { detached: true, stdio: 'ignore' })
  child.on('error', (err) => console.error('启动终端失败:', err.message))
  child.unref()
}

// 返回 PID 文件路径：pwsh 脚本会把自己的 PID 写在里面，供看门狗使用
function openInPwsh(url) {
  const id = stamp()
  const script = join(tmpdir(), `yoinks-${id}.ps1`)
  const pidFile = join(tmpdir(), `yoinks-${id}.pid`)

  writeFileSync(
    script,
    [
      "$Host.UI.RawUI.WindowTitle = 'yoinks'",
      // 记的是 pwsh 自己的 PID：它就是窗口的根进程，杀掉它窗口就关了，
      // yoinks 是它的子进程，/T 会一并带走。
      `$PID | Set-Content -Path ${psQuote(pidFile)} -Encoding ascii`,
      'if (-not (Get-Command yoinks -ErrorAction SilentlyContinue)) {',
      "  Write-Host '找不到 yoinks，请确认已全局安装（npm i -g yoinks）。'",
      "  Read-Host '按回车关闭窗口'",
      '  exit 1',
      '}',
      // 直接按名字调：PowerShell 按 PATHEXT 解析，会选中 yoinks.cmd 那个 shim
      `yoinks ${psQuote(url)}`,
      '',
    ].join('\r\n'),
    'utf8'
  )

  // -ExecutionPolicy Bypass：默认策略是 Restricted 时脚本文件跑不起来
  startWindow('pwsh.exe', ['-ExecutionPolicy', 'Bypass', '-File'], script)
  return { script, pidFile }
}

function openInCmd(url) {
  const script = join(tmpdir(), `yoinks-${stamp()}.cmd`)
  writeFileSync(
    script,
    ['@echo off', 'chcp 65001 >nul', 'title yoinks', `yoinks ${cmdQuote(url)}`, ''].join('\r\n'),
    'utf8'
  )
  startWindow('cmd.exe', [], script)
  return { script, pidFile: null }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function historyMtime() {
  try {
    return statSync(HISTORY).mtimeMs
  } catch {
    return 0 // 还没下载过，文件不存在
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killTree(pid) {
  const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  child.on('error', () => {})
}

// 下载一完成就关窗。判定依据是 yoinks 自己写的历史文件发生变化，
// 这比轮询 yt-dlp 进程可靠：探测阶段也会起 yt-dlp，靠进程消失会误判。
async function watchUntilDone({ script, pidFile }, mtimeBefore) {
  const deadline = Date.now() + WATCH_TIMEOUT_MS
  const cleanup = () => {
    rmSync(script, { force: true })
    if (pidFile) rmSync(pidFile, { force: true })
  }

  try {
    while (Date.now() < deadline) {
      await sleep(1000)

      let pid = 0
      try {
        pid = Number(readFileSync(pidFile, 'utf8').trim())
      } catch {
        continue // 窗口还没把 PID 写出来
      }
      if (!pid) continue

      if (!isAlive(pid)) return '用户自己关了窗口' // 窗口没了，不用守了

      if (historyMtime() !== mtimeBefore) {
        await sleep(CLOSE_DELAY_MS) // 让 done 界面和保存路径露个面
        killTree(pid) // 只杀 yoinks 那棵树，pwsh 随之退出，窗口关闭
        return '下载完成，已自动关窗'
      }
    }
    return '看门狗超时，不再跟踪'
  } finally {
    cleanup()
  }
}

// 解析失败时不要静默退出，开个窗口把原始参数摊出来，方便排查浏览器传了什么
function showDiagnostic() {
  const script = join(tmpdir(), `yoinks-${stamp()}.cmd`)
  writeFileSync(
    script,
    [
      '@echo off',
      'chcp 65001 >nul',
      'title yoinks',
      'echo 无法从协议参数里解析出可用的视频链接。',
      'echo 下面是本次收到的原始内容：',
      'echo.',
      `type "${LOG}"`,
      'pause',
      '',
    ].join('\r\n'),
    'utf8'
  )
  startWindow('cmd.exe', [], script)
}

function writeLog(...lines) {
  try {
    writeFileSync(LOG, lines.join('\r\n') + '\r\n', 'utf8')
  } catch {
    // 日志写不了不影响下载
  }
}

// 安全校验和参数还原是这套东西的全部逻辑，用自检把规则钉死
if (process.argv.includes('--selftest')) {
  const decodeCases = [
    ['yoinks://dl?url=https%3A%2F%2Fyoutu.be%2Fabc', 'https://youtu.be/abc'],
    // 浏览器把 % 再转义一次的情况
    ['yoinks://dl?url=https%253A%252F%252Fyoutu.be%252Fabc', 'https://youtu.be/abc'],
    ['yoinks://dl/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Da%26t%3D1', 'https://www.youtube.com/watch?v=a&t=1'],
    ['yoinks://dl?url=https://x.com/a/status/1', 'https://x.com/a/status/1'],
    ['yoinks:https%3A%2F%2Fx.com%2F1', 'https://x.com/1'],
    ['yoinks://dl', ''],
  ]
  const safeCases = [
    ['https://youtu.be/dQw4w9WgXcQ', true],
    ['https://x.com/u/status/1?s=20&t=abc', true],
    ["https://a.example/o'brien%20clip", true],
    ['https://a.example/100%25.mp4', true],
    ['', false],
    'x',
    ['file:///C:/a.mp4', false],
    ['https://a/"b', false],
    ['https://a/b\nc', false],
  ]
  const quoteCases = [
    ['ps', "https://a.example/o'brien?x=1&y=$HOME", "'https://a.example/o''brien?x=1&y=$HOME'"],
    ['cmd', 'https://a.example/100%.mp4', '"https://a.example/100%%.mp4"'],
  ]

  const failures = []
  for (const [raw, want] of decodeCases) {
    const got = extractUrl(raw)
    if (got !== want) failures.push(`extractUrl(${JSON.stringify(raw)}) = ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)
  }
  for (const entry of safeCases) {
    const [u, want] = Array.isArray(entry) ? entry : [entry, false]
    if (isSafeUrl(u) !== want) failures.push(`isSafeUrl(${JSON.stringify(u)}) = ${isSafeUrl(u)}，期望 ${want}`)
  }
  for (const [kind, input, want] of quoteCases) {
    const got = kind === 'cmd' ? cmdQuote(input) : psQuote(input)
    if (got !== want) failures.push(`${kind}Quote(${JSON.stringify(input)}) = ${got}，期望 ${want}`)
  }

  if (failures.length) {
    console.error('自检失败:\n' + failures.join('\n'))
    process.exit(1)
  }
  console.log(
    `自检通过：${decodeCases.length} 个协议参数还原，${safeCases.length} 个 URL 校验，${quoteCases.length} 个转义`
  )
  process.exit(0)
}

const raw = process.argv[2] ?? ''
const url = extractUrl(raw)
const parsed = isSafeUrl(url)

writeLog(
  `时间: ${new Date().toLocaleString()}`,
  `原始参数: ${raw}`,
  `解析结果: ${parsed ? url : '失败 -> ' + JSON.stringify(url)}`
)

if (!parsed) {
  showDiagnostic()
  process.exitCode = 1
} else if (hasPwsh()) {
  const mtimeBefore = historyMtime()
  const handle = openInPwsh(url)
  if (AUTO_CLOSE) {
    const outcome = await watchUntilDone(handle, mtimeBefore)
    writeLog(
      `时间: ${new Date().toLocaleString()}`,
      `原始参数: ${raw}`,
      `解析结果: ${url}`,
      `窗口: pwsh · ${outcome}`
    )
  }
} else {
  openInCmd(url)
  writeLog(
    `时间: ${new Date().toLocaleString()}`,
    `原始参数: ${raw}`,
    `解析结果: ${url}`,
    '窗口: cmd（没找到 pwsh，也不启用自动关窗）'
  )
}
