import CryptoJS from 'crypto-js'

const LEGACY_AES_KEY = 'a123b234c345d456'

export function encryptLegacyPayload(value: unknown): string {
  const key = CryptoJS.enc.Utf8.parse(LEGACY_AES_KEY)
  const source = CryptoJS.enc.Utf8.parse(typeof value === 'string' ? value : JSON.stringify(value))
  return CryptoJS.AES.encrypt(source, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  }).toString()
}

export function decryptLegacyPayload(value: string): string {
  const key = CryptoJS.enc.Utf8.parse(LEGACY_AES_KEY)
  const decrypted = CryptoJS.AES.decrypt(value, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  })
  return CryptoJS.enc.Utf8.stringify(decrypted)
}
