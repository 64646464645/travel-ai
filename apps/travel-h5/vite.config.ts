import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

// Vant 的样式入口必须在启动时就全部预构建。
// 否则懒加载路由首次被访问时才被发现，Vite 会二次预构建，并删除旧的依赖缓存目录。
const vantStyleEntries = [
  'button',
  'cell',
  'cell-group',
  'collapse',
  'collapse-item',
  'dialog',
  'empty',
  'field',
  'form',
  'icon',
  'image',
  'loading',
  'nav-bar',
  'notice-bar',
  'picker',
  'popup',
  'swipe-cell',
  'tabbar',
  'tabbar-item',
  'tag',
  'toast',
].map((name) => `vant/es/${name}/style/index`)

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@travel/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['vant/es', ...vantStyleEntries],
  },
  server: {
    fs: {
      allow: [workspaceRoot],
    },
    watch: {
      // android/ 下是 Capacitor 原生工程与 gradle 产物，dist/ 是构建输出；
      // 二者都不该触发 HMR 或整页 reload。
      ignored: ['**/android/**', '**/dist/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    vue(),
    AutoImport({
      resolvers: [VantResolver()],
    }),
    Components({
      resolvers: [VantResolver()],
    }),
  ],
})
