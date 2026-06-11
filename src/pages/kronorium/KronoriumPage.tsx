import { source } from '@/lib/source'
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/page'
import { useLocation, Navigate } from 'react-router-dom'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import * as Components from '@/components/kronorium/KronoriumComponents'
import { Callout } from 'fumadocs-ui/components/callout'
import { Card, Cards } from 'fumadocs-ui/components/card'
import { Steps, Step } from 'fumadocs-ui/components/steps'
import { Tabs, Tab } from 'fumadocs-ui/components/tabs'
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { InstanceTabs } from '@/components/kronorium/InstanceTabs'

export function KronoriumPage() {
  const location = useLocation()
  // Strip the /kronorium prefix and split into slug parts
  const slug = location.pathname
    .replace(/^\/kronorium\/?/, '')
    .split('/')
    .filter(Boolean)

  const page = source.getPage(slug.length ? slug : [])

  if (!page) return <Navigate to="/404" replace />

  const isIndex = slug.length === 0
  const { body: MDX, toc } = page.data as any

  const content = (
    <MDX
      components={{
        ...defaultMdxComponents,
        Note: (props: any) => <Callout type="info" {...props} />,
        Warning: (props: any) => <Callout type="warn" {...props} />,
        Tip: (props: any) => <Callout type="info" {...props} />,
        Callout,
        Card,
        Cards,
        Steps,
        Step,
        Tabs,
        Tab,
        Accordions,
        Accordion,
        Hero: Components.Hero,
        NavCards: Components.NavCards,
        NavCard: Components.NavCard,
        SectionHeading: Components.SectionHeading,
        MockupFlow: Components.MockupFlow,
        MockupToggle: Components.MockupToggle,
        DemoAddonCard: Components.DemoAddonCard,
        DemoFailoverChain: Components.DemoFailoverChain,
        DemoVaultKey: Components.DemoVaultKey,
        DemoAccountActions: Components.DemoAccountActions,
        DemoRuleCard: Components.DemoRuleCard,
        DemoDiscordEmbed: Components.DemoDiscordEmbed,
        InstanceTabs: InstanceTabs,
      }}
    />
  )

  if (isIndex) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
        {content}
      </div>
    )
  }

  return (
    <DocsPage
      toc={toc}
      full={false}
      tableOfContent={{ style: 'clerk' }}
      breadcrumb={{
        enabled: true,
        includePage: true,
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        {content}
      </DocsBody>
    </DocsPage>
  )
}
