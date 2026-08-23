/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import DOMPurify, { type Config } from 'dompurify'
import { useLayoutEffect, useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'

export type HtmlContentVariant = 'inline' | 'isolated'

interface HtmlContentProps {
  content: string
  className?: string
  variant?: HtmlContentVariant
}

const isolatedContentSandbox =
  'allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation'

const isolatedContentBaseStyles = `
<style>
  :host {
    display: block;
    width: 100%;
    color: inherit;
    font: inherit;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  img,
  video,
  iframe {
    max-width: 100%;
  }

  iframe {
    border: 0;
  }
</style>
`

const isolatedSanitizeOptions = {
  ADD_ATTR: [
    'allowfullscreen',
    'autoplay',
    'class',
    'controls',
    'default',
    'id',
    'kind',
    'label',
    'loading',
    'loop',
    'muted',
    'playsinline',
    'poster',
    'preload',
    'referrerpolicy',
    'rel',
    'srclang',
    'style',
    'target',
  ],
  ADD_TAGS: ['audio', 'iframe', 'picture', 'source', 'style', 'track', 'video'],
  FORBID_ATTR: ['srcdoc'],
  FORBID_TAGS: ['base', 'embed', 'link', 'meta', 'object', 'script'],
  FORCE_BODY: true,
} satisfies Config

function hardenIsolatedHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html
  }

  const template = document.createElement('template')
  template.innerHTML = html

  template.content.querySelectorAll('a[target="_blank"]').forEach((link) => {
    const rel = new Set(
      link.getAttribute('rel')?.split(/\s+/).filter(Boolean) ?? []
    )

    rel.add('noopener')
    rel.add('noreferrer')
    link.setAttribute('rel', [...rel].join(' '))
  })

  template.content.querySelectorAll('iframe').forEach((frame) => {
    frame.removeAttribute('srcdoc')
    frame.setAttribute('sandbox', isolatedContentSandbox)
    frame.setAttribute('referrerpolicy', 'no-referrer')

    if (!frame.hasAttribute('loading')) {
      frame.setAttribute('loading', 'lazy')
    }
  })

  return template.innerHTML
}

// Admin-authored pages are large and change rarely, while navigating away and
// back remounts this component and would re-sanitize the identical markup. A
// couple of entries is enough to cover switching between home and about.
const SANITIZE_CACHE_LIMIT = 4
const sanitizeCache = new Map<string, string>()

// Parsing the markup is the other half of the mount cost, and `innerHTML` pays
// it again on every visit. A `<template>` holds an inert parsed copy we can
// clone instead — cloning a node tree is far cheaper than re-parsing the source.
const templateCache = new Map<string, HTMLTemplateElement>()

function parsedHtmlFragment(html: string): DocumentFragment {
  let template = templateCache.get(html)
  if (!template) {
    template = document.createElement('template')
    template.innerHTML = html
    if (templateCache.size >= SANITIZE_CACHE_LIMIT) {
      const oldest = templateCache.keys().next().value
      if (oldest !== undefined) templateCache.delete(oldest)
    }
    templateCache.set(html, template)
  }
  return template.content.cloneNode(true) as DocumentFragment
}

function sanitizeHtmlContent(
  content: string,
  variant: HtmlContentVariant
): string {
  const cacheKey = `${variant}:${content}`
  const cached = sanitizeCache.get(cacheKey)
  if (cached !== undefined) return cached

  const html =
    variant === 'isolated'
      ? hardenIsolatedHtml(DOMPurify.sanitize(content, isolatedSanitizeOptions))
      : DOMPurify.sanitize(content)

  if (sanitizeCache.size >= SANITIZE_CACHE_LIMIT) {
    const oldest = sanitizeCache.keys().next().value
    if (oldest !== undefined) sanitizeCache.delete(oldest)
  }
  sanitizeCache.set(cacheKey, html)

  return html
}

function syncDarkClass(wrapper: HTMLElement): void {
  const isDark = document.documentElement.classList.contains('dark')
  wrapper.classList.toggle('dark', isDark)
}

