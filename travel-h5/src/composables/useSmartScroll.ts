import { ref, nextTick, onMounted, onUnmounted, type Ref } from 'vue'
import {
  SCROLL_BOTTOM_THRESHOLD,
  SCROLL_THROTTLE_MS,
  AUTO_SCROLL_THROTTLE_MS,
  SCROLL_UP_DELTA_MIN,
} from '../constants/chat'
import { throttle } from '../utils/throttle'

/** 容器底部剩余可滚动距离（px） */
function getDistanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

/** 是否在「底部附近」，用于判定用户是否主动滚回底部 */
function isNearBottom(el: HTMLElement): boolean {
  return getDistanceFromBottom(el) <= SCROLL_BOTTOM_THRESHOLD
}

/**
 * 流式对话智能滚动 composable
 *
 * 解决自动滚底与用户主动浏览的冲突：
 * - 用 scrollTop 位置差检测用户上滑（锁定自动滚动）
 * - 用距底阈值检测用户回到底部（恢复自动滚动）
 * - 双层节流分别约束 scroll 监听与程序滚底频率
 */
export function useSmartScroll(containerRef: Ref<HTMLElement | null>) {
  /** 是否允许自动滚底，暴露给 UI 层（如「回到底部」按钮） */
  const isAutoScrollEnabled = ref(true)

  /** 上次 scrollTop，用于计算滚动位置差 */
  let lastScrollTop = 0
  /** 程序触发的 scroll 标记，避免误判为用户操作 */
  let isProgrammaticScroll = false

  /**
   * 滚到底部
   * @param force - true 时忽略锁定状态（用户发消息等场景）
   */
  const scrollToBottom = async (force = false) => {
    const el = containerRef.value
    if (!el) return
    if (!force && !isAutoScrollEnabled.value) return

    await nextTick()

    isProgrammaticScroll = true
    el.scrollTop = el.scrollHeight
    lastScrollTop = el.scrollTop
    requestAnimationFrame(() => {
      isProgrammaticScroll = false
    })
  }

  /** 流式 chunk 高频更新时使用，合并多次滚底请求 */
  const throttledScrollToBottom = throttle(() => scrollToBottom(), AUTO_SCROLL_THROTTLE_MS)

  /** 用户发消息时调用：解锁并强制滚底 */
  const resetAutoScroll = () => {
    isAutoScrollEnabled.value = true
    scrollToBottom(true)
  }

  /**
   * 用户滚动意图判定
   *
   * 仅用「距底距离」会在流式内容增高时误判（scrollHeight 变大即视为离开底部），
   * 因此用 scrollTop 位置差识别真实的用户上滑行为。
   */
  const onScroll = () => {
    const el = containerRef.value
    if (!el || isProgrammaticScroll) return

    const currentTop = el.scrollTop
    const delta = currentTop - lastScrollTop
    lastScrollTop = currentTop

    if (delta < -SCROLL_UP_DELTA_MIN) {
      isAutoScrollEnabled.value = false
      return
    }

    if (isNearBottom(el)) {
      isAutoScrollEnabled.value = true
    }
  }

  const throttledOnScroll = throttle(onScroll, SCROLL_THROTTLE_MS)

  onMounted(() => {
    const el = containerRef.value
    if (!el) return
    lastScrollTop = el.scrollTop
    el.addEventListener('scroll', throttledOnScroll, { passive: true })
  })

  onUnmounted(() => {
    containerRef.value?.removeEventListener('scroll', throttledOnScroll)
  })

  return {
    isAutoScrollEnabled,
    scrollToBottom,
    throttledScrollToBottom,
    resetAutoScroll,
  }
}
