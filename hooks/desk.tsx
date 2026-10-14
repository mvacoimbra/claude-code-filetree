import type { RenderElement } from 'claude-code'

import type { Activity, Branch } from '../types'
import { dot, empty, icon, notice, text } from './kit/kit'
import type { Kit } from './kit/kit'
import { mix } from './kit/tone'
import type { KitTone, Tone } from './kit/tone'
import type { HeaderButton, RowInk } from './look'
import type { Tones } from './paint'

// The pane on the desktop app, in the pack's grammar: the kit's icons, text roles and notices,
// native Buttons, and colour only for a state or the accent, all from the skin. Shared by the
// pane's render hook and the catalog the /mods hub shows. The terminal keeps look.tsx.
//
// The tree's rows are drawn by the rows surface module, which has no Svg (a surface module
// draws with the terminal's elements), so a row carries no drawn icon: a folder has its caret.

type Child = RenderElement | string | null | undefined | false

// The tree's row colours from the skin: git status in ok, warn and err, a rename in the accent.
export function deskInk(t: Tone): RowInk {
  return {
    fg: t.ink.fg,
    muted: t.ink.muted,
    faint: t.ink.faint,
    dir: t.ink.muted,
    add: t.ink.ok,
    del: t.ink.err,
    git: { A: t.ink.ok, '?': t.ink.ok, M: t.ink.warn, T: t.ink.warn, R: t.ink.accent, C: t.ink.accent, D: t.ink.err, U: t.ink.err },
  }
}

// What a flash or an activity's tone name means here: a write in the accent, a git action in
// ok, a destructive one in err. Reads keep their own glint (the skin's read colour).
export function flashTone(name: string): KitTone {
  if (name === 'red') return 'err'
  if (name === 'orange' || name === 'read') return 'accent'
  return 'ok'
}

// The shimmer's colours: from the tone's colour to a glint, and the same faded for a folder
// opened only to reveal a lit file.
function ramp(t: Tone, base: string): { bright: string[]; dim: string[] } {
  const glint = t.isLight ? '#000000' : '#ffffff'
  const step = t.isLight ? [0.18, 0.36, 0.54] : [0.25, 0.5, 0.75]
  return {
    bright: [base, ...step.map(a => mix(base, glint, a))],
    dim: [0.5, 0.42, 0.34, 0.26].map(a => mix(base, t.hex.surface, a)),
  }
}

export function deskShimmer(t: Tone): Tones {
  const ok = ramp(t, t.hex.ok)
  return { orange: ramp(t, t.hex.accent), read: ramp(t, t.hex.read), purple: ok, green: ok, teal: ok, blue: ok, cyan: ok, red: ramp(t, t.hex.err) }
}

// The row backgrounds: the keyboard cursor tinted with the accent, the pointer's row as the
// kit's rows light.
export const cursorBg = (t: Tone): string => mix(t.hex.surface, t.hex.accent, t.isLight ? 0.14 : 0.2)
export const hoverBg = (t: Tone): string => t.ink.hover

// What the hovered button does, at the end of the title row, when it fits there.
export function deskHint(buttons: HeaderButton[], hovered: string, columns: number, used: number): string | null {
  const hint = buttons.find(b => b.id === hovered)?.hint
  return hint && hint.length <= columns - used - 6 ? hint : null
}

// The pane: a column as tall as the body, the app's own background.
export function deskFrame(k: Kit, bodyRows: number, children: Child[]): RenderElement {
  return (
    <k.ui.Box flexDirection="column" minHeight={Math.max(1, bodyRows)}>
      {children.filter(Boolean)}
    </k.ui.Box>
  )
}

// The title row: the folder's name after its icon, and the hovered button's hint at the end.
export function deskTitle(k: Kit, title: string, hint: string | null): RenderElement {
  const { Box } = k.ui
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
      {icon(k, 'folder', 'muted')}
      <Box flexShrink={1}>{text(k, title, undefined, { bold: true, wrap: 'truncate-start' })}</Box>
      <Box flexGrow={1} />
      {hint ? text(k, hint, 'faint') : null}
    </Box>
  )
}

// The header's native buttons, wrapped when the pane is narrow.
export function deskToolbar(k: Kit, buttons: RenderElement[]): RenderElement {
  return (
    <k.ui.Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingX={1}>
      {buttons}
    </k.ui.Box>
  )
}

export type DeskBranch = { branch: Branch; flash?: KitTone; totals: [number, number]; counts?: [number, number, number] }

