export function throttle(fn, delay) {
  let timer = null
  let lastArgs = null

  return function (...args) {
    lastArgs = args
    if (timer) return
    timer = setTimeout(() => {
      fn.apply(this, lastArgs)
      timer = null
      lastArgs = null
    }, delay)
  }
}