/**
 * Application styles, as constructable sheets that every isolated shadow root
 * adopts by reference.
 *
 * Cloning `<style>`/`<link>` nodes into the shadow root instead makes the
 * browser re-parse the whole application stylesheet (hundreds of KB of Tailwind)
 * on every mount — paid again each time the user navigates back to a page with
 * admin-authored HTML. Adopted sheets are parsed once per document.
 */
let adoptedSheetsCache: {
  sources: StyleSource[]
  sheets: CSSStyleSheet[]
} | null = null

type StyleSource = HTMLStyleElement | HTMLLinkElement

function collectStyleSources(): StyleSource[] {
  return [
    ...document.head.querySelectorAll<StyleSource>(
      'style, link[rel="stylesheet"]'
    ),
  ]
}

function sameSources(a: StyleSource[], b: StyleSource[]): boolean {
  return a.length === b.length && a.every((node, i) => node === b[i])
}

function buildAdoptedSheets(sources: StyleSource[]): CSSStyleSheet[] | null {
  if (typeof CSSStyleSheet === 'undefined') return null
  if (!('adoptedStyleSheets' in Document.prototype)) return null

  const sheets: CSSStyleSheet[] = []
  for (const source of sources) {
    const sheet = source.sheet
    // A `<link>` that has not finished loading, or any cross-origin sheet, hides
    // its rules. Fall back to node cloning rather than shipping a partial theme.
    if (!sheet) return null

    let text: string
    try {
      text = [...sheet.cssRules].map((rule) => rule.cssText).join('\n')
    } catch {
      return null
    }

    const constructed = new CSSStyleSheet()
    constructed.replaceSync(text)
    sheets.push(constructed)
  }

  return sheets
}

function getAdoptedSheets(): CSSStyleSheet[] | null {
  const sources = collectStyleSources()
  if (adoptedSheetsCache && sameSources(adoptedSheetsCache.sources, sources)) {
    return adoptedSheetsCache.sheets
  }

  const sheets = buildAdoptedSheets(sources)
  if (!sheets) {
    adoptedSheetsCache = null
    return null
  }

  adoptedSheetsCache = { sources, sheets }
  return sheets
}

function IsolatedHtmlContent(props: {
  className?: string
  html: string
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)

  // Layout effect, not a passive one: with `useEffect` React committed an empty
  // shadow host, the browser painted that blank frame, and only then did the
  // markup get injected — a visible flash every time the user navigated to a
  // page built from admin-authored HTML. Injecting before paint means the first
  // frame of the new page is already the finished page.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' })

    const wrapper = document.createElement('div')
    syncDarkClass(wrapper)
    wrapper.append(parsedHtmlFragment(props.html))

    const contentTemplate = document.createElement('template')
    contentTemplate.innerHTML = isolatedContentBaseStyles

    const adopted = getAdoptedSheets()
    if (adopted) {
      shadowRoot.adoptedStyleSheets = adopted
      shadowRoot.replaceChildren(contentTemplate.content, wrapper)
    } else {
      shadowRoot.adoptedStyleSheets = []
      shadowRoot.replaceChildren(
        ...collectStyleSources().map((node) => node.cloneNode(true)),
        contentTemplate.content,
        wrapper
      )
    }

    const observer = new MutationObserver(() => syncDarkClass(wrapper))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [props.html])

  return (
    <div ref={containerRef} className={cn('block w-full', props.className)} />
  )
}

export function HtmlContent(props: HtmlContentProps) {
  const variant = props.variant ?? 'inline'
  const html = useMemo(
    () => sanitizeHtmlContent(props.content, variant),
    [props.content, variant]
  )

  if (variant === 'isolated') {
    return <IsolatedHtmlContent className={props.className} html={html} />
  }

  return (
    <div
      className={cn(
        'prose prose-neutral dark:prose-invert max-w-none',
        props.className
      )}
      // eslint-disable-next-line react/no-danger -- html is sanitized above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
