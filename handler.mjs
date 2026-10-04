// yoinks 协议处理器
//
// 由 launcher.vbs 调用：node handler.mjs "yoinks://dl?url=..."
// 职责：从协议 URL 里还原出视频链接，在一个新终端窗口里运行 yoinks 下载。
//
// 自检：node handler.mjs --selftest

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOG = join(tmpdir(), 'yoinks-protocol.log')

// URL 最终会出现在临时 .cmd 文件里的 `yoinks "<url>"` 这一行，由 cmd.exe 解析。
// 因此这些字符必须拒绝：双引号会打破引号包裹，换行会插入新命令。
// 百分号不拒绝，写入 .cmd 时转义成 %% 即可。
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

// 写一个临时 .cmd 再交给 start 执行：既避开手工拼接 cmd 命令行的转义陷阱，
// 又能借 start 打开一个真正可见的终端窗口。
function runInNewTerminal(lines) {
  const now = Date.now()
  const file = join(tmpdir(), `yoinks-${now}-${Math.random().toString(36).slice(2, 8)}.cmd`)
  const body = ['@echo off', 'chcp 65001 >nul', 'title yoinks', ...lines, 'echo.', 'pause', '']
  writeFileSync(file, body.join('\r\n'), 'utf8')

  const child = spawn('cmd.exe', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' })
  child.on('error', (err) => console.error('启动终端失败:', err.message))
  child.unref()
}

function downloadInTerminal(url) {
  runInNewTerminal([`yoinks "${url.replace(/%/g, '%%')}"`])
}

// 解析失败时不要静默退出，开个窗口把原始参数摊出来，方便排查浏览器传了什么
function showDiagnostic() {
  runInNewTerminal([
    'echo 无法从协议参数里解析出可用的视频链接。',
    'echo 下面是本次收到的原始内容：',
    'echo.',
    `type "${LOG}"`,
  ])
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
    ['https://a.example/100%25.mp4', true],
    ['', false],
    'x',
    ['file:///C:/a.mp4', false],
    ['https://a/"b', false],
    ['https://a/b\nc', false],
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

  if (failures.length) {
    console.error('自检失败:\n' + failures.join('\n'))
    process.exit(1)
  }
  console.log(`自检通过：${decodeCases.length} 个协议参数还原，${safeCases.length} 个 URL 校验`)
  process.exit(0)
}

const raw = process.argv[2] ?? ''
const url = extractUrl(raw)
const parsed = isSafeUrl(url)

// 每次运行覆盖日志，只保留最后一次，够排查用又不会无限增长
try {
  writeFileSync(
    LOG,
    `时间: ${new Date().toLocaleString()}\r\n` +
      `原始参数: ${raw}\r\n` +
      `解析结果: ${parsed ? url : '失败 -> ' + JSON.stringify(url)}\r\n`,
    'utf8'
  )
} catch {
  // 日志写不了不影响下载
}

if (parsed) {
  downloadInTerminal(url)
} else {
  showDiagnostic()
  process.exitCode = 1
}
