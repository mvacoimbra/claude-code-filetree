import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { Activity, Branch, FileNode, Theme } from '../types'
import { BRANCH_ICON, TONES } from './git'
import { CHEVRON_CLOSED, CHEVRON_OPEN, fileIcon, GIT_COLOR } from './icons'
import type { RowSpec, Seg, Tones } from './paint'
import { age, formatSize, stamp } from './tree'

// The pieces of the pane, shared by the pane's render hook and the catalog the /mods hub shows,
// so the catalog draws each piece the way the pane does.

export const ADD_COLOR = '#98c379'
export const DEL_COLOR = '#e06c75'
export const BRANCH_ROW = '#branch'
// The terminal's shimmer: each tone's own colours; a read glints purple.
export const SHIMMER: Tones = Object.fromEntries([...Object.entries(TONES), ['read', TONES.purple] as const].map(([k, v]) => [k, { bright: v?.bright ?? [], dim: v?.dim ?? [] }]))
export const PINNED_GAP = '  ⋮'
export const EMPTY_NOTE = 'empty'

export type Paints = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }
// A header button: its glyph for the terminal, its word for the desktop's native button.
export type HeaderButton = { id: string; label: string; word: string; dim: boolean; hint: string }

// The colours a tree row is painted in. The terminal's come from its theme (Omarchy's, or the
// defaults); the desktop's from the skin (desk.tsx), where colour only means a state.
export type RowInk = {
  // Body text; undefined is the surface's own text colour.
  fg: string | undefined
  muted: string
  // Ignored by git: quieter than a hidden file.
  faint: string
  // A folder's icon.
  dir: string
  add: string
  del: string
  // A git status letter's colour, by letter.
  git: Readonly<Record<string, string>>
}

export function termInk(theme: Theme): RowInk {
  return {
    fg: theme.fg || undefined,
    muted: theme.muted,
    faint: theme.muted,
    dir: theme.accent,
    add: ADD_COLOR,
    del: DEL_COLOR,
    git: { ...GIT_COLOR, D: theme.urgent, U: theme.urgent },
  }
}

export function clean(segs: Seg[]): Seg[] {
  for (const seg of segs) for (const k of Object.keys(seg) as (keyof Seg)[]) if (seg[k] === undefined) delete seg[k]
  return segs
}

// The hover colour: the selection colour faded toward the background.
export function faint(hex: string): string {
  const v = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(0x26 + (((v >> shift) & 255) - 0x26) * 0.3)
  return `#${[16, 8, 0].map(x => ch(x).toString(16).padStart(2, '0')).join('')}`
}

export function headerButtons(unicode: boolean, s: { follow: boolean; showHidden: boolean; showSize: boolean; selected: boolean }): HeaderButton[] {
  return [
    { id: 'up', label: unicode ? '↑' : '\u{f005d}', word: 'Up', dim: true, hint: 'parent folder' },
    { id: 'cwd', label: unicode ? '⌂' : '\u{f02dc}', word: 'Follow', dim: !s.follow, hint: 'follow the cwd' },
    { id: 'refresh', label: unicode ? '↻' : '\u{f0450}', word: 'Refresh', dim: true, hint: 'reload tree and git' },
    { id: 'hidden', label: unicode ? (s.showHidden ? '◉' : '○') : s.showHidden ? '\u{f0208}' : '\u{f0209}', word: 'Hidden', dim: !s.showHidden, hint: s.showHidden ? 'hide hidden files' : 'show hidden files' },
    { id: 'size', label: unicode ? 'Σ' : '\u{f02ca}', word: 'Sizes', dim: !s.showSize, hint: s.showSize ? 'show dates' : 'show sizes' },
    { id: 'collapse', label: unicode ? '⊟' : '\u{eac5}', word: 'Collapse', dim: true, hint: 'collapse all' },
    ...(s.selected ? [{ id: 'unselect', label: unicode ? '⊘' : '\u{f0777}', word: 'Unselect', dim: false, hint: 'clear selection' }] : []),
  ]
}

