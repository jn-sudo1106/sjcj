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
    // 并发上限（2026-09-01）：Vitest 默认 maxWorkers = 可用核数 - 1（本机 10 核 → 9 个并发 fork）。
    // 全量跑时，`src/api/*Http.test.ts` 等 `@vitest-environment jsdom` 文件会逐个 `vi.resetModules()` +
    // 动态 import 整个 API 模块树（index→client→mock/endpoints/…），单个用例的 import/environment 开销很大；
    // 9 个这样的重型 fork 同时跑会造成内存竞争与事件循环拥塞，偶发命中 5s 默认超时
    // （即 ruleHttp/sourceHttp 的既有 flaky：`Test timed out in 5000ms`）。限到 4 个并发 fork，
    // 显著降低峰值内存与拥塞，代价是墙钟略增；CI/核数不同的机器可自行调整。
    maxWorkers: 4,
    // 用例超时从默认 5s 抬到 15s（2026-09-11）。上面那段拥塞并没有被 maxWorkers=4 根治：
    // 机器另有负载时（开着 dev server、或同时跑第二个 vitest），jsdom 文件里等 Element Plus
    // teleport + 过渡挂载的用例仍会撞上 5s，报成 `Test timed out in 5000ms`——看着像组件坏了，
    // 其实只是没等够。实测：机器空闲时全量三次全过，双进程并发时必现。
    //
    // **改这个数时必须同时看 SqlConditionEditor.test.ts 的 WAIT**：那里的 vi.waitFor 超时
    // 必须明显小于这个值，否则 waitFor 还没来得及报"等不到哪个元素"，整条用例就先超时了，
    // 错误信息反而更没用（2026-09-11 就这么踩过一次：WAIT 抬到 8s 而这里还是默认 5s）。
    testTimeout: 15_000,
    // 测试固定跑 mock 模式，不受本地 .env.local（真实后端联调开关）影响；
    // 个别测试要模拟真实 HTTP 协议时用 vi.stubEnv('VITE_API_MODE', 'http') 显式覆盖。
    // 同理关掉「逐端点上线」逃逸（endpoints.ts 的 live 标记，见 client.ts）：那是给真实浏览器/生产用的机制，
    // 测试永远要纯 mock、可预期、不发真实请求；专门测这套机制本身的用例用
    // vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '') 显式重新打开。
    env: { VITE_API_MODE: 'mock', VITE_API_DISABLE_LIVE_ENDPOINTS: '1', VITE_FLOW_PROXY_TARGET: '' },
  },
})
