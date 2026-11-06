import { Capacitor, registerPlugin } from '@capacitor/core'

export interface WebViewMetrics {
  /** WebView 内核包名，例如 com.google.android.webview */
  providerPackage: string
  /** WebView 内核版本号，例如 138.0.7204.179 */
  providerVersion: string
  /** Android SDK_INT */
  sdkInt: number
  /** MainActivity 创建到 WebView 就绪的耗时，-1 表示未采集到 */
  initCostMs: number
  /** 最近一次页面 onPageStarted → onPageLoaded 的耗时，-1 表示未采集到 */
  pageLoadMs: number
  /** 首屏绘制耗时，取自 Paint Timing API；null 表示浏览器不支持或无记录 */
  firstPaintMs: number | null
}

interface NativeWebViewMetricsInfo {
  providerPackage: string
  providerVersion: string
  sdkInt: number
  initCostMs: number
  pageLoadMs: number
}

interface WebViewMetricsPluginApi {
  getInfo(): Promise<NativeWebViewMetricsInfo>
}

const WebViewMetricsNative = registerPlugin<WebViewMetricsPluginApi>('WebViewMetrics')

/**
 * Capacitor 桥接未暴露 onPageCommitVisible，原生侧拿不到可靠的「首次绘制」时刻，
 * 因此 firstPaintMs 由 Web 侧 Paint Timing API 提供。
 */
function readFirstPaintMs(): number | null {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return null
  }

  const entries = performance.getEntriesByType('paint')
  const picked =
    entries.find((entry) => entry.name === 'first-contentful-paint') ??
    entries.find((entry) => entry.name === 'first-paint')

  return picked ? Math.round(picked.startTime) : null
}

/**
 * 采集 WebView 运行环境指标。非原生平台返回 null，不产生任何副作用。
 */
export async function getWebViewMetrics(): Promise<WebViewMetrics | null> {
  if (!Capacitor.isNativePlatform()) return null

  const firstPaintMs = readFirstPaintMs()
  const info = await WebViewMetricsNative.getInfo()

  return {
    providerPackage: info.providerPackage,
    providerVersion: info.providerVersion,
    sdkInt: info.sdkInt,
    initCostMs: info.initCostMs,
    pageLoadMs: info.pageLoadMs,
    firstPaintMs,
  }
}
