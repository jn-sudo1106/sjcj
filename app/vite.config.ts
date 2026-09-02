import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { DEFAULT_API_PROXY_TARGET } from './src/constants/backend'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite 在 evaluate 本配置文件时并不会把 .env 注入 process.env（配置先于 .env 加载），
  // 直接读 process.env.VITE_* 只会命中硬编码兜底，导致 app/.env 里的代理目标永不生效。
  // 必须用 loadEnv 在当前目录（app/）显式读取。
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget =
    env.VITE_API_PROXY_TARGET || env.VITE_AUTH_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  // 没有 .env 时，前端 isProductionBackend 也要读到同一地址，不能只改了 proxy 而守卫仍当「未连生产」。
  if (!env.VITE_API_PROXY_TARGET) process.env.VITE_API_PROXY_TARGET = proxyTarget
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
        // data-process 生成脚本服务单独部署（0831）：不在 9999 业务后端上，联调走本地
        // 127.0.0.1:8080。注意 Vite 代理按对象键插入顺序做前缀匹配，这条更长的前缀
        // 必须放在下面的 '/api' 之前才会被优先命中；切换目标用 VITE_DATA_PROCESS_PROXY_TARGET。
        '/api/answer/data-process': {
          target: env.VITE_DATA_PROCESS_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
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
