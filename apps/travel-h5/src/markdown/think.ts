import type MarkdownIt from 'markdown-it'

const OPEN = '<think>'
const CLOSE = '</think>'

/**
 * markdown-it 插件：将行首的 `<think>...</think>` 解析为配对的自定义 token。
 * 内部内容继续作为块级 Markdown 解析，渲染层再映射为 ThinkBlock 组件。
 */
export function thinkPlugin(md: MarkdownIt): void {
  md.block.ruler.before('paragraph', 'think', (state, startLine, _endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine]
    const lineStart = state.src.slice(startPos, state.eMarks[startLine])

    // 仅当行首（忽略缩进）以 <think> 开头时接管
    if (!lineStart.startsWith(OPEN)) {
      return false
    }

    const closeIndex = state.src.indexOf(CLOSE, startPos + OPEN.length)
    if (closeIndex === -1) {
      // 流式输出中尚未闭合，交还给普通段落处理，避免报错
      return false
    }

    // 找到 </think> 所在行，用于消费这些行
    let closeLine = startLine
    while (closeLine < state.lineMax && closeIndex >= state.eMarks[closeLine]) {
      closeLine++
    }

    if (silent) {
      return true
    }

    state.push('think_open', 'think', 1)

    const innerSrc = state.src.slice(startPos + OPEN.length, closeIndex)
    state.md.block.parse(innerSrc, state.md, state.env, state.tokens)

    state.push('think_close', 'think', -1)

    state.line = closeLine + 1
    return true
  })
}
