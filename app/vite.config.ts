import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
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
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || process.env.VITE_AUTH_PROXY_TARGET || 'http://115.227.21.133:9999',
        changeOrigin: true,
        // 会话失效的 302 Location 指向后端绝对地址（计划 §12.4）：不改写的话浏览器会跨域直连后端触发
        // CORS 失败，掩盖会话失效检测；autoRewrite 把 Location 的 host 改写回本地源，保持 dev 与生产一致。
        autoRewrite: true,
      },
      // 旧平台对外取数接口使用 /rest/api/v1/data/entry；开发环境也要保持同源，
      // 否则复制出的 API 地址会落到 Vite 页面服务而不是后端。
      '/rest': {
        target: process.env.VITE_API_PROXY_TARGET || process.env.VITE_AUTH_PROXY_TARGET || 'http://115.227.21.133:9999',
        changeOrigin: true,
        autoRewrite: true,
      },
      // 文件预览（0819 N2）：OSS 下载服务在同机的 **9102** 端口，与业务后端（9999）不同源。
      // 浏览器不允许页面跨源读取内容——「新窗口打开/下载」不受限，但站内预览必须 fetch 到
      // 字节流才能渲染（Excel 要解析、PDF 要喂给 iframe），跨源直取会被 CORS 拒（实测
      // Failed to fetch）。故按 /api、/rest、/vrule 同款做法收进同源。
      // 真实路径形如 /oss/api/oss/download?fileId=/qinlong/xxx.xlsx，转发时去掉 /oss 前缀。
      '/oss': {
        target: (process.env.VITE_API_PROXY_TARGET || process.env.VITE_AUTH_PROXY_TARGET || 'http://115.227.21.133:9999')
          .replace(/:\d+$/, ':9102'),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/oss/, ''),
      },
      // 规则编排 Sprint 4：saveMeta/test/saveScript 直连同机 vrule（0801 方案 §8.1）
      '/vrule': {
        target: process.env.VITE_API_PROXY_TARGET || process.env.VITE_AUTH_PROXY_TARGET || 'http://115.227.21.133:9999',
        changeOrigin: true,
        autoRewrite: true,
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
})
