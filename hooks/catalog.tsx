import type { RenderElement } from 'claude-code'

import type { Activity, Branch, FileNode, FiletreeCatalogEntry, FiletreeLang, FiletreePanelArgs, Theme } from '../types'
import { gitActions } from './git'
import {
  backButton,
  clearButton,
  countSegs,
  drawBranchRow,
  drawChip,
  drawFooter,
  drawFrame,
  drawHeader,
  drawHint,
  drawNoRepo,
  drawPreviewHeader,
  drawPreviewNote,
  drawSearchRow,
  EMPTY_NOTE,
  externalButton,
  faint,
  type HeaderButton,
  headerButtons,
  hintFor,
  metaOf,
  nodeRow,
  noteRow,
  type Paints,
  PINNED_GAP,
  SEARCH,
  SHIMMER,
  termInk,
} from './look'
import { cutNote, paintPreview, paintRow, type PreviewPaints, type RowSpec } from './paint'
import { formatSize } from './tree'
import {
  cursorBg,
  deskBranch,
  deskChip,
  deskEmpty,
  deskFooter,
  deskFrame,
  deskHint,
  deskInk,
  deskNoRepo,
  deskPreview,
  deskPreviewHeader,
  deskPreviewNote,
  deskSearch,
  deskShimmer,
  deskTitle,
  deskToolbar,
  deskTree,
  flashTone,
  hoverBg,
} from './desk'
import { kitOf } from './kit/kit'
import type { KitUi } from './kit/kit'
import type { Tone } from './kit/tone'

// `$.filetree.catalog`: every piece the pane draws, named, for the Components tab of /mods.
// Each is drawn from the same builders the pane uses (look.tsx, paint.ts), on a made-up project,
// with static stand-ins for the pane's controls: a press cannot cross to this mod from the hub.

export type CatalogContext = {
  // Plain Unicode glyphs on this surface, as the pane decides it (the Glyphs setting).
  unicode: boolean
  // The terminal's colours (Omarchy's theme, or the defaults).
  theme: Theme
  // The desktop's: the skin's tone.
  tone: Tone
  now: number
}

type Els = Paints & PreviewPaints & { Button: unknown; Svg?: unknown }
type Words = { en: string; pt: string }

const ROOT = '/home/you/app'
// The shimmer's frame the catalog freezes on: the bright band mid-word.
const PHASE = 5
const HOUR = 3_600_000

// A result of a noun call must be plain data: no closures, no surface modules. The catalog's trees
// hold none; this keeps it so if a builder ever hands one back.
export function staticTree(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(staticTree)
  if (node === null || typeof node !== 'object') return typeof node === 'function' ? undefined : node
  const element = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
  if (element.type === 'Button' || element.type === 'Input' || element.type === 'Select' || element.type === 'Client') {
    const label = String(element.props?.label ?? element.props?.placeholder ?? element.props?.key ?? '')
    return { type: 'Text', props: element.props?.dimColor === true ? { dimColor: true } : {}, children: [label] }
  }
  return Object.fromEntries(
    Object.entries(element)
      .filter(([key, value]) => key !== 'press' && typeof value !== 'function')
      .map(([key, value]) => [
        key,
        key === 'props' && value !== null && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).filter(([, prop]) => typeof prop !== 'function'))
          : staticTree(value),
      ]),
  )
}

function node(path: string, kind: FileNode['kind'], mtime: number, size = 0): FileNode {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { id: path, parent: path.slice(0, path.lastIndexOf('/')) || '/', name, kind, hidden: name.startsWith('.'), mtime, size, loaded: true }
}