// The branch, then what changed: lines added and removed and files new, modified and deleted,
// each in its state's colour, or clean.
export function deskBranch(k: Kit, x: DeskBranch): RenderElement {
  const { Box } = k.ui
  const b = x.branch
  const where = [b.ahead > 0 ? `${b.ahead} ahead` : '', b.behind > 0 ? `${b.behind} behind` : '', b.upstream].filter(Boolean).join(' · ')
  const [news, mods, dels] = x.counts ?? [0, 0, 0]
  const parts: RenderElement[] = []
  if (x.totals[0] > 0) parts.push(text(k, `+${x.totals[0]}`, 'ok', { key: 'add' }))
  if (x.totals[1] > 0) parts.push(text(k, `-${x.totals[1]}`, 'err', { key: 'del' }))
  const files: [number, string, KitTone][] = [
    [news, 'new', 'ok'],
    [mods, 'modified', 'warn'],
    [dels, 'deleted', 'err'],
  ]
  for (const [n, word, tone] of files) if (n > 0) parts.push(text(k, `${n} ${word}`, tone, { key: word }))
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {icon(k, 'branch', x.flash ?? 'muted')}
        {text(k, b.head, x.flash, { bold: true })}
        {where ? <Box flexShrink={1}>{text(k, where, 'muted', { wrap: 'truncate-end' })}</Box> : null}
      </Box>
      <Box flexDirection="row" columnGap={1} alignItems="center" paddingLeft={k.vector ? 3 : 2} flexWrap="wrap">
        {parts.length ? parts : [dot(k, 'ok'), text(k, 'clean', 'ok', { key: 'clean' })]}
      </Box>
    </Box>
  )
}

// Outside a git repo, while the hint is on.
export function deskNoRepo(k: Kit): RenderElement {
  const { Box } = k.ui
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
      {icon(k, 'branch', 'muted')}
      {text(k, 'No git repo · status starts after git init', 'muted')}
    </Box>
  )
}

// The search field, after its icon; the hint and the clear button while there is a query.
export function deskSearch(k: Kit, x: { query: string; field: RenderElement; hint: string | null; clear: RenderElement | null }): RenderElement {
  const { Box } = k.ui
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
      {icon(k, 'search', 'muted')}
      <Box flexGrow={1} flexShrink={1}>
        {x.field}
      </Box>
      {x.query && x.hint ? text(k, x.hint, 'faint') : null}
      {x.query ? x.clear : null}
    </Box>
  )
}

// The rows, inset as the kit's rows are.
export function deskTree(k: Kit, rows: RenderElement): RenderElement {
  return (
    <k.ui.Box flexDirection="column" paddingX={1}>
      {rows}
    </k.ui.Box>
  )
}

// A tree with nothing to show: an empty folder, or a search that matched nothing.
export function deskEmpty(k: Kit, query: string): RenderElement {
  return query.trim()
    ? empty(k, 'empty', `No files match “${query.trim()}”`, 'Clear the search to see every file')
    : empty(k, 'empty', 'This folder is empty', 'Files show here as they appear')
}

// The latest git action Claude ran: its state as a dot and a word, a commit's short hash after.
export function deskChip(k: Kit, a: Activity): RenderElement {
  const { Box } = k.ui
  const tone: KitTone = a.state === 'failed' ? 'err' : a.state === 'running' ? 'accent' : 'ok'
  const hash = a.state === 'done' && a.kind === 'git commit' ? (a.detail.split(' ')[0] ?? '') : ''
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
      {dot(k, tone)}
      {text(k, a.state === 'running' ? `${a.label}…` : a.label, tone, a.state === 'running' ? { bold: true } : {})}
      {hash ? text(k, hash, 'faint') : null}
    </Box>
  )
}

// The footer: the selected file and the button that clears it, room, and the activity.
export function deskFooter(k: Kit, selected: string, chip: RenderElement | null, unselect?: RenderElement | null): RenderElement {
  const { Box } = k.ui
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
      {selected ? icon(k, 'file', 'muted') : null}
      {selected ? text(k, 'selected:', 'muted') : null}
      {selected ? <Box flexShrink={1}>{text(k, selected, undefined, { wrap: 'truncate-start' })}</Box> : null}
      {selected && unselect ? unselect : null}
      <Box flexGrow={1} />
      {chip}
    </Box>
  )
}

// The preview's header: back to the files, the file's path, the hint and open outside.
export function deskPreviewHeader(k: Kit, back: RenderElement, name: string, hint: string | null, external: RenderElement): RenderElement {
  const { Box } = k.ui
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={1}>
      {icon(k, 'chevronLeft', 'muted', 14)}
      {back}
      {icon(k, 'file', 'muted')}
      <Box flexGrow={1} flexShrink={1}>
        {text(k, name, undefined, { bold: true, wrap: 'truncate-start' })}
      </Box>
      {hint ? text(k, hint, 'faint') : null}
      {external}
    </Box>
  )
}

// Why the preview shows less than the file: unreadable, binary, too large, or only its start.
export function deskPreviewNote(k: Kit, note: string): RenderElement {
  const unreadable = /^could not read: (.*)$/.exec(note)
  if (unreadable) return notice(k, 'preview-note', 'err', 'Could not read the file', unreadable[1] ?? '')
  const binary = /^binary file, (.*)$/.exec(note)
  if (binary) return notice(k, 'preview-note', 'muted', 'Binary file', `${binary[1]}, not drawn here. Open shows it in its own app.`)
  const large = /^(.*), too large to preview$/.exec(note)
  if (large) return notice(k, 'preview-note', 'muted', 'Too large to preview', `${large[1]}; past 4 MB a file is not read. Open shows it in its own app.`)
  return <k.ui.Box paddingX={1}>{text(k, `Showing the ${note}`, 'faint')}</k.ui.Box>
}

// The preview's body, inset as the rows are.
export function deskPreview(k: Kit, body: RenderElement): RenderElement {
  return (
    <k.ui.Box flexDirection="column" paddingX={1}>
      {body}
    </k.ui.Box>
  )
}
