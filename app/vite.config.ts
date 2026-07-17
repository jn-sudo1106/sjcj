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
    },
  }
})
