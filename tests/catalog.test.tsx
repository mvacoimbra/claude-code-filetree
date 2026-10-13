import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'

import type { FiletreeCatalogEntry, FiletreePanelArgs } from '../types'

// A stand-in for the /mods hub: it calls `$.filetree.catalog` from a command of its own and hands
// back JSON, and draws every entry's tree in a pane of its own, as the Components tab does.
const HUB: Plugin = {
  name: 'hub',
  register(on) {
    on('command.run', { command: 'hub-catalog' }, async ($, e) => ({ text: JSON.stringify(await $.filetree.catalog(JSON.parse(e.args))) }))
    on('ui.render', { component: 'Pane', requestId: 'components' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      const entries = await $.filetree.catalog({ lang: 'en', surface: e.surface, columns: e.props.bodyColumns })
      return <Box flexDirection="column">{entries.map(entry => entry.tree as never)}</Box>
    })
  },
}

async function catalogOf($: Engine, args: Partial<FiletreePanelArgs> = {}): Promise<FiletreeCatalogEntry[]> {
  const out = await $.command.run({ command: 'hub-catalog', args: JSON.stringify({ lang: 'en', surface: 'terminal', columns: 60, ...args }) } as never)
  return JSON.parse(out.text ?? '')
}

const NERD = /[\u{e000}-\u{f8ff}\u{f0000}-\u{fffff}]/u
const paneProps = { title: 'Components', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never

const EXPECTED = [
  'pane-tree',
  'pane-preview',
  'header',
  'header-hint',
  'header-button-up',
  'header-button-cwd-following',
  'header-button-cwd-pinned',
  'header-button-refresh',
  'header-button-hidden-off',
  'header-button-hidden-on',
  'header-button-size-off',
  'header-button-size-on',
  'header-button-collapse',
  'header-button-unselect',
  'branch-row',
  'branch-row-clean',
  'branch-row-flash',
  'no-repo-hint',
  'search-row',
  'search-row-query',
  'search-clear-hint',
  'dir-row-collapsed',
  'dir-row-expanded',
  'dir-row-counts',
  'file-row',
  'file-row-modified',
  'file-row-added',
  'file-row-untracked',
  'file-row-deleted',
  'file-row-renamed',
  'file-row-conflicted',
  'file-row-ignored',
  'lines-changed',
  'right-column-date',
  'right-column-age',
  'right-column-size',
  'row-cursor',
  'row-selected',
  'row-hover',
  'activity-read',
  'activity-write',
  'activity-git',
  'activity-chip-running',
  'activity-chip-done',
  'activity-chip-failed',
  'footer-selected',
  'note-cut',
  'scrollbar',
  'preview-header',
  'preview-code',
  'preview-markdown',
  'preview-note-binary',
  'glyphs-nerd',
  'glyphs-plain',
]

test('the catalog names every piece of the pane, each with a static tree', { timeoutMs: 20_000, plugins: [HUB] }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  const entries = await catalogOf($)
  const ids = entries.map(e => e.id)
  expect(entries.length).toBeGreaterThan(60)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of EXPECTED) expect(ids).toContain(id)
  for (const e of entries) {
    expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(typeof e.name).toBe('string')
    expect(e.name.length).toBeGreaterThan(0)
    expect(typeof e.help).toBe('string')
    expect(['Box', 'Text']).toContain((e.tree as { type?: string }).type)
  }
  const all = JSON.stringify(entries)
  for (const type of ['Button', 'Input', 'Select', 'Client']) expect(all).not.toContain(`"type":"${type}"`)
  const tree = (id: string) => JSON.stringify(entries.find(e => e.id === id)?.tree)
  expect(entries.find(e => e.id === 'file-row-modified')?.name).toBe('File row, modified')
  expect(tree('file-row-modified')).toContain('#e5c07b')
  expect(tree('file-row-modified')).toContain(' +12')
  expect(tree('file-row-deleted')).toContain('"strikethrough":true')
  expect(tree('branch-row')).toContain('origin/main')
  expect(tree('branch-row-clean')).toContain(' clean')
  expect(tree('no-repo-hint')).toContain('no git repo')
  expect(tree('footer-selected')).toContain('selected: ')
  expect(tree('activity-chip-running')).toContain('committing…')
  expect(tree('activity-chip-failed')).toContain('push failed')
  expect(tree('activity-read')).toContain('#a855f7')
  expect(tree('note-cut')).toContain('more rows, collapse folders or use search')
  expect(tree('preview-code')).toContain('"type":"Code"')
  expect(tree('preview-markdown')).toContain('"type":"Markdown"')
  expect(tree('preview-note-binary')).toContain('binary file')
  expect(tree('scrollbar')).toContain('┃')
  expect(NERD.test(tree('glyphs-nerd'))).toBe(true)
  expect(NERD.test(tree('glyphs-plain'))).toBe(false)
})

test('the catalog speaks Portuguese when the hub does, with the same ids', { timeoutMs: 20_000, plugins: [HUB] }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  const en = await catalogOf($)
  const pt = await catalogOf($, { lang: 'pt' })
  expect(pt.map(e => e.id)).toEqual(en.map(e => e.id))
  expect(pt.find(e => e.id === 'file-row-modified')?.name).toBe('Linha de arquivo, modificado')
  expect(pt.find(e => e.id === 'header')?.name).toBe('Linha do cabeçalho')
  const same = pt.filter((e, i) => e.name === en[i]?.name)
  expect(same.length).toBe(0)
})

test('the catalog draws each surface’s version, and every tree mounts on terminal and desktop', { timeoutMs: 20_000, plugins: [HUB] }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  const desktop = await catalogOf($, { surface: 'desktop', columns: 48 })
  const tree = (id: string) => JSON.stringify(desktop.find(e => e.id === id)?.tree)
  expect(NERD.test(tree('file-row'))).toBe(false)
  expect(tree('scrollbar')).toContain('Drawn in the terminal')
  expect(tree('scrollbar')).not.toContain('┃')
  for (const e of desktop) expect(['Box', 'Text']).toContain((e.tree as { type?: string }).type)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'hub', surface, component: 'Pane', requestId: 'components', props: paneProps })
    const drawn = JSON.stringify(await ui.drawn())
    for (const word of ['no git repo', 'selected: ', 'origin/main', 'binary file']) expect(drawn).toContain(word)
    await ui.unmount()
  }
})

test('on a surface the pane does not draw on, each entry says where it shows', { timeoutMs: 20_000, plugins: [HUB] }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  const terminal = await catalogOf($)
  for (const surface of ['mobile', 'vscode'] as const) {
    const entries = await catalogOf($, { surface })
    expect(entries.map(e => e.id)).toEqual(terminal.map(e => e.id))
    for (const e of entries) expect(JSON.stringify(e.tree)).toContain('Shows in the terminal and the desktop app.')
  }
})
