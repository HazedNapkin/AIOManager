import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

// Many addon "documentation" fields are the project's GitHub README, which is markdown
// with embedded raw HTML (<picture>, <img>, shields.io badges). rehype-raw
// parses that HTML; rehype-sanitize makes it XSS-safe. Lazy-loaded so this whole
// pipeline only enters the bundle when a detail drawer renders documentation.
function isBadge(src?: string): boolean {
  if (!src) return true
  return /shields\.io|img\.shields|badge|githubusercontent.*\/(actions|workflows)/i.test(src)
}

export default function DiscoverMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_img]:my-2 [&_img]:inline-block [&_li]:ml-4 [&_li]:list-disc [&_strong]:text-foreground [&_table]:my-2 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-xs [&_th]:whitespace-nowrap [&_th]:border [&_th]:border-border/40 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_td]:whitespace-nowrap [&_td]:border [&_td]:border-border/40 [&_td]:px-2 [&_td]:py-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          // Drop dev badges (build status, stars, Discord, etc.); keep real art like logos.
          img: ({ node: _node, src, ...props }) =>
            isBadge(typeof src === 'string' ? src : undefined)
              ? null
              : <img src={src} {...props} loading="lazy" className="max-h-32 rounded-lg object-contain" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