export const clearButton = (unicode: boolean): HeaderButton => ({ id: 'clear', label: unicode ? '×' : '\u{f0156}', word: 'Clear', dim: true, hint: 'clear search' })
export const backButton = (unicode: boolean): HeaderButton => ({ id: 'back', label: unicode ? '← files' : '\u{f004d} files', word: 'Files', dim: false, hint: 'back to the tree' })
export const externalButton = (unicode: boolean): HeaderButton => ({ id: 'external', label: unicode ? '↗' : '\u{f08e}', word: 'Open', dim: true, hint: 'open in default app' })

// A folder's untracked, modified and deleted counts.
export function countSegs(c: [number, number, number] | undefined, ink: RowInk): Seg[] {
  if (!c) return []
  const out: Seg[] = []
  if (c[0] > 0) out.push({ t: ` ?:${c[0]}`, c: ink.git['?'] ?? ink.add })
  if (c[1] > 0) out.push({ t: ` M:${c[1]}`, c: ink.git.M ?? ink.muted })
  if (c[2] > 0) out.push({ t: ` D:${c[2]}`, c: ink.git.D ?? ink.del })
  return out
}

// What the right column says for a node: its size, or its date or age; nothing beside a line count.
export function metaOf(n: FileNode, o: { showSize: boolean; dirSizes: Record<string, number>; loc?: [number, number]; showAge: boolean; now: number }): string {
  if (o.showSize) {
    if (n.kind === 'dir') return n.id in o.dirSizes ? formatSize(o.dirSizes[n.id] ?? -1) : '…'
    return n.kind === 'file' || (n.kind === 'link' && n.size > 0) ? formatSize(n.size) : ''
  }
  if (o.loc || n.kind !== 'file') return ''
  return o.showAge ? age(n.mtime, o.now) : stamp(n.mtime)
}

export type NodeLook = {
  node: FileNode
  depth: number
  open: boolean
  // The git status letter (`M`, `A`, `?`, `D`, `U`, `R`, `C`, `T`), if any.
  status?: string
  isIgnored: boolean
  isBright: boolean
  isDim: boolean
  tone: string
  loc?: [number, number]
  counts?: [number, number, number]
  meta: string
  selected: boolean
  isRepo: boolean
  unicode: boolean
  ink: RowInk
  width: number
  // The desktop app: plain Unicode there draws no type glyph (a folder has its caret) and no
  // ignored mark (the faint name says it), since glyphs do not stand in for icons on the desktop.
  desktop?: boolean
}

