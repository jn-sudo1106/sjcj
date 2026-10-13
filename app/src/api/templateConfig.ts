// 模板配置域（/api/poc/*）的接口层。
//
// 旧平台这 8 个「模板配置」子模块的接口是同一套写法（见旧 src/demoApi/EntityApi.js）：
//   POST {base}/page      body {pageNo,pageSize,...筛选}  → {code,count,data:[...]}
//   POST {base}           body 整个表单（带 id = 更新，不带 = 新增）
//   POST {base}/status    **query** {id,status}
//   POST {base}/copy      **query** {id}
// 所以这里做成一个 CRUD 工厂，迁一个模块只需声明 base + 端点清单，不再手写四个函数。
//
// 真实路径是站点根相对 /api/poc/…（**不是** /v1 域，也不拼 BASE_URL /api/v1/）：
// POC 服务是独立进程，dev 代理见 vite.config.ts 的 '/api/poc'，生产要由 Nginx 反代同一前缀。
// 逻辑键统一 `poc/` 前缀（与 endpoints.ts 的契约清单一一对应，live/mock 判定按它，见 client.ts usesMockAdapter）。

import { request } from './client'
import { POC_API_PREFIX } from '@/constants/backend'
import type { Ack, Paged } from './types/common'
import type { SqlTemplate, TemplateCrudApi, TemplateCrudPaths, TemplatePageQuery, TemplateRow } from './types/template'

export interface TemplateCrudConfig {
  /** endpoints.ts 里的模块名，逻辑键 = `poc/${module}${后缀}`，如 sql-temp → poc/sql-temp/page */
  module: string
  /** 是否提供启停 / 复制（旧平台个别模块没有 /status、/copy） */
  operations?: Partial<Record<'status' | 'copy', false>>
  /** 端点后缀覆盖，默认按旧平台约定 page / 根 / status / copy */
  paths?: TemplateCrudPaths
}

const DEFAULT_PATHS = { page: '/page', save: '', status: '/status', copy: '/copy' } as const

/** 建一个模板模块的 CRUD 接口（分页 + 新增/编辑 + 启停 + 复制） */
export function createTemplateCrudApi<T extends TemplateRow>(config: TemplateCrudConfig): TemplateCrudApi<T> {
  const paths = { ...DEFAULT_PATHS, ...config.paths }
  const suffixes: Record<'page' | 'save' | 'status' | 'copy', string> = {
    page: paths.page,
    save: paths.save,
    status: paths.status,
    copy: paths.copy,
  }
  const httpUrl = (op: keyof typeof suffixes) => `${POC_API_PREFIX}/${config.module}${suffixes[op]}`
  const logicKey = (op: keyof typeof suffixes) => `poc/${config.module}${suffixes[op]}`

  const api: TemplateCrudApi<T> = {
    // 分页：筛选条件由调用方按旧字段名传（sql 模板是 name），参数走 body
    page: (query: TemplatePageQuery) =>
      request<Paged<T>>(logicKey('page'), { ...query }, { method: 'POST', httpEndpoint: httpUrl('page') }),
    // 新增与修改是同一个端点：form.id 有值即更新（旧 sqlTempSave 直接整个表单 POST）
    save: (form: Partial<T>) =>
      request<Ack>(logicKey('save'), { ...form }, { method: 'POST', httpEndpoint: httpUrl('save') }),
  }
  if (config.operations?.status !== false) {
    api.changeStatus = (id: number, status: string) =>
      request<Ack>(logicKey('status'), { id, status }, { method: 'POST', paramsIn: 'query', httpEndpoint: httpUrl('status') })
  }
  if (config.operations?.copy !== false) {
    api.copy = (id: number) =>
      request<Ack>(logicKey('copy'), { id }, { method: 'POST', paramsIn: 'query', httpEndpoint: httpUrl('copy') })
  }
  return api
}

/** sql 模板配置（旧「模板配置 → sql模板配置」） */
export const sqlTemplateApi = createTemplateCrudApi<SqlTemplate>({ module: 'sql-temp' })
