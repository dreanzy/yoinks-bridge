// ==UserScript==
// @name         yoinks 下载视频
// @version      1.2.0
// @namespace    local.yoinks
// @description  在视频页右下角显示「下载视频」按钮，点击通过 yoinks 协议调用本机 yoinks 下载
// @noframes
// @match        *://*.youtube.com/*
// @match        *://youtu.be/*
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @match        *://*.instagram.com/*
// @match        *://*.threads.net/*
// @match        *://*.threads.com/*
// @match        *://*.tiktok.com/*
// @match        *://*.bilibili.com/*
// @match        *://b23.tv/*
// @match        *://*.reddit.com/*
// @match        *://v.redd.it/*
// @match        *://*.vimeo.com/*
// @match        *://*.dailymotion.com/*
// @match        *://*.twitch.tv/*
// @match        *://*.facebook.com/*
// @match        *://*.weibo.com/*
// @match        *://*.weibo.cn/*
// @match        *://*.douyin.com/*
// @match        *://*.xiaohongshu.com/*
// @match        *://xhslink.com/*
// ==/UserScript==

// 两层筛选：
//   1. 上面那串 @match 是粗筛：不在名单里的站点，脚本根本不会被注入。
//   2. 下面的 SITES 是细筛：同一个站点里只有视频页才挂按钮（首页、搜索页、频道页不挂）。
// 加新站点时两处都要改。
//
// 默认走 yoinks 协议，只用原生 DOM API，不需要任何 GM 权限。
// 若把下面的 MODE 改成 'bridge'（本地 HTTP 桥），需同时在元数据块里补上
// grant GM_xmlhttpRequest 和 connect 127.0.0.1 两项。

(function () {
  'use strict'

  // 发送方式：
  //   'protocol' 走 yoinks:// 协议，直接拉起本机处理程序，不需要任何常驻进程
  //   'bridge'   走本地 HTTP 桥，需要先启动 start-bridge.cmd
  const MODE = 'protocol'

  // 本地桥地址，只在使用 bridge 模式时需要，与 bridge.mjs 的端口保持一致
  const BRIDGE = 'http://127.0.0.1:8765'

  // 视频页的 URL 形态。yoinks 底层是 yt-dlp（1800+ 站点），这里只列常见的。
  const SITES = [
    /^https?:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts|live)/i,
    /^https?:\/\/youtu\.be\//i,
    /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[^/]+\/status\//i,
    /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\//i,
    /^https?:\/\/(www\.)?threads\.(net|com)\/@[^/]+\/post\//i,
    /^https?:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\//i,
    /^https?:\/\/(vm|vt)\.tiktok\.com\//i,
    /^https?:\/\/(www\.)?bilibili\.com\/(video|bangumi\/play)\//i,
    /^https?:\/\/b23\.tv\//i,
    /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/.+\/comments\//i,
    /^https?:\/\/v\.redd\.it\//i,
    /^https?:\/\/(www\.)?vimeo\.com\/\d+/i,
    /^https?:\/\/(www\.)?dailymotion\.com\/video\//i,
    /^https?:\/\/(www\.)?twitch\.tv\/videos\//i,
    /^https?:\/\/(www\.|m\.)?facebook\.com\/(watch|reel|.+\/videos)/i,
    /^https?:\/\/(www\.)?weibo\.(com|cn)\//i,
    /^https?:\/\/(www\.)?douyin\.com\/video\//i,
    /^https?:\/\/(www\.)?xiaohongshu\.com\/(explore|discovery\/item)\//i,
    /^https?:\/\/xhslink\.com\//i,
  ]

  const isVideoPage = (href) => SITES.some((re) => re.test(href))

  // 首次点击的提示只给一次。
  // 用内存变量而不是 localStorage：脚本沙箱（脚本猫在沙箱模式下）不一定透出 localStorage。
  let hintShown = false

  let host = null
  let btn = null
  let shown = ''

  function mount() {
    host = document.createElement('div')
    host.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:auto'
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>
        button {
          display: flex; align-items: center; gap: 6px;
          font: 600 14px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #fff; background: #111; border: 0; border-radius: 999px;
          padding: 10px 16px; cursor: pointer; opacity: .85;
          box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
          transition: opacity .15s, transform .15s;
        }
        button:hover { opacity: 1; transform: translateY(-1px); }
        button:disabled { cursor: default; opacity: .6; transform: none; }
        .ico { font-size: 15px; line-height: 1; }
      </style>
      <button type="button"><span class="ico">⬇</span><span class="txt">下载视频</span></button>`
    btn = shadow.querySelector('button')
    btn.title = '调用本机 yoinks 下载（首次需在浏览器弹窗里选择「打开 yoinks」）'
    btn.addEventListener('click', onClick)
    document.body.appendChild(host)
  }

  function unmount() {
    host.remove()
    host = null
    btn = null
  }

  function setLabel(text, disabled) {
    host.shadowRoot.querySelector('.txt').textContent = text
    btn.disabled = disabled
  }

  function setBusy(text, ms) {
    setLabel(text, true)
    setTimeout(() => setLabel('下载视频', false), ms)
  }

  // 走自定义协议：浏览器把 URL 交给系统，系统再按注册表里的命令调用 launcher.vbs。
  // 这条路上页面拿不到任何回执，所以只提示「已发送」。
  function openViaProtocol(videoUrl) {
    const link = document.createElement('a')
    link.href = 'yoinks://dl?url=' + encodeURIComponent(videoUrl)
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    setTimeout(() => link.remove(), 0)
  }

  function post(url) {
    const payload = JSON.stringify({ url })
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error('offline'))
      const done = (text) => {
        try {
          if (JSON.parse(text).ok) resolve()
          else reject(new Error('refused'))
        } catch {
          reject(new Error('refused'))
        }
      }
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST',
          url: BRIDGE,
          headers: { 'Content-Type': 'application/json' },
          data: payload,
          timeout: 5000,
          onload: (res) => done(res.responseText),
          onerror: fail,
          ontimeout: fail,
        })
      } else {
        fetch(BRIDGE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
          .then((res) => res.text())
          .then(done)
          .catch(fail)
      }
    })
  }

  async function onClick() {
    if (MODE === 'protocol') {
      openViaProtocol(location.href)
      const isFirst = !hintShown
      hintShown = true
      if (isFirst) {
        setLabel('弹窗里选「打开 yoinks」', true)
        setTimeout(() => setLabel('下载视频', false), 6000)
      } else {
        setBusy('已发送到 yoinks', 2500)
      }
      console.log('[yoinks] 已交给系统处理:', location.href)
      return
    }

    setLabel('发送中…', true)
    try {
      await post(location.href)
      setBusy('已在终端打开', 2500)
      console.log('[yoinks] 已发送到本地桥:', location.href)
    } catch (err) {
      const msg = err.message === 'offline' ? '桥未启动' : '发送失败'
      setBusy(msg, 3000)
      console.warn('[yoinks] 发送失败:', msg, '— 确认已运行 start-bridge.cmd')
    }
  }

  // 只有当前页是视频页时才把按钮挂上去，离开就摘掉，不匹配的页面一点 DOM 都不碰。
  // 站点多是 SPA，URL 会变，所以每隔一会儿比较一次地址（只是字符串比较，开销可以忽略）。
  function tick() {
    if (location.href === shown) return
    shown = location.href
    const wanted = isVideoPage(shown)
    if (wanted && !host) mount()
    else if (!wanted && host) unmount()
  }

  function start() {
    tick()
    setInterval(tick, 800)
  }

  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
})()
