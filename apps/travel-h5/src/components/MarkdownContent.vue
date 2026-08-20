<script lang="ts">
import { defineComponent, h } from 'vue'
import { renderMarkdown } from '../markdown/render'

export default defineComponent({
  name: 'MarkdownContent',
  props: {
    content: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () => h('div', { class: 'markdown-content' }, renderMarkdown(props.content))
  },
})
</script>

<style>
.markdown-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}

.markdown-content > :first-child {
  margin-top: 0;
}

.markdown-content > :last-child {
  margin-bottom: 0;
}

.markdown-content .md-paragraph {
  margin: 0 0 8px;
}

.markdown-content .md-heading {
  font-weight: 600;
  line-height: 1.3;
  margin: 12px 0 8px;
}

.markdown-content h1.md-heading {
  font-size: 20px;
}

.markdown-content h2.md-heading {
  font-size: 18px;
}

.markdown-content h3.md-heading {
  font-size: 16px;
}

.markdown-content h4.md-heading,
.markdown-content h5.md-heading,
.markdown-content h6.md-heading {
  font-size: 15px;
}

.markdown-content .md-list {
  margin: 0 0 8px;
  padding-left: 20px;
}

.markdown-content .md-list-item {
  margin: 2px 0;
}

.markdown-content .md-blockquote {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid #ddd;
  color: #666;
}

.markdown-content .md-link {
  color: #1989fa;
  text-decoration: none;
}

.markdown-content .md-code-inline {
  background: #f0f0f0;
  padding: 2px 4px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
}

.markdown-content .md-code-block {
  background: #f6f8fa;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
  white-space: pre;
}

.markdown-content .md-code-block code {
  background: transparent;
  padding: 0;
  font-family: monospace;
  font-size: 13px;
}

.markdown-content .md-image {
  max-width: 100%;
  border-radius: 8px;
}

.markdown-content .md-hr {
  border: none;
  border-top: 1px solid #eee;
  margin: 12px 0;
}
</style>
