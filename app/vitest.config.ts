import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 测试固定跑 mock 模式，不受本地 .env.local（真实后端联调开关）影响；
    // 个别测试要模拟真实 HTTP 协议时用 vi.stubEnv('VITE_API_MODE', 'http') 显式覆盖。
    env: { VITE_API_MODE: 'mock' },
  },
})