// One file or folder row of the tree.
export function nodeRow(x: NodeLook): RowSpec {
  const { node: n, status, ink, unicode, loc } = x
  const bare = Boolean(x.desktop) && unicode
  const gitColor = status ? (ink.git[status] ?? ink.muted) : undefined
  const iconColor = x.isIgnored ? ink.faint : (gitColor ?? (n.hidden ? ink.muted : n.kind === 'dir' ? ink.dir : ink.muted))
  const nameColor = x.isIgnored ? ink.faint : (gitColor ?? (n.hidden ? ink.muted : ink.fg))
  const meta = x.meta
  const locText = loc ? `${loc[0] ? ` +${loc[0]}` : ''}${loc[1] ? ` -${loc[1]}` : ''}` : ''
  const dirCounts = n.kind === 'dir' ? countSegs(x.counts, ink) : []
  const badge = dirCounts.length ? '' : status ? ` ${status}` : x.isIgnored && !bare ? (unicode ? ' ⊘' : ' \u{f05e}') : '  '
  const countsText = dirCounts.map(c => c.t).join('')
  const cols = Math.max(4, x.width - x.depth * 2 - (bare ? 4 : 6) - (meta ? meta.length + 1 : 0) - locText.length - badge.length - countsText.length)
  const name = n.name.length > cols ? n.name.slice(0, cols - 1) + '…' : n.name
  const caret = n.kind === 'dir' ? (unicode ? (x.open ? '▾' : '▸') : x.open ? CHEVRON_OPEN : CHEVRON_CLOSED) + ' ' : '  '
  const glyph = unicode ? (n.kind === 'dir' ? '■' : '·') : fileIcon(n, x.open, x.isRepo)
  const lit = x.isBright || x.isDim
  const left: Seg[] = [
    { t: '  '.repeat(x.depth) },
    { t: caret, c: ink.muted },
    ...(bare ? [] : [lit ? { t: glyph + ' ', sh: x.tone, dim: x.isDim, one: true } : { t: glyph + ' ', c: iconColor }]),
    lit ? { t: name, sh: x.tone, dim: x.isDim, b: x.isBright } : { t: name, c: nameColor, b: x.selected, s: status === 'D' && n.kind !== 'dir' },
  ]
  const right: Seg[] = []
  if (meta) right.push({ t: ` ${meta}`, c: ink.muted })
  if (loc && loc[0] > 0) right.push({ t: ` +${loc[0]}`, c: ink.add })
  if (loc && loc[1] > 0) right.push({ t: ` -${loc[1]}`, c: ink.del })
  right.push(...dirCounts)
  if (badge) right.push({ t: badge, c: status ? gitColor : ink.muted, b: true })
  return { id: n.id, left: clean(left), right: clean(right) }
}

// A dim line in the tree that is no file: `empty`, the pinned-rows gap, the cut note.
export const noteRow = (text: string, color: string): RowSpec => ({ id: '', left: [{ t: text, c: color }], right: [] })

// What the hovered button does, when it fits beside a title that long.
export function hintFor(buttons: HeaderButton[], hovered: string, columns: number, title: number, surface: string): string | null {
  const text = buttons.find(b => b.id === hovered)?.hint
  if (!text) return null
  const room = columns - title - buttons.length * (surface === 'desktop' ? 3 : 2) - 2
  return text.length <= room ? text : null
}

export function drawHint({ Text }: Paints, text: string | null, theme: Theme): RenderElement | null {
  return text ? <Text color={theme.muted}>{`${text} `}</Text> : null
}

// The pane's frame: a column as tall as the body, on the theme's background.
export function drawFrame({ Box }: Paints, bodyRows: number, theme: Theme, children: (RenderElement | null | false | undefined)[]): RenderElement {
  return (
    <Box flexDirection="column" minHeight={Math.max(1, bodyRows)} backgroundColor={theme.bg || undefined}>
      {children}
    </Box>
  )
}

// The header row: the root's name, the hover hint and the buttons.
export function drawHeader({ Box, Text }: Paints, title: string, theme: Theme, hint: RenderElement | null, buttons: RenderElement[]): RenderElement {
  return (
    <Box flexDirection="row">
      <Text bold color={theme.accent} wrap="truncate-start">
        {title}
      </Text>
      <Box flexGrow={1} />
      {hint}
      <Box flexDirection="row" gap={1}>
        {buttons}
        <Text> </Text>
      </Box>
    </Box>
  )
}

export type BranchLook = { branch: Branch; flashTone?: string; totals: [number, number]; rootCounts: Seg[]; unicode: boolean; theme: Theme }

