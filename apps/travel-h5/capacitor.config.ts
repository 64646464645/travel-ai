import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.travelai.app',
  appName: 'TravelAI',
  webDir: 'dist',
  server: {
    // 本地 assets 模式：页面由 APK 内置资源加载，origin 为 http://localhost。
    // 用 http scheme 而非默认的 https://localhost，请求 http 后端才不构成混合内容，
    // 也就不需要开 allowMixedContent。
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    minWebViewVersion: 90,
  },
}

export default config
