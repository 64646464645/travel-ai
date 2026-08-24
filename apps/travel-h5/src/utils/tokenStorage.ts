import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const REFRESH_TOKEN_KEY = 'travel_ai_refresh_token'

export interface TokenStorage {
  getRefreshToken(): Promise<string | null>
  setRefreshToken(token: string): Promise<void>
  removeRefreshToken(): Promise<void>
}

const webTokenStorage: TokenStorage = {
  async getRefreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  },
  async setRefreshToken(token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token)
  },
  async removeRefreshToken() {
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  },
}

const nativeTokenStorage: TokenStorage = {
  async getRefreshToken() {
    return (await Preferences.get({ key: REFRESH_TOKEN_KEY })).value
  },
  async setRefreshToken(token) {
    await Preferences.set({ key: REFRESH_TOKEN_KEY, value: token })
  },
  async removeRefreshToken() {
    await Preferences.remove({ key: REFRESH_TOKEN_KEY })
  },
}

export const tokenStorage = Capacitor.isNativePlatform() ? nativeTokenStorage : webTokenStorage