export function catalogOf(els: Els, args: FiletreePanelArgs, ctx: CatalogContext): FiletreeCatalogEntry[] {
  const lang: FiletreeLang = args?.lang === 'pt' ? 'pt' : 'en'
  const surface = args?.surface ?? 'terminal'
  const columns = Math.max(24, Math.floor(Number(args?.columns) || 60))
  const { Box, Text } = els
  const { theme, tone, now } = ctx
  // The desktop draws the kit's version of each piece, in the skin's colours.
  const desk = surface === 'desktop'
  const k = kitOf(els as unknown as KitUi, tone, surface, columns)
  const ink = desk ? deskInk(tone) : termInk(theme)
  const tones = desk ? deskShimmer(tone) : SHIMMER
  const activeBg = desk ? cursorBg(tone) : theme.selection
  const hoveredBg = desk ? hoverBg(tone) : faint(theme.selection)
  const { Button } = els as unknown as { Button: (props: object) => RenderElement }
  const say = (w: Words) => w[lang]
  const entries: FiletreeCatalogEntry[] = []
  const add = (id: string, name: Words, help: Words, tree: () => RenderElement) => entries.push({ id, name: say(name), help: say(help), tree: tree() })

  // The made-up project.
  const src = node(`${ROOT}/src`, 'dir', now - 2 * HOUR)
  const components = node(`${ROOT}/src/components`, 'dir', now - 5 * HOUR)
  const appTsx = node(`${ROOT}/src/app.tsx`, 'file', now - 12 * 60_000, 4_812)
  const utilTs = node(`${ROOT}/src/util.ts`, 'file', now - 3 * HOUR, 1_204)
  const readme = node(`${ROOT}/README.md`, 'file', now - 4 * 86_400_000, 2_960)
  const pkg = node(`${ROOT}/package.json`, 'file', now - 9 * 86_400_000, 812)
  const env = node(`${ROOT}/.env`, 'file', now - 30 * 86_400_000, 96)
  const dist = node(`${ROOT}/dist`, 'dir', now - HOUR)
  const link = node(`${ROOT}/docs`, 'link', now - 20 * 86_400_000, 512)
  const counts: [number, number, number] = [1, 2, 1]

  type RowOpts = Partial<Omit<Parameters<typeof nodeRow>[0], 'node'>> & { showSize?: boolean; showAge?: boolean; dirSizes?: Record<string, number> }
  const row = (n: FileNode, o: RowOpts = {}, unicode = ctx.unicode): RowSpec =>
    nodeRow({
      node: n,
      depth: o.depth ?? 0,
      open: o.open ?? false,
      status: o.status,
      isIgnored: o.isIgnored ?? false,
      isBright: o.isBright ?? false,
      isDim: o.isDim ?? false,
      tone: o.tone ?? 'orange',
      loc: o.loc,
      counts: o.counts,
      meta: o.meta ?? metaOf(n, { showSize: o.showSize ?? false, dirSizes: o.dirSizes ?? {}, loc: o.loc, showAge: o.showAge ?? false, now }),
      selected: o.selected ?? false,
      isRepo: o.isRepo ?? false,
      unicode,
      ink,
      width: desk ? columns - 2 : columns,
      desktop: desk,
    })
  const paint = (r: RowSpec, o: { bg?: string; bar?: { thumb: boolean; color: string } } = {}) => paintRow(els, r, { phase: PHASE, tones, ...o })
  const rows = (specs: RowSpec[], o: { cursor?: string; hover?: number } = {}) => {
    const list = (
      <Box flexDirection="column" width={desk ? columns - 2 : columns}>
        {specs.map((r, i) => paint(r, { bg: r.id && r.id === o.cursor ? activeBg : r.id && i === o.hover ? hoveredBg : undefined }))}
      </Box>
    )
    return desk ? deskTree(k, list) : list
  }
  const one = (r: RowSpec, o: { bg?: string } = {}) => rows([r], o.bg ? { cursor: r.id } : {})
  // A header button as the pane draws it: on the desktop a native Button named by its word, on
  // the terminal a plain Button, its glyph alone; dim at rest. Made static below.
  const still = (b: HeaderButton) => (desk ? Button({ key: b.id, label: b.word, dimColor: b.dim, onPress: () => undefined }) : <Text dimColor={b.dim}>{b.label}</Text>)
  const field = (query: string) =>
    desk ? (
      <Box flexDirection="row">{query ? <Text>{query}</Text> : <Text color={tone.ink.faint}>Search files</Text>}</Box>
    ) : (
      <Box flexDirection="row">
        <Text>{SEARCH.label}</Text>
        {query ? <Text>{query}</Text> : <Text dimColor>{SEARCH.placeholder}</Text>}
      </Box>
    )
  const narrow = (tree: RenderElement) => <Box width={columns}>{tree}</Box>
  const search = (query: string, hovered = false) => {
    const clear = clearButton(ctx.unicode)
    if (desk) return narrow(deskSearch(k, { query, field: field(query), hint: hovered ? (deskHint([clear], 'clear', columns, 8 + query.length + clear.word.length) ?? clear.hint) : null, clear: query ? still(clear) : null }))
    return narrow(drawSearchRow(els, { query, field: field(query), hint: hovered ? drawHint(els, hintFor([clear], 'clear', columns, 5, surface) ?? clear.hint, theme) : null, clear: query ? still(clear) : null }))
  }
  const head = (o: { follow?: boolean; showHidden?: boolean; showSize?: boolean; selected?: boolean; hovered?: string; unicode?: boolean } = {}) => {
    const buttons = headerButtons(o.unicode ?? ctx.unicode, { follow: o.follow ?? true, showHidden: o.showHidden ?? false, showSize: o.showSize ?? false, selected: o.selected ?? false })
    const title = 'app'
    if (desk) {
      const hint = o.hovered ? (deskHint(buttons, o.hovered, columns, title.length) ?? buttons.find(b => b.id === o.hovered)?.hint ?? null) : null
      return narrow(
        <Box flexDirection="column" rowGap={1}>
          {deskTitle(k, title, hint)}
          {deskToolbar(k, buttons.filter(b => b.id !== 'unselect').map(still))}
        </Box>,
      )
    }
    const text = o.hovered ? (hintFor(buttons, o.hovered, columns, title.length, surface) ?? buttons.find(b => b.id === o.hovered)?.hint ?? null) : null
    return narrow(drawHeader(els, title, theme, drawHint(els, text, theme), buttons.map(still)))
  }
  const button = (id: string, o: Parameters<typeof head>[0] = {}) => {
    const b = headerButtons(ctx.unicode, { follow: o?.follow ?? true, showHidden: o?.showHidden ?? false, showSize: o?.showSize ?? false, selected: true }).find(x => x.id === id)
    return (
      <Box flexDirection="row" columnGap={1} alignItems="center" paddingX={desk ? 1 : 0}>
        {b ? still(b) : null}
        <Text color={desk ? tone.ink.faint : theme.muted}>{b?.hint ?? ''}</Text>
      </Box>
    )
  }
  const branch: Branch = { head: 'main', upstream: 'origin/main', ahead: 2, behind: 1 }
  const branchRow = (o: { flashTone?: string; clean?: boolean } = {}) =>
    narrow(
      desk
        ? deskBranch(k, {
            branch: o.clean ? { ...branch, ahead: 0, behind: 0 } : branch,
            ...(o.flashTone ? { flash: flashTone(o.flashTone) } : {}),
            totals: o.clean ? [0, 0] : [24, 7],
            ...(o.clean ? {} : { counts }),
          })
        : drawBranchRow(els, {
            branch: o.clean ? { ...branch, ahead: 0, behind: 0 } : branch,
            ...(o.flashTone ? { flashTone: o.flashTone } : {}),
            totals: o.clean ? [0, 0] : [24, 7],
            rootCounts: o.clean ? [] : countSegs(counts, ink),
            unicode: ctx.unicode,
            theme,
          }),
    )
  const noRepo = () => narrow(desk ? deskNoRepo(k) : drawNoRepo(els, ctx.unicode, theme))
  const unselectButton = headerButtons(ctx.unicode, { follow: true, showHidden: false, showSize: false, selected: true }).find(b => b.id === 'unselect')
  const footer = (path: string, a: Activity | null) =>
    narrow(desk ? deskFooter(k, path, a ? deskChip(k, a) : null, path && unselectButton ? still(unselectButton) : null) : drawFooter(els, path, a ? drawChip(els, a, ctx.unicode, theme) : null))
  const frame = (children: (RenderElement | null)[]) => narrow(desk ? deskFrame(k, 1, children) : drawFrame(els, 1, theme, children))
  const gap = (el: RenderElement) => (desk ? <Box paddingTop={1}>{el}</Box> : el)
  const act = (command: string, state: Activity['state'], detail = ''): Activity => {
    const a = gitActions(command)[0]
    return {
      id: 1,
      kind: a?.kind ?? 'git',
      label: state === 'running' ? (a?.running ?? '') : state === 'done' ? (a?.done ?? '') : `${a?.verb ?? 'git'} failed`,
      state,
      detail,
      at: now,
      tone: a?.tone ?? 'green',
      nerd: a?.icon.nerd ?? '',
      plain: a?.icon.plain ?? '',
    }
  }
  const chip = (a: Activity) => footer('', a)
  const treeRows = (o: { cursor?: string; selected?: string; lit?: boolean } = {}): RowSpec[] => [
    row(src, { open: true, counts }),
    row(components, { depth: 1 }),
    row(appTsx, { depth: 1, status: 'M', loc: [12, 3], selected: o.selected === appTsx.id, ...(o.lit ? { isBright: true, tone: 'orange' } : {}) }),
    row(utilTs, { depth: 1, status: 'A', loc: [40, 0] }),
    row(node(`${ROOT}/src/old.ts`, 'file', now - 8 * HOUR), { depth: 1, status: 'D' }),
    row(node(`${ROOT}/src/new.ts`, 'file', now - 20 * 60_000, 300), { depth: 1, status: '?' }),
    row(dist, { isIgnored: true }),
    row(env),
    row(readme, o.lit ? { isBright: true, tone: 'read' } : {}),
    row(pkg),
  ]
  const PREVIEW_CODE = "import { useState } from 'react'\n\nexport function App() {\n  const [count, setCount] = useState(0)\n  return <button onClick={() => setCount(count + 1)}>{count}</button>\n}"
  const PREVIEW_MD = '# app\n\nA small **demo** project.\n\n- `npm start` runs it\n- `npm test` checks it'
  const previewHeader = (name: string, hovered = '') => {
    const back = backButton(ctx.unicode)
    const external = externalButton(ctx.unicode)
    const fallback = hovered === 'back' ? back.hint : external.hint
    if (desk) return narrow(deskPreviewHeader(k, still(back), name, hovered ? (deskHint([back, external], hovered, columns, 14 + name.length) ?? fallback) : null, still(external)))
    const text = hovered ? (hintFor([back, external], hovered, columns, 8 + name.length, surface) ?? fallback) : null
    return narrow(drawPreviewHeader(els, still(back), name, drawHint(els, text, theme), still(external)))
  }
  const previewBody = (p: { text: string; path: string; markdown: boolean }) => {
    const body = paintPreview(els, { ...p, startLine: 1 })
    return desk ? deskPreview(k, body) : body
  }
  const noteOf = (note: string) => (desk ? deskPreviewNote(k, note) : drawPreviewNote(els, note))

  // The whole pane, then each piece top to bottom.
  add(
    'pane-tree',
    { en: 'File tree pane', pt: 'Painel da árvore de arquivos' },
    { en: 'The whole pane: header, branch, search, the tree and the footer', pt: 'O painel inteiro: cabeçalho, branch, busca, a árvore e o rodapé' },
    () => {
      const buttons = headerButtons(ctx.unicode, { follow: true, showHidden: false, showSize: false, selected: true })
      const done = act('git commit', 'done', '3f2a91c')
      if (desk)
        return frame([
          deskTitle(k, 'app', null),
          deskBranch(k, { branch, totals: [24, 7], counts }),
          gap(deskToolbar(k, buttons.filter(b => b.id !== 'unselect').map(still))),
          gap(deskSearch(k, { query: '', field: field(''), hint: null, clear: null })),
          rows(treeRows({ selected: appTsx.id }), { cursor: appTsx.id }),
          gap(deskFooter(k, 'src/app.tsx', deskChip(k, done), still(buttons.find(b => b.id === 'unselect')!))),
        ])
      return frame([
        drawHeader(els, 'app', theme, null, buttons.map(still)),
        drawBranchRow(els, { branch, totals: [24, 7], rootCounts: countSegs(counts, ink), unicode: ctx.unicode, theme }),
        drawSearchRow(els, { query: '', field: field(''), hint: null, clear: null }),
        rows(treeRows({ selected: appTsx.id }), { cursor: appTsx.id }),
        drawFooter(els, 'src/app.tsx', drawChip(els, done, ctx.unicode, theme)),
      ])
    },
  )
  add(
    'pane-preview',
    { en: 'File preview pane', pt: 'Painel de pré-visualização' },
    { en: 'The pane showing a file, when Open with is preview', pt: 'O painel mostrando um arquivo, quando Abrir com é preview' },
    () => frame([previewHeader('src/app.tsx'), gap(previewBody({ text: PREVIEW_CODE, path: appTsx.id, markdown: false }))]),
  )

  add('header', { en: 'Header row', pt: 'Linha do cabeçalho' }, { en: 'The root folder’s name and the header buttons; on the desktop the buttons sit on a row of their own', pt: 'O nome da pasta raiz e os botões do cabeçalho; no desktop os botões ficam numa linha própria' }, () => head())
  add(
    'header-hint',
    { en: 'Header button hover hint', pt: 'Dica ao passar o mouse num botão' },
    { en: 'What the hovered button does, beside the title, when it fits', pt: 'O que o botão sob o mouse faz, ao lado do título, quando cabe' },
    () => head({ hovered: 'refresh' }),
  )
  add('header-button-up', { en: 'Parent folder button', pt: 'Botão da pasta pai' }, { en: 'Moves the tree up one folder and stops following the cwd', pt: 'Sobe a árvore uma pasta e para de seguir a cwd' }, () => button('up'))
  add('header-button-cwd-following', { en: 'Follow cwd button, following', pt: 'Botão seguir cwd, seguindo' }, { en: 'Bright while the tree follows the working folder', pt: 'Aceso enquanto a árvore segue a pasta de trabalho' }, () => button('cwd'))
  add('header-button-cwd-pinned', { en: 'Follow cwd button, pinned', pt: 'Botão seguir cwd, fixada' }, { en: 'Dim while the tree is pinned elsewhere; a press goes back to the cwd', pt: 'Apagado enquanto a árvore está fixada em outro lugar; um clique volta à cwd' }, () => button('cwd', { follow: false }))
  add('header-button-refresh', { en: 'Refresh button', pt: 'Botão recarregar' }, { en: 'Reloads the tree and git status', pt: 'Recarrega a árvore e o status do git' }, () => button('refresh'))
  add('header-button-hidden-off', { en: 'Hidden files button, off', pt: 'Botão arquivos ocultos, desligado' }, { en: 'Dim while dotfiles are hidden', pt: 'Apagado enquanto os dotfiles estão ocultos' }, () => button('hidden'))
  add('header-button-hidden-on', { en: 'Hidden files button, on', pt: 'Botão arquivos ocultos, ligado' }, { en: 'Bright while dotfiles show; on the terminal another glyph too', pt: 'Aceso enquanto os dotfiles aparecem; no terminal, com outro ícone também' }, () => button('hidden', { showHidden: true }))
  add('header-button-size-off', { en: 'Size button, off', pt: 'Botão tamanho, desligado' }, { en: 'Dim while the right column shows dates', pt: 'Apagado enquanto a coluna da direita mostra datas' }, () => button('size'))
  add('header-button-size-on', { en: 'Size button, on', pt: 'Botão tamanho, ligado' }, { en: 'Bright while the right column shows sizes', pt: 'Aceso enquanto a coluna da direita mostra tamanhos' }, () => button('size', { showSize: true }))
  add('header-button-collapse', { en: 'Collapse all button', pt: 'Botão recolher tudo' }, { en: 'Closes every open folder', pt: 'Fecha todas as pastas abertas' }, () => button('collapse'))
  add('header-button-unselect', { en: 'Clear selection button', pt: 'Botão limpar seleção' }, { en: 'Shows only while a file is selected; on the desktop beside it in the footer', pt: 'Aparece só enquanto há um arquivo selecionado; no desktop ao lado dele, no rodapé' }, () => button('unselect'))

  add('branch-row', { en: 'Branch row', pt: 'Linha da branch' }, { en: 'Branch, commits ahead and behind, upstream, lines added and removed, and file counts', pt: 'Branch, commits à frente e atrás, upstream, linhas adicionadas e removidas, e contagem de arquivos' }, () => branchRow())
  add('branch-row-clean', { en: 'Branch row, clean', pt: 'Linha da branch, limpa' }, { en: 'Nothing changed: the row ends with clean', pt: 'Nada mudou: a linha termina com clean' }, () => branchRow({ clean: true }))
  add('branch-row-flash', { en: 'Branch row, after a push', pt: 'Linha da branch, após um push' }, { en: 'Lit for a moment after a push, pull or commit', pt: 'Acesa por um momento após um push, pull ou commit' }, () => branchRow({ flashTone: 'teal' }))
  add('no-repo-hint', { en: 'No git repo line', pt: 'Linha sem repositório git' }, { en: 'Under the header outside a git repo, while Hints is on', pt: 'Sob o cabeçalho fora de um repositório git, com Dicas ligado' }, () => noRepo())

  add('search-row', { en: 'Search field', pt: 'Campo de busca' }, { en: 'Filters the tree as you type; Enter jumps to the first match', pt: 'Filtra a árvore enquanto você digita; Enter pula para o primeiro resultado' }, () => search(''))
  add(
    'search-row-query',
    { en: 'Search field with a query', pt: 'Campo de busca com texto' },
    { en: 'A query typed, with the clear button at the end', pt: 'Um texto digitado, com o botão limpar no fim' },
    () => search('app'),
  )
  add(
    'search-clear-hint',
    { en: 'Clear search hover hint', pt: 'Dica do botão limpar busca' },
    { en: 'What the clear button does, beside it, while hovered', pt: 'O que o botão limpar faz, ao lado dele, com o mouse em cima' },
    () => search('app', true),
  )

  add('dir-row-collapsed', { en: 'Folder row, collapsed', pt: 'Linha de pasta, recolhida' }, { en: 'A closed folder: its caret points right', pt: 'Uma pasta fechada: a seta aponta para a direita' }, () => one(row(components)))
  add('dir-row-expanded', { en: 'Folder row, expanded', pt: 'Linha de pasta, expandida' }, { en: 'An open folder, its children indented under it', pt: 'Uma pasta aberta, com os filhos recuados abaixo' }, () => rows([row(components, { open: true }), row(node(`${components.id}/Button.tsx`, 'file', now - 6 * HOUR), { depth: 1 })]))
  add('dir-row-counts', { en: 'Folder row with git counts', pt: 'Linha de pasta com contagens do git' }, { en: 'Untracked, modified and deleted files below it, in place of a status letter', pt: 'Arquivos não rastreados, modificados e removidos abaixo dela, no lugar da letra de status' }, () => one(row(src, { open: true, counts })))
  add('dir-row-repo', { en: 'Repo folder row', pt: 'Linha da pasta do repositório' }, { en: 'The repo’s own folder, when the tree shows its parent; a git icon with Nerd Font glyphs', pt: 'A pasta do próprio repositório, quando a árvore mostra a pasta pai; ícone do git com Nerd Font' }, () => one(row(node('/home/you/app', 'dir', now - HOUR), { isRepo: true })))
  add('file-row', { en: 'File row', pt: 'Linha de arquivo' }, { en: 'An unchanged file: icon, name, and its date in the right column', pt: 'Um arquivo sem mudanças: ícone, nome e a data na coluna da direita' }, () => one(row(readme)))
  add('file-row-hidden', { en: 'Hidden file row', pt: 'Linha de arquivo oculto' }, { en: 'A dotfile, muted, while hidden files show', pt: 'Um dotfile, esmaecido, enquanto os arquivos ocultos aparecem' }, () => one(row(env)))
  add('link-row', { en: 'Symlink row', pt: 'Linha de link simbólico' }, { en: 'A link to a file; its own icon with Nerd Font glyphs', pt: 'Um link para um arquivo; ícone próprio com Nerd Font' }, () => one(row(link)))

  const status = (id: string, en: string, pt: string, helpEn: string, helpPt: string, letter: string, n: FileNode, loc?: [number, number]) =>
    add(id, { en, pt }, { en: helpEn, pt: helpPt }, () => one(row(n, { status: letter, ...(loc ? { loc } : {}) })))
  status('file-row-modified', 'File row, modified', 'Linha de arquivo, modificado', 'Name and M in the warning colour, with the lines changed', 'Nome e M na cor de aviso, com as linhas alteradas', 'M', appTsx, [12, 3])
  status('file-row-type-changed', 'File row, type changed', 'Linha de arquivo, tipo alterado', 'T in the warning colour: a file that became a link or the other way round', 'T na cor de aviso: um arquivo que virou link ou o contrário', 'T', node(`${ROOT}/bin/run`, 'file', now - HOUR))
  status('file-row-added', 'File row, added', 'Linha de arquivo, adicionado', 'Name and A in the ok colour: staged as new', 'Nome e A na cor de ok: adicionado ao stage como novo', 'A', utilTs, [40, 0])
  status('file-row-untracked', 'File row, untracked', 'Linha de arquivo, não rastreado', 'Name and ? in the ok colour: not in git yet, or inside an untracked folder', 'Nome e ? na cor de ok: ainda fora do git, ou dentro de uma pasta não rastreada', '?', node(`${ROOT}/src/new.ts`, 'file', now - 20 * 60_000))
  status('file-row-deleted', 'File row, deleted', 'Linha de arquivo, removido', 'In the error colour, struck through, D', 'Na cor de erro, riscado, D', 'D', node(`${ROOT}/src/old.ts`, 'file', now - 8 * HOUR))
  status('file-row-renamed', 'File row, renamed', 'Linha de arquivo, renomeado', 'Name and R in the accent (blue on the terminal)', 'Nome e R na cor de destaque (azul no terminal)', 'R', node(`${ROOT}/src/main.ts`, 'file', now - HOUR))
  status('file-row-copied', 'File row, copied', 'Linha de arquivo, copiado', 'Name and C in the accent (blue on the terminal)', 'Nome e C na cor de destaque (azul no terminal)', 'C', node(`${ROOT}/src/main.copy.ts`, 'file', now - HOUR))
  status('file-row-conflicted', 'File row, conflicted', 'Linha de arquivo, em conflito', 'Name and U in the error colour: a merge conflict', 'Nome e U na cor de erro: um conflito de merge', 'U', node(`${ROOT}/src/merge.ts`, 'file', now - HOUR))
  add('file-row-ignored', { en: 'Ignored row', pt: 'Linha ignorada' }, { en: 'Ignored by git: faint; on the terminal with the ignored mark', pt: 'Ignorado pelo git: apagado; no terminal com a marca de ignorado' }, () => one(row(dist, { isIgnored: true })))
  add('lines-changed', { en: 'Lines changed', pt: 'Linhas alteradas' }, { en: 'Lines added in the ok colour and removed in the error colour, in place of the date', pt: 'Linhas adicionadas na cor de ok e removidas na cor de erro, no lugar da data' }, () => one(row(appTsx, { status: 'M', loc: [128, 46] })))

  add('right-column-date', { en: 'Right column, date', pt: 'Coluna da direita, data' }, { en: 'When each file last changed, the default', pt: 'Quando cada arquivo mudou pela última vez, o padrão' }, () => rows([row(readme), row(pkg)]))
  add('right-column-age', { en: 'Right column, age', pt: 'Coluna da direita, idade' }, { en: 'How long ago each file changed, short, with Right column set to age', pt: 'Há quanto tempo cada arquivo mudou, curto, com Coluna da direita em age' }, () => rows([row(appTsx, { showAge: true }), row(utilTs, { showAge: true }), row(readme, { showAge: true }), row(pkg, { showAge: true })]))
  add(
    'right-column-size',
    { en: 'Right column, size', pt: 'Coluna da direita, tamanho' },
    { en: 'File sizes, and folders as disk usage, with the size button on', pt: 'Tamanho dos arquivos, e das pastas pelo uso de disco, com o botão tamanho ligado' },
    () => rows([row(src, { showSize: true, dirSizes: { [src.id]: 184_320 } }), row(readme, { showSize: true }), row(pkg, { showSize: true })]),
  )
  add('right-column-size-pending', { en: 'Right column, size being computed', pt: 'Coluna da direita, tamanho sendo calculado' }, { en: 'A folder’s size while it is computed in the background', pt: 'O tamanho de uma pasta enquanto é calculado em segundo plano' }, () => one(row(components, { showSize: true })))

  add('row-cursor', { en: 'Cursor row', pt: 'Linha do cursor' }, { en: 'The keyboard cursor, on a tint of the accent (the selection colour on the terminal)', pt: 'O cursor do teclado, num tom da cor de destaque (a cor de seleção no terminal)' }, () => one(row(utilTs), { bg: activeBg }))
  add('row-selected', { en: 'Selected row', pt: 'Linha selecionada' }, { en: 'The selected file, bold; Claude reads it as “this” in a prompt', pt: 'O arquivo selecionado, em negrito; o Claude o entende como “isto” no prompt' }, () => one(row(readme, { selected: true })))
  add('row-hover', { en: 'Hovered row', pt: 'Linha sob o mouse' }, { en: 'The row under the pointer, lit as the app’s list rows are', pt: 'A linha sob o ponteiro, acesa como as linhas de lista do app' }, () => rows([row(readme)], { hover: 0 }))

  const lit = (id: string, en: string, pt: string, helpEn: string, helpPt: string, n: FileNode, tone: string, dim = false) =>
    add(id, { en, pt }, { en: helpEn, pt: helpPt }, () => one(row(n, dim ? { isDim: true, tone, open: false } : { isBright: true, tone })))
  lit('activity-read', 'Activity shimmer, read', 'Brilho de atividade, leitura', 'A glint over a file Claude read or searched (purple on the terminal)', 'Um brilho sobre um arquivo que o Claude leu ou buscou (roxo no terminal)', readme, 'read')
  lit('activity-write', 'Activity shimmer, write', 'Brilho de atividade, escrita', 'In the accent: a file Claude wrote or edited', 'Na cor de destaque: um arquivo que o Claude escreveu ou editou', appTsx, 'orange')
  lit('activity-git', 'Activity shimmer, git', 'Brilho de atividade, git', 'In the ok colour: a file Claude staged or committed', 'Na cor de ok: um arquivo que o Claude adicionou ou commitou', utilTs, 'green')
  lit('activity-parent', 'Activity shimmer, closed folder', 'Brilho de atividade, pasta fechada', 'Dim tone on a folder opened to reveal a lit file', 'Tom apagado numa pasta aberta para revelar um arquivo aceso', components, 'orange', true)

  add('activity-chip-running', { en: 'Activity chip, running', pt: 'Chip de atividade, rodando' }, { en: 'Bottom right: the git action Claude is running, bold, in the accent', pt: 'Canto inferior direito: a ação do git que o Claude está rodando, em negrito, na cor de destaque' }, () => chip(act('git commit', 'running')))
  add('activity-chip-done', { en: 'Activity chip, done', pt: 'Chip de atividade, concluído' }, { en: 'The finished action; a commit shows its short hash', pt: 'A ação concluída; um commit mostra o hash curto' }, () => chip(act('git commit', 'done', '3f2a91c')))
  add('activity-chip-failed', { en: 'Activity chip, failed', pt: 'Chip de atividade, falhou' }, { en: 'A failed action, in the error colour', pt: 'Uma ação que falhou, na cor de erro' }, () => chip(act('git push', 'failed')))
  add('footer-selected', { en: 'Selected file footer', pt: 'Rodapé do arquivo selecionado' }, { en: 'Bottom left: the selected file, relative to the root', pt: 'Canto inferior esquerdo: o arquivo selecionado, relativo à raiz' }, () => footer('src/app.tsx', null))
  add('footer', { en: 'Footer', pt: 'Rodapé' }, { en: 'The selected file and the activity chip together', pt: 'O arquivo selecionado e o chip de atividade juntos' }, () => footer('src/app.tsx', act('git push', 'running')))

  add('note-empty', { en: 'Empty folder note', pt: 'Aviso de pasta vazia' }, { en: 'The tree of a folder with nothing to show', pt: 'A árvore de uma pasta sem nada para mostrar' }, () => (desk ? narrow(deskEmpty(k, '')) : one(noteRow(EMPTY_NOTE, ink.muted))))
  add('note-no-match', { en: 'Search with no match', pt: 'Busca sem resultado' }, { en: 'A search that matched no file, and how to get every file back', pt: 'Uma busca que não achou nenhum arquivo, e como ver todos de novo' }, () => (desk ? narrow(deskEmpty(k, 'zebra')) : one(noteRow(EMPTY_NOTE, ink.muted))))
  add('note-cut', { en: 'Tree cut note', pt: 'Aviso de árvore cortada' }, { en: 'Ends a tree too large to draw whole; in the desktop app, where every row is drawn, the usual place it shows', pt: 'Encerra uma árvore grande demais para desenhar inteira; no app desktop, que desenha todas as linhas, é onde costuma aparecer' }, () => rows([row(pkg), noteRow(cutNote(1_284), ink.muted)]))
  if (surface === 'terminal') {
    add(
      'pinned-rows',
      { en: 'Pinned lit rows', pt: 'Linhas acesas fixadas' },
      { en: 'Lit files above the view stay pinned on top, a gap after them', pt: 'Arquivos acesos acima da vista ficam fixados no topo, com um intervalo depois' },
      () => rows([row(readme, { isBright: true, tone: 'read' }), noteRow(PINNED_GAP, ink.muted), row(appTsx, { depth: 1, status: 'M', loc: [12, 3] }), row(utilTs, { depth: 1, status: 'A', loc: [40, 0] })]),
    )
    add(
      'scrollbar',
      { en: 'Scrollbar', pt: 'Barra de rolagem' },
      { en: 'At the right edge when the tree is longer than the pane; drag it to scroll', pt: 'Na borda direita quando a árvore é maior que o painel; arraste para rolar' },
      () => {
        const specs = treeRows()
        return (
          <Box flexDirection="column" width={columns}>
            {specs.map((r, i) => paint(r, { bar: { thumb: i >= 2 && i < 5, color: i >= 2 && i < 5 ? theme.accent : theme.muted } }))}
          </Box>
        )
      },
    )
  } else {
    const terminalOnly = { en: 'Drawn in the terminal; the desktop app scrolls the pane itself.', pt: 'Desenhado no terminal; o app desktop rola o painel sozinho.' }
    add('pinned-rows', { en: 'Pinned lit rows', pt: 'Linhas acesas fixadas' }, { en: 'Lit files above the view stay pinned on top (terminal)', pt: 'Arquivos acesos acima da vista ficam fixados no topo (terminal)' }, () => <Text dimColor>{say(terminalOnly)}</Text>)
    add('scrollbar', { en: 'Scrollbar', pt: 'Barra de rolagem' }, { en: 'The pane’s own scrollbar (terminal)', pt: 'A barra de rolagem do próprio painel (terminal)' }, () => <Text dimColor>{say(terminalOnly)}</Text>)
  }

  add('preview-header', { en: 'Preview header', pt: 'Cabeçalho da pré-visualização' }, { en: 'Back to the files, the file’s path, and open in the default app', pt: 'Voltar aos arquivos, o caminho do arquivo e abrir no app padrão' }, () => previewHeader('src/app.tsx'))
  add('preview-header-hint', { en: 'Preview header hover hint', pt: 'Dica do cabeçalho da pré-visualização' }, { en: 'What the hovered back or open button does', pt: 'O que o botão voltar ou abrir sob o mouse faz' }, () => previewHeader('src/app.tsx', 'back'))
  add('preview-code', { en: 'Preview, code', pt: 'Pré-visualização, código' }, { en: 'A source file, highlighted, with line numbers', pt: 'Um arquivo de código, destacado, com números de linha' }, () => narrow(previewBody({ text: PREVIEW_CODE, path: appTsx.id, markdown: false })))
  add('preview-markdown', { en: 'Preview, markdown', pt: 'Pré-visualização, markdown' }, { en: 'A markdown file, rendered', pt: 'Um arquivo markdown, renderizado' }, () => narrow(previewBody({ text: PREVIEW_MD, path: readme.id, markdown: true })))
  const previewNote = (id: string, en: string, pt: string, helpEn: string, helpPt: string, note: string) =>
    add(id, { en, pt }, { en: helpEn, pt: helpPt }, () => frame([previewHeader('logo.png'), gap(noteOf(note))]))
  previewNote('preview-note-binary', 'Preview, binary file', 'Pré-visualização, arquivo binário', 'A binary file is not drawn: a note says so, with its size', 'Um arquivo binário não é desenhado: um aviso diz isso, com o tamanho', `binary file, ${formatSize(48_213)}`)
  previewNote('preview-note-large', 'Preview, file too large', 'Pré-visualização, arquivo grande demais', 'Past 4 MB the file is not read', 'Acima de 4 MB o arquivo não é lido', `${formatSize(9_437_184)}, too large to preview`)
  previewNote('preview-note-partial', 'Preview, first lines only', 'Pré-visualização, só as primeiras linhas', 'A long file shows its first lines, and says how many', 'Um arquivo longo mostra as primeiras linhas, e diz quantas', `first 1,820 lines of ${(140_512).toLocaleString('en')} characters`)
  previewNote('preview-note-error', 'Preview, unreadable', 'Pré-visualização, ilegível', 'The file could not be read, and why', 'O arquivo não pôde ser lido, e o motivo', 'could not read: EACCES: permission denied')

  const sample = (unicode: boolean) => (
    <Box flexDirection="column" width={columns} rowGap={desk ? 1 : 0}>
      {head({ unicode, selected: true })}
      {rows([
        row(src, { open: true }, unicode),
        row(appTsx, { depth: 1 }, unicode),
        row(readme, {}, unicode),
        row(pkg, {}, unicode),
        row(link, {}, unicode),
        row(dist, { isIgnored: true }, unicode),
      ])}
    </Box>
  )
  add('glyphs-nerd', { en: 'Nerd Font glyphs', pt: 'Ícones Nerd Font' }, { en: 'Icons per file type and chevrons, with a Nerd Font (Icons: nerd, or auto in a terminal that has one)', pt: 'Ícones por tipo de arquivo e setas, com uma Nerd Font (Ícones: nerd, ou auto num terminal que tenha uma)' }, () => sample(false))
  add('glyphs-plain', { en: 'Plain Unicode glyphs', pt: 'Ícones Unicode simples' }, { en: 'Unicode only: a terminal with no Nerd Font, or Icons: plain; the desktop app on auto draws no type glyph, a folder has its caret', pt: 'Só Unicode: um terminal sem Nerd Font, ou Ícones: plain; o app desktop no auto não desenha ícone de tipo, a pasta tem a sua seta' }, () => sample(true))

  // Not drawn on this surface: the pane shows in the terminal and the desktop app alone.
  if (surface !== 'terminal' && surface !== 'desktop') {
    const where = say({ en: 'Shows in the terminal and the desktop app.', pt: 'Aparece no terminal e no app desktop.' })
    return entries.map(entry => ({ ...entry, tree: <Text dimColor>{where}</Text> }))
  }
  return entries.map(entry => ({ ...entry, tree: staticTree(entry.tree) }))
}