// The branch row: icon, branch, ahead and behind, upstream, then the repo's line and file counts.
export function drawBranchRow({ Box, Text }: Paints, x: BranchLook): RenderElement {
  const { branch: b, theme, totals, rootCounts } = x
  const solid = x.flashTone ? TONES[x.flashTone]?.solid : undefined
  return (
    <Box flexDirection="row" height={1} overflow="hidden">
      <Box flexDirection="row" flexShrink={0}>
        <Text color={x.flashTone ? (solid ?? theme.accent) : theme.accent}>{(x.unicode ? BRANCH_ICON.plain : BRANCH_ICON.nerd) + ' '}</Text>
        <Text bold color={x.flashTone ? (solid ?? (theme.fg || undefined)) : theme.fg || undefined}>
          {b.head}
        </Text>
        {b.ahead > 0 && <Text color={TONES.teal?.solid}>{` ↑${b.ahead}`}</Text>}
        {b.behind > 0 && <Text color={TONES.blue?.solid}>{` ↓${b.behind}`}</Text>}
      </Box>
      {b.upstream && (
        <Box flexShrink={1} overflow="hidden">
          <Text color={theme.muted} wrap="truncate-end">
            {` ${b.upstream}`}
          </Text>
        </Box>
      )}
      <Box flexGrow={1} />
      <Box flexDirection="row" flexShrink={0}>
        {totals[0] > 0 && <Text color={ADD_COLOR}>{` +${totals[0]}`}</Text>}
        {totals[1] > 0 && <Text color={DEL_COLOR}>{` -${totals[1]}`}</Text>}
        {rootCounts.map(c => (
          <Text color={c.c}>{c.t}</Text>
        ))}
        {rootCounts.length === 0 && totals[0] === 0 && totals[1] === 0 && <Text color={theme.muted}> clean</Text>}
      </Box>
    </Box>
  )
}

export function drawNoRepo({ Text }: Paints, unicode: boolean, theme: Theme): RenderElement {
  return <Text color={theme.muted}>{unicode ? '± ' : '\u{e702} '}no git repo · git status starts after git init</Text>
}

// The search row: the field, then the hint and the clear button while there is a query.
export function drawSearchRow({ Box }: Paints, x: { query: string; field: RenderElement; hint: RenderElement | null; clear: RenderElement | null }): RenderElement {
  return (
    <Box flexDirection="row">
      <Box flexGrow={1}>{x.field}</Box>
      {x.query ? x.hint : null}
      {x.query ? x.clear : null}
    </Box>
  )
}

export const SEARCH = { label: '/ ', placeholder: 'search', submitLabel: 'jump' } as const

// The activity chip: the latest git action Claude ran, running, done or failed.
export function drawChip({ Box, Text }: Paints, a: Activity, unicode: boolean, theme: Theme): RenderElement {
  const tone = a.state === 'failed' ? 'red' : a.tone
  const color = TONES[tone]?.solid ?? theme.accent
  const icon = unicode ? a.plain : a.nerd
  const hash = a.state === 'done' && a.kind === 'git commit' ? (a.detail.split(' ')[0] ?? '') : ''
  return (
    <Box flexDirection="row" marginLeft={2}>
      <Text color={color}>{icon + ' '}</Text>
      <Text bold={a.state === 'running'} color={color}>
        {a.state === 'running' ? `${a.label}…` : a.label}
      </Text>
      {hash && <Text color={theme.muted}>{` ${hash}`}</Text>}
    </Box>
  )
}

// The footer: the selected file, room, and the activity chip.
export function drawFooter({ Box, Text }: Paints, selected: string, chip: RenderElement | null): RenderElement {
  return (
    <Box flexDirection="row">
      {selected ? (
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-start">
            selected: {selected}
          </Text>
        </Box>
      ) : null}
      <Box flexGrow={1} />
      {chip}
    </Box>
  )
}

// The preview's header: back, the file's name, the hint and the open-outside button.
export function drawPreviewHeader({ Box, Text }: Paints, back: RenderElement, name: string, hint: RenderElement | null, external: RenderElement): RenderElement {
  return (
    <Box flexDirection="row">
      {back}
      <Text> </Text>
      <Box flexShrink={1} flexGrow={1}>
        <Text bold wrap="truncate-start">
          {name}
        </Text>
      </Box>
      {hint}
      {external}
    </Box>
  )
}

// The dim line under the preview's header: binary, too large, cut, or unreadable.
export function drawPreviewNote({ Text }: Paints, note: string): RenderElement {
  return <Text dimColor>{note}</Text>
}
