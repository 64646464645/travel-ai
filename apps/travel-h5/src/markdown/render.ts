import { h, type VNode } from 'vue'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { thinkPlugin } from './think'
import ThinkBlock from '../components/ThinkBlock.vue'

const md = new MarkdownIt({
  html: false,
  linkify: true,
})

md.use(thinkPlugin)

type RenderNode = VNode | string

/**
 * 将 Markdown 文本解析为 token 并递归渲染为 Vue VNode。
 * 文本以 VNode children 呈现，由 Vue 自动转义，不使用 v-html。
 */
export function renderMarkdown(content: string): RenderNode[] {
  const tokens = md.parse(content, {})
  return renderTokens(tokens)
}

function renderTokens(tokens: Token[]): RenderNode[] {
  const nodes: RenderNode[] = []
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]

    // 行内 token 的 children 才是真正的内容
    if (token.type === 'inline') {
      nodes.push(...renderTokens(token.children ?? []))
      i++
      continue
    }

    if (token.nesting === 1) {
      const { children, next } = collectChildren(tokens, i)
      const node = renderOpen(token, renderTokens(children))
      if (node) nodes.push(node)
      i = next
      continue
    }

    if (token.nesting === 0) {
      const node = renderLeaf(token)
      if (node != null) nodes.push(node)
      i++
      continue
    }

    // 孤立的关闭 token，跳过
    i++
  }

  return nodes
}

function collectChildren(tokens: Token[], openIndex: number): { children: Token[]; next: number } {
  let depth = 0
  let i = openIndex

  while (i < tokens.length) {
    const token = tokens[i]
    if (token.nesting === 1) {
      depth++
    } else if (token.nesting === -1) {
      depth--
      if (depth === 0) {
        return { children: tokens.slice(openIndex + 1, i), next: i + 1 }
      }
    }
    i++
  }

  return { children: tokens.slice(openIndex + 1), next: tokens.length }
}

function renderOpen(token: Token, children: RenderNode[]): VNode | null {
  switch (token.type) {
    case 'heading_open':
      return h(token.tag, { class: 'md-heading' }, children)
    case 'paragraph_open':
      return h('p', { class: 'md-paragraph' }, children)
    case 'bullet_list_open':
      return h('ul', { class: 'md-list' }, children)
    case 'ordered_list_open':
      return h('ol', { class: 'md-list md-list--ordered' }, children)
    case 'list_item_open':
      return h('li', { class: 'md-list-item' }, children)
    case 'blockquote_open':
      return h('blockquote', { class: 'md-blockquote' }, children)
    case 'strong_open':
      return h('strong', {}, children)
    case 'em_open':
      return h('em', {}, children)
    case 'link_open': {
      const href = safeUrl(token.attrGet('href') ?? '')
      if (!href) {
        // 拒绝危险协议链接，仅保留其文本内容
        return h('span', {}, children)
      }
      return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'md-link' }, children)
    }
    case 'think_open':
      return h(ThinkBlock, {}, { default: () => children })
    default:
      return h('span', {}, children)
  }
}

function renderLeaf(token: Token): RenderNode | null {
  switch (token.type) {
    case 'text':
      return token.content
    case 'code_inline':
      return h('code', { class: 'md-code-inline' }, token.content)
    case 'fence':
    case 'code_block':
      return h('pre', { class: 'md-code-block' }, [h('code', {}, token.content)])
    case 'softbreak':
      return '\n'
    case 'hardbreak':
      return h('br')
    case 'hr':
      return h('hr', { class: 'md-hr' })
    case 'image': {
      const src = safeUrl(token.attrGet('src') ?? '')
      if (!src) return null
      const alt = token.content || token.attrGet('alt') || ''
      return h('img', { src, alt, class: 'md-image' })
    }
    default:
      return null
  }
}

/**
 * 链接/图片协议白名单：仅允许 http、https、mailto 与相对路径，
 * 拒绝 javascript:、data: 等危险协议。
 */
function safeUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      return trimmed
    }
    return null
  }

  return trimmed
}
