// API 类型统一 re-export 转发器（P1-3 拆 8 域）
// 原 763 行的 `api/types.ts` 已拆为 `api/types/{common,collect,param,rule,data,monitor,overview,source,index}.ts`。
// 本文件仅做转发：保持 `import type { Xxx } from '../../api/types'` 的旧路径仍工作。
// 新代码建议直接 `import type { Xxx } from '@/api/types'`，避免再走 .ts 转发一层。
export * from './types'
