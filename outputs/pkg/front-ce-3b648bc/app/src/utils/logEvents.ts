import { logReportApi, type LogContentType } from '@/api'

/**
 * 通用埋点 · 业务事件上报（CLICK / EDIT / CREATE / DELETE）。
 *
 * 「进入/退出」不走这里——它需要 visitId 配对，收在 `utils/siteRecents.ts`。
 * 这里只做一件事：**动作成功后**打一条埋点，失败静默、绝不阻塞主流程。
 *
 * 约定：
 * - **只在接口成功之后调用**（删除失败也记账 = 脏数据）；
 * - `contentTitle` 尽量传：后端最近列表直接拿它展示；
 * - `eventCode` 用 `模块_动作` 形式（如 `flow_save`），便于后端筛选统计。
 */

export interface TrackMeta {
  /** 事件编码，最长 64，如 `flow_save` */
  eventCode: string
  /** 事件显示名，最长 100 */
  eventName?: string
  /** 一级模块，如「流程管理」「采集资产」 */
  firstModule?: string
  /** 页面名称，如「流程编辑」 */
  pageName?: string
  /** 页面入口来源，如「模板「XX」」（复制/新建时说明从哪儿来的） */
  pageEntry?: string
}

/**
 * 兜底：埋点永远不能影响业务。
 * `logReportApi` 用可选链是给单测留的——有些用例整体 mock 了 `@/api`，里面没有这个对象。
 */
function send(
  action: 'CLICK' | 'EDIT' | 'CREATE' | 'DELETE',
  contentType: LogContentType,
  contentId: string | undefined,
  contentTitle: string | undefined,
  meta: TrackMeta,
): void {
  if (!contentId) return
  try {
    const pending = logReportApi?.report?.({
      action,
      contentType,
      contentId: String(contentId),
      contentTitle,
      ...meta,
    })
    void pending?.catch?.(() => {
      /* 尽力而为 */
    })
  } catch {
    /* 尽力而为 */
  }
}

/** 点击/查看了某个内容（文档里的「最近查看」口径） */
export function trackClick(
  contentType: LogContentType,
  contentId: string | undefined,
  contentTitle: string | undefined,
  meta: TrackMeta,
): void {
  send('CLICK', contentType, contentId, contentTitle, meta)
}

/** 修改保存成功 */
export function trackEdit(
  contentType: LogContentType,
  contentId: string | undefined,
  contentTitle: string | undefined,
  meta: TrackMeta,
): void {
  send('EDIT', contentType, contentId, contentTitle, meta)
}

/** 新建成功 */
export function trackCreate(
  contentType: LogContentType,
  contentId: string | undefined,
  contentTitle: string | undefined,
  meta: TrackMeta,
): void {
  send('CREATE', contentType, contentId, contentTitle, meta)
}

/** 删除成功 */
export function trackDelete(
  contentType: LogContentType,
  contentId: string | undefined,
  contentTitle: string | undefined,
  meta: TrackMeta,
): void {
  send('DELETE', contentType, contentId, contentTitle, meta)
}
