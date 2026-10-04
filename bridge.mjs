// yoinks 本地桥
//
// 浏览器里的 UserScript 不能直接调用本机终端，所以这里起一个小服务当跳板：
// 收到 POST {url} 后，在一个新终端窗口里运行 yoinks 下载这个链接。
//
// 启动：node bridge.mjs
// 自检：node bridge.mjs --selftest
// 端口：默认 127.0.0.1:8765，可用环境变量 YOINKS_BRIDGE_PORT 覆盖

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.YOINKS_BRIDGE_PORT || 8765)
const HOST = '127.0.0.1'

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

let lastUrl = ''
let lastAt = 0

// 生成临时 .cmd 再交给 start 执行，避免手工拼接 cmd 命令行时的转义陷阱。
function openInTerminal(url) {
  const now = Date.now()
  if (url === lastUrl && now - lastAt < 3000) return 'dup' // 连点防抖：同一链接 3 秒内只开一次

  lastUrl = url
  lastAt = now

  const file = join(tmpdir(), `yoinks-${now}-${Math.random().toString(36).slice(2, 8)}.cmd`)
  writeFileSync(
    file,
    '@echo off\r\n' +
      'chcp 65001 >nul\r\n' +
      'title yoinks\r\n' +
      `yoinks "${url.replace(/%/g, '%%')}"\r\n` +
      'echo.\r\n' +
      'pause\r\n',
    'utf8'
  )

  const child = spawn('cmd.exe', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' })
  child.on('error', (err) => console.error('启动终端失败:', err.message))
  child.unref()
  return 'ok'
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // Chrome 的 Private Network Access 预检需要这个头
  'Access-Control-Allow-Private-Network': 'true',
}

const server = createServer((req, res) => {
  const reply = (code, obj) => {
    res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }
  if (req.method !== 'POST') return reply(405, { ok: false, error: '只接受 POST' })

  let body = ''
  let tooBig = false
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 4096) {
      tooBig = true
      req.destroy()
    }
  })
  req.on('end', () => {
    if (tooBig) return
    let url
    try {
      url = JSON.parse(body)?.url
    } catch {
      // 请求体不是 JSON，下面按 URL 无效处理
    }
    if (!isSafeUrl(url)) return reply(400, { ok: false, error: 'URL 无效' })

    const result = openInTerminal(url)
    console.log(result === 'dup' ? `重复请求，已忽略 ${url}` : `已打开终端 ${url}`)
    reply(200, { ok: true, dup: result === 'dup' })
  })
})

// 安全校验是唯一的信任边界，用自检把规则钉死：node bridge.mjs --selftest
if (process.argv.includes('--selftest')) {
  const pass = [
    'https://youtu.be/dQw4w9WgXcQ',
    'https://x.com/u/status/1?s=20&t=abc',
    'https://www.bilibili.com/video/BV1xx411c7mD?p=2',
    'https://a.example/100%25.mp4',
    'http://localhost:3000/video/1',
  ]
  const fail = [
    '',
    'x',
    'file:///C:/a.mp4',
    'javascript:alert(1)',
    'https://a/"b',
    'https://a/b\nc',
    'https://a/`x`',
    42,
    null,
  ]
  const cases = [...pass.map((u) => [u, true]), ...fail.map((u) => [u, false])]
  const wrong = cases.filter(([u, want]) => isSafeUrl(u) !== want)
  if (wrong.length) {
    console.error('自检失败:', wrong.map(([u]) => JSON.stringify(u)).join(', '))
    process.exit(1)
  }
  console.log(`自检通过：${pass.length} 个正常 URL 放行，${fail.length} 个危险输入拒绝`)
  process.exit(0)
}

server.listen(PORT, HOST, () => {
  console.log(`yoinks 桥已启动：http://${HOST}:${PORT}`)
  console.log('保持本窗口开着，在浏览器里点「下载视频」即可。Ctrl+C 退出。')
})
