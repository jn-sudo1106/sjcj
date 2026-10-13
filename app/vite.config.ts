import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { DEFAULT_API_PROXY_TARGET, DEFAULT_POC_PROXY_TARGET } from './src/constants/backend'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite 在 evaluate 本配置文件时并不会把 .env 注入 process.env（配置先于 .env 加载），
  // 直接读 process.env.VITE_* 只会命中硬编码兜底，导致 app/.env 里的代理目标永不生效。
  // 必须用 loadEnv 在当前目录（app/）显式读取。
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget =
    env.VITE_API_PROXY_TARGET || env.VITE_AUTH_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  const pocProxyTarget = env.VITE_POC_PROXY_TARGET || DEFAULT_POC_PROXY_TARGET
  // 没有 .env 时，前端 isProductionBackend 也要读到同一地址，不能只改了 proxy 而守卫仍当「未连生产」。
  if (!env.VITE_API_PROXY_TARGET) process.env.VITE_API_PROXY_TARGET = proxyTarget
  // /api/poc 的目的地同样要透给前端：client.ts 按它判定生产写守卫（POC 服务不是 217，不该被拦）。
  if (!env.VITE_POC_PROXY_TARGET) process.env.VITE_POC_PROXY_TARGET = pocProxyTarget
  return {
    base: env.VITE_BASE || '/',
    plugins: [vue()],
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            if (id.includes('element-plus')) return 'vendor-element'
            if (id.includes('/vue') || id.includes('/@vue') || id.includes('pinia')) return 'vendor-vue'
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      // 认证与 /v1 业务请求共用 HttpOnly Cookie（SameSite=Lax），开发统一走同源 /api 代理
      proxy: {
        // Only selected flow requests use this prefix. Login and all other APIs keep their target.
        ...(env.VITE_FLOW_PROXY_TARGET ? {
          '/api/local-flow': {
            target: env.VITE_FLOW_PROXY_TARGET,
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/api\/local-flow/, '/api'),
            configure: (proxy: import('vite').HttpProxy.ProxyServer) => {
              // A local Java session must never overwrite the original backend's login cookie.
              proxy.on('proxyRes', (response) => { delete response.headers['set-cookie'] })
            },
          },
        } : {}),
        // 公网 Nginx 在 9999 端口转发 /api/sync-platform；9011 端口从本机无法取得 HTTP 响应。
        '/api/sync-platform': {
          target: env.VITE_SYNC_PLATFORM_PROXY_TARGET || 'http://115.227.21.133:9999',
          changeOrigin: true,
          autoRewrite: true,
        },
        // Runner 管理服务独立部署；与旧业务后端共用浏览器同源路径。
        '/api/runner-management': {
          target: env.VITE_RUNNER_MANAGEMENT_PROXY_TARGET || 'http://127.0.0.1:8092',
          changeOrigin: true,
        },
        // 第一版站点 Python 脚本生成服务，独立于旧 XML/规则脚本接口。
        '/api/ai/site-script/': {
          target: env.VITE_SITE_SCRIPT_AI_PROXY_TARGET || 'http://127.0.0.1:8091',
          changeOrigin: true,
          timeout: 130_000,
        },
        // data-process 生成脚本服务单独部署（0831）：不在 9999 业务后端上，联调走本地
        // 127.0.0.1:8080。注意 Vite 代理按对象键插入顺序做前缀匹配，这条更长的前缀
        // 必须放在下面的 '/api' 之前才会被优先命中；切换目标用 VITE_DATA_PROCESS_PROXY_TARGET。
        '/api/answer/data-process': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        // PDF 抓取节点的「解析内容」（1005）：同一台 8080 服务的 document-extract 端点，
        // 前缀与 data-process 不同名，必须单独一条并排在通用 '/api' 之前。
        // 分块抽取后一次解析可能跑十几分钟，代理不设总时长上限；主动超时由
        // 前端按「空闲」计时（收到事件就续期），卡住才会断。
        '/api/answer/document-extract': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        // 脚本文件下载接口与 data-process 使用同一台 8080 服务；
        // 必须放在通用 '/api' 之前，否则会被转发到业务后端并返回 404。
        '/api/file/download': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        // 脚本保存接口与文件下载使用同一台 8080 文件服务；
        // 必须放在通用 '/api' 之前，否则保存请求会被转发到业务后端。
        '/api/file/upload': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        // ck_source 监控源配置（vanv-data-engine SourceController，2026-09-05）：数据监控节点
        // 保存时同步落库，与 data-process 同一台 8080 服务；同样必须排在通用 '/api' 之前。
        '/api/source': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        // OCR 识别（OCR抓取节点，2026-09-17）：独立部署的第三方服务，**不在业务后端上**，
        // 浏览器直连它是跨源（CORS 会拦），所以收进同源：页面请求 /ocr → 转发到 OCR 服务 /ocr。
        // 切换目标用 VITE_OCR_PROXY_TARGET；生产环境要由 Nginx 反代同一个 /ocr 前缀。
        '/ocr': {
          target: env.VITE_OCR_PROXY_TARGET || 'http://118.25.96.217:4864',
          changeOrigin: true,
        },
        // 语音转文字（音频提取文字节点，2026-09-17）：接口在 vanv-data-engine 的 speech 包，
        // 与 data-process 服务同一台 8080；前缀必须排在通用 '/api' 之前，否则会被业务后端
        // （9999）兜底并返回 404。切换目标用 VITE_DATA_PROCESS_PROXY_TARGET。
        '/api/speech': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
          // 转写是同步长请求（后端读超时 3 分钟），代理默认超时会先断开
          timeout: 200_000,
        },
        // 翻译（翻译助手节点，2026-09-18）：接口在 vanv-data-engine 的 translate 包，与 data-process
        // 同一台 8080。**注意它不在 /api/answer 下**，必须单独转发，否则会被通用 '/api' 送到业务后端（9999）404。
        '/api/translate': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
          // 后端读百度的超时是 1 分钟，代理给足
          timeout: 120_000,
        },
        // 视频提取音频（视频提取音频节点，2026-09-17）：接口在 vanv-data-engine 的 media 包，
        // 同一台 8080；理由同 /api/speech（必须排在通用 '/api' 之前）。
        // 转码同步执行、后端超时默认 5 分钟，代理给足时间。
        '/api/media': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
          timeout: 330_000,
        },
        // 提示词模板列表（规则节点工作区，2026-09-10 迁移自硬编码 127.0.0.1:8080）：与
        // data-process 同一台 8080 服务；前缀必须排在通用 '/api' 之前，否则会被业务后端
        // （9999）兜底并返回 404。切换目标用 VITE_DATA_PROCESS_PROXY_TARGET。
        '/api/prompt': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        // 模型供应商 / 模型候选（规则节点工作区，2026-09-10 迁移自硬编码 localhost:8080）：
        // 与 data-process 同一台 8080 服务；前缀必须排在通用 '/api' 之前，理由同 /api/prompt。
        '/api/model': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        // 旧 ai-chat-view 的模板配置服务（1013 迁入 SQL 模板配置）：`/api/poc/*` 是**独立进程**，
        // 不在 9999 业务后端上，打到通用 '/api' 会 404。前缀必须排在通用 '/api' 之前才会优先命中。
        // 切换目标用 VITE_POC_PROXY_TARGET；生产/测试环境要由 Nginx 反代同一个 /api/poc 前缀。
        '/api/poc': {
          target: pocProxyTarget,
          changeOrigin: true,
          autoRewrite: true,
        },
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          // 会话失效的 302 Location 指向后端绝对地址（计划 §12.4）：不改写的话浏览器会跨域直连后端触发
          // CORS 失败，掩盖会话失效检测；autoRewrite 把 Location 的 host 改写回本地源，保持 dev 与生产一致。
          autoRewrite: true,
        },
        // 旧平台对外取数接口使用 /rest/api/v1/data/entry；开发环境也要保持同源，
        // 否则复制出的 API 地址会落到 Vite 页面服务而不是后端。
        '/rest': {
          target: proxyTarget,
          changeOrigin: true,
          autoRewrite: true,
        },
        // 文件预览（0819 N2）：OSS 下载服务在同机的 **9102** 端口，与业务后端（9999）不同源。
        // 浏览器不允许页面跨源读取内容——「新窗口打开/下载」不受限，但站内预览必须 fetch 到
        // 字节流才能渲染（Excel 要解析、PDF 要喂给 iframe），跨源直取会被 CORS 拒（实测
        // Failed to fetch）。故按 /api、/rest、/vrule 同款做法收进同源。
        // 真实路径形如 /oss/api/oss/download?fileId=/qinlong/xxx.xlsx，转发时去掉 /oss 前缀。
        '/oss': {
          target: proxyTarget.replace(/:\d+$/, ':9102'),
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/oss/, ''),
        },
        '/vrule/fastapi/execute/code': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        // 规则编排 Sprint 4：saveMeta/test/saveScript 直连同机 vrule（0801 方案 §8.1）
        '/vrule': {
          target: proxyTarget,
          changeOrigin: true,
          autoRewrite: true,
          // 生成脚本是流式长请求（前端 120s abort），代理默认超时会先断开。
          timeout: 180_000,
        },
      },
    },
    // @/ 路径别名（计划 优化修改 0723_架构重构_计划.md · A.0 Step -1）
    // 用 fileURLToPath 而非 __dirname：本项目 vite.config 是 ESM（package.json "type": "module"），__dirname 不可用
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
