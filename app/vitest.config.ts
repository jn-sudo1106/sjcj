import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // @/ 路径别名（计划 优化修改 0723_架构重构_计划.md · A.0 Step -1）
  // ⚠️ 不能省：vitest 不会自动继承 vite.config 的 alias，必须显式加，否则 `npm test` 时
  // 所有 `@/...` 开头的 import 全部 resolve 失败。
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'],
    // 测试固定跑 mock 模式，不受本地 .env.local（真实后端联调开关）影响；
    // 个别测试要模拟真实 HTTP 协议时用 vi.stubEnv('VITE_API_MODE', 'http') 显式覆盖。
    // 同理关掉「逐端点上线」逃逸（endpoints.ts 的 live 标记，见 client.ts）：那是给真实浏览器/生产用的机制，
    // 测试永远要纯 mock、可预期、不发真实请求；专门测这套机制本身的用例用
    // vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '') 显式重新打开。
    env: { VITE_API_MODE: 'mock', VITE_API_DISABLE_LIVE_ENDPOINTS: '1' },
  },
})
