// 问数会话冷缓存：LRU 淘汰出的会话消息体落 IndexedDB，切回时秒开。
// 只是加速层——真源仍是后端 chat_log；IndexedDB 不可用（如 jsdom）时静默退化。
import type { ChatMessage } from '@/api/aiChat'

const DB_NAME = 'rc-aichat-cold-cache'
const STORE = 'session-messages'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function saveColdMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(JSON.parse(JSON.stringify(messages)), sessionId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // 冷缓存写失败不影响主流程
  } finally {
    db.close()
  }
}

export async function loadColdMessages(sessionId: string): Promise<ChatMessage[] | null> {
  const db = await openDb()
  if (!db) return null
  try {
    return await new Promise<ChatMessage[] | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(sessionId)
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as ChatMessage[]) : null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  } finally {
    db.close()
  }
}

export async function dropColdMessages(sessionId: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(sessionId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // 忽略
  } finally {
    db.close()
  }
}