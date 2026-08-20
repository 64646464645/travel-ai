export function throttle<T extends (...args: unknown[]) => void>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  return function (this: unknown, ...args: Parameters<T>) {
    lastArgs = args
    if (timer) return
    timer = setTimeout(() => {
      fn.apply(this, lastArgs!)
      timer = null
      lastArgs = null
    }, delay)
  }
}
