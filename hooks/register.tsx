import { type BuiltinToolResults, type EngineInterface, type Register, type Timer, update } from 'claude-code'
import { LINUX_LAUNCH, openCommand, openWithCommand } from './open'
import type { ButtonProps } from './button'
import { catalogOf } from './catalog'

import type { Activity, FileNode, FileTree, FiletreeActArgs, FiletreeCatalogEntry, FiletreeActResult, FiletreeItem, FiletreeLang, FiletreePanel, FiletreePanelArgs, Theme } from '../types'
import { chainOf, type GitAction, gitActions, readOnly, readTargets, resolve } from './git'
import type { RowsProps } from './rows'
import type { RowSpec } from './paint'
import { cutNote } from './paint'
import {
  backButton,
  BRANCH_ROW,
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
  metaOf,
  nodeRow,
  noteRow,
  PINNED_GAP,
  SEARCH,
  SHIMMER,
  hintFor,
} from './look'
import {
  ancestorsOf,
  type Change,
  DEFAULT_THEME,
  dirname,
  emptyTree,
  formatSize,
  inside,
  isAbsolute,
  join,
  mapper,
  parseGit,
  parseNumstat,
  parseTheme,
  posix,
  relative,
  dropBelow,
  useDrives,
  rollCounts,
  replaceChildren,
  rollUp,
  toNodes,
  underAny,
  visibleRows,
} from './tree'

const TREE = { plugin: 'filetree', key: 'tree' } as const
const THEME = { plugin: 'filetree', key: 'theme' } as const
const ACTIVITY = { plugin: 'filetree', key: 'activity' } as const
const PANE = 'filetree'
const FLASH_MS = 2700
const RUNNING_MAX_MS = 600_000
const NO_REPO_DEPTH = 4
const DOUBLE_MS = 450
const FIND_LIMIT = 200
const ROWS_BUDGET = 80_000
const READ_REVEAL_LIMIT = 12
const SEARCH_REVEAL_LIMIT = 60
const ACTIVITY_TTL_MS = 45_000
const THEME_FILE = '.local/state/omarchy/current/theme/colors.toml'
const THEME_POLL_MS = 2000
const FONT_SCRIPT =
  'if command -v fc-list >/dev/null 2>&1; then f=$(fc-list ":charset=$1" file | head -n1 | cut -d: -f1); ' +
  'else f=$(ls "$HOME"/Library/Fonts/*Nerd* /Library/Fonts/*Nerd* 2>/dev/null | head -n1); fi; ' +
  '[ -n "$f" ] || { echo missing; exit 0; }; m=$(stat -c %Z "$f" 2>/dev/null || stat -f %c "$f"); p=$PPID; ' +
  'while [ -n "$p" ] && [ "$p" -gt 1 ]; do c=$(ps -o comm= -p "$p" 2>/dev/null); c=$(basename "$c" 2>/dev/null | tr -d " "); case "$c" in ' +
  'ghostty|kitty|alacritty|Alacritty|foot|footclient|wezterm-gui|konsole|gnome-terminal-|xterm|urxvt|st|Terminal|iTerm2) ' +
  'e=$(ps -o etime= -p "$p" 2>/dev/null | awk -F\'[-:]\' \'{n=NF; s=$n+60*$(n-1); if (n>2) s+=3600*$(n-2); if (n>3) s+=86400*$(n-3); print s}\'); [ -n "$e" ] && [ $(( $(date +%s) - e )) -lt "$m" ] && echo stale || echo ok; exit 0;; esac; ' +
  'p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); done; echo ok'
const PRUNE = ['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next']
const HOME_PRUNE = ['Library', 'AppData', '.Trash']
const SIZE_TIMEOUT_MS = 15_000
const SIZE_JOBS = 2
const SIZE_WALK_LIMIT = 50_000
const AGE_TICK_MS = 60_000
// The user's settings that live in the store rather than in userConfig, and how often another
// session's change to them is picked up.
const HIDDEN_KEY = 'showHidden'
const STORE_POLL_MS = 3_000

let blink: Timer | null = null
let themePoll: Timer | null = null
let ageTick: Timer | null = null
let storePoll: Timer | null = null
let themeMtime: number | null = null
let generation = 0
let lastPress = { key: '', at: 0 }
let noNerd = false
let glyphSetting = 'auto'
let openWithSetting = ''
let previewed: { path: string; text: string; note: string } | null = null
let previewRows = 20
let follow = true
let followClaude = true
let scanning: Promise<void> | null = null
let scanJobs: Job[] = []
let gitRun: Promise<void> | null = null
let gitNext: Promise<void> | null = null
let queuedReads: string[] = []
let showReads = true
let showWrites = true
let searchIndex: { root: string; paths: Promise<string[]> } | null = null
let activityId = 0
let pointer = true
let hovered = ''
let view = { from: 0, max: 0 }
let nativeScroll = false
let lastSync = 0
let noDock = false
// Set once a terminal drew the pane inline: the main-screen layout, fixed for the session.
let inlineLayout = false
// The language the /mods hub last drew this tab in; an act's toast speaks it.
let hubLang: FiletreeLang = 'en'
let home = ''
let platform: Promise<'linux' | 'darwin' | 'win32'> | null = null
let dirty: { root: string; files: Record<string, Change> } = { root: '', files: {} }
let markId = 0
let listSeq = 0
let lastRoot = ''
let sizeDefault = false
let showAge = false
let showHints = true
let sizeEpoch = 0
let sizeActive = 0
let sizeQueue: string[] = []
const sizing = new Set<string>()
const listLatest = new Map<string, number>()
const unreadable = new Set<string>()
const background = new Map<string, Background>()

function osName($: EngineInterface): Promise<'linux' | 'darwin' | 'win32'> {
  platform ??= (async () => {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
    try {
      return (await $.process.run(['uname', '-s'], { timeoutMs: 3_000 })).stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
    } catch {
      return 'linux'
    }
  })()
  return platform
}

async function cwdOf($: EngineInterface): Promise<string> {
  return posix(await $.session.cwd())
}

// Plain Unicode glyphs in place of Nerd Font icons: the Glyphs setting, and on auto the desktop
// app or a terminal with no Nerd Font.
function unicodeOn(surface: string): boolean {
  return glyphSetting === 'plain' || (glyphSetting === 'auto' && (noNerd || surface === 'desktop'))
}

async function get($: EngineInterface): Promise<FileTree> {
  return { ...emptyTree(''), ...(await $.state.get(TREE)).value }
}

async function put($: EngineInterface, fn: (t: FileTree) => FileTree): Promise<void> {
  await update($, TREE, cur => fn({ ...emptyTree(''), ...cur }))
}

function patch($: EngineInterface, fn: (t: FileTree) => Partial<FileTree>) {
  return put($, t => ({ ...t, ...fn(t) }))
}

// Hidden files is the user's setting: the store holds it for every session and project, and
// the tree atom only mirrors it for the draws of this one.
async function storedHidden($: EngineInterface): Promise<boolean> {
  try {
    return (await $.store.get(HIDDEN_KEY)) !== false
  } catch {
    return true
  }
}

async function setHidden($: EngineInterface, on: boolean): Promise<void> {
  await patch($, () => ({ showHidden: on }))
  try {
    await $.store.set(HIDDEN_KEY, on)
  } catch {
    $.ui.toast('Could not save the hidden files setting')
  }
}

// Picks up a change another session wrote; the atom moves only when the stored value did.
async function pullSettings($: EngineInterface): Promise<void> {
  const on = await storedHidden($)
  if ((await get($)).showHidden !== on) await patch($, () => ({ showHidden: on }))
}

async function activities($: EngineInterface): Promise<Activity[]> {
  return (await $.state.get(ACTIVITY)).value ?? []
}

async function setActivities($: EngineInterface, fn: (list: Activity[]) => Activity[]): Promise<void> {
  await update($, ACTIVITY, cur => fn(cur ?? []).slice(-6))
}

async function list($: EngineInterface, dir: string): Promise<FileNode[] | null> {
  try {
    const entries = await $.fs.list(dir)
    const resolved = await Promise.all(
      entries.map(async e => {
        if (!e.isLink) return { name: e.name, kind: e.kind, mtimeMs: e.mtimeMs, size: e.size, isLink: false }
        try {
          const target = await $.fs.stat(join(dir, e.name))
          return target.kind === 'dir'
            ? { name: e.name, kind: 'dir' as const, mtimeMs: target.mtimeMs, size: 0, isLink: false }
            : { name: e.name, kind: 'file' as const, mtimeMs: target.mtimeMs, size: target.size, isLink: true }
        } catch {
          return { name: e.name, kind: 'other' as const, mtimeMs: 0, size: 0, isLink: true }
        }
      }),
    )
    unreadable.delete(dir)
    return toNodes(dir, resolved)
  } catch (err) {
    if (!(await exists($, dir))) return []
    if (!unreadable.has(dir)) {
      unreadable.add(dir)
      $.ui.toast(`could not list ${shortPath(dir)}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return null
  }
}

async function loadDirs($: EngineInterface, dirs: string[]): Promise<Map<string, FileNode[]>> {
  const root = (await get($)).root
  const seq = ++listSeq
  for (const dir of dirs) listLatest.set(dir, seq)
  const results = await Promise.all(dirs.map(async dir => [dir, await list($, dir)] as const))
  const listed = new Map<string, FileNode[]>()
  for (const [dir, kids] of results) {
    if (listLatest.get(dir) !== seq) continue
    listLatest.delete(dir)
    if (kids) listed.set(dir, kids)
  }
  await patch($, t => (t.root === root ? { nodes: replaceChildren(t.nodes, listed) } : {}))
  return listed
}

async function git($: EngineInterface, cwd: string, args: string[], timeoutMs = 20_000) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args], { timeoutMs, env: { GIT_OPTIONAL_LOCKS: '0' } })
}

async function detectRepo($: EngineInterface): Promise<void> {
  const t = await get($)
  if (!t.root) return
  let top = ''
  let prefix = ''
  try {
    const run = await git($, t.root, ['rev-parse', '--show-prefix', '--show-toplevel'], 5_000)
    const [p = '', tl = ''] = run.exitCode === 0 ? run.stdout.split('\n') : []
    prefix = p.trim()
    top = tl.trim()
  } catch {
    top = ''
  }
  await patch($, cur => (cur.root === t.root ? { top, prefix } : {}))
}

async function readGit($: EngineInterface): Promise<void> {
  const t = await get($)
  if (!t.root || !t.top) return
  const root = t.root
  try {
    const status = await git($, root, ['status', '--porcelain=v1', '-b', '-z', '--ignored=traditional', '--untracked-files=normal', '--', '.'])
    if (status.exitCode !== 0) return
    const parsed = parseGit(status.stdout, root, t.prefix)
    const diff: Record<string, [number, number]> = {}
    const head = await git($, root, ['diff', 'HEAD', '--numstat', '-z', '--', '.'])
    if (head.exitCode === 0) parseNumstat(head.stdout, root, t.prefix, diff)
    const files = { ...parsed.files }
    if (parsed.untrackedDirs.length) {
      const others = await git($, root, ['ls-files', '-o', '--exclude-standard', '-z', '--', ...parsed.untrackedDirs.map(d => d.slice(root.length + 1) || '.')])
      if (others.exitCode === 0) for (const rel of others.stdout.split('\0').filter(Boolean)) files[join(root, rel)] = 'new'
    }
    for (const path of Object.keys(diff)) if (files[path] === 'new') delete diff[path]
    dirty = { root, files }
    await patch($, cur =>
      cur.root === root
        ? {
            git: parsed.git,
            ignored: parsed.ignored,
            untrackedDirs: parsed.untrackedDirs,
            branch: parsed.branch,
            counts: rollCounts(files, root),
            diff: rollUp(diff, root),
          }
        : {},
    )
  } catch {
    return
  }
}

function refreshGit($: EngineInterface): Promise<void> {
  if (!gitRun) {
    gitRun = readGit($).finally(() => {
      gitRun = null
    })
    return gitRun
  }
  const rerun = () => {
    gitNext = null
    return refreshGit($)
  }
  gitNext ??= gitRun.then(rerun, rerun)
  return gitNext
}

async function reset($: EngineInterface, root: string, focus = false): Promise<void> {
  const prev = await get($)
  generation += 1
  blink?.cancel()
  blink = null
  lastRoot = root
  searchIndex = null
  sizeEpoch += 1
  sizeQueue = []
  await put($, () => ({ ...emptyTree(root), showHidden: prev.showHidden, showSize: prev.root ? prev.showSize : sizeDefault }))
  const title = `Files: ${root.split('/').pop() || root}`
  if (focus) await $.ui.open({ id: PANE, title, focus: true })
  else if (!noDock) await $.ui.open({ id: PANE, title })
  await loadDirs($, [root])
  await detectRepo($)
  await refreshGit($)
}

async function revealPaths($: EngineInterface, paths: string[]): Promise<void> {
  const tried = new Set<string>()
  for (let pass = 0; pass < 32; pass++) {
    const t = await get($)
    const loaded = new Set(t.nodes.filter(n => n.loaded).map(n => n.id))
    if (t.nodes.some(n => n.parent === t.root)) loaded.add(t.root)
    const need = new Set<string>()
    for (const p of paths) {
      for (const dir of [t.root, ...ancestorsOf(p, t.root).reverse()]) {
        if (!loaded.has(dir)) {
          if (!tried.has(dir)) need.add(dir)
          break
        }
      }
    }
    if (need.size === 0) return
    for (const dir of need) tried.add(dir)
    await loadDirs($, [...need])
  }
}

function pruneArgs(root: string, ignored: string[] = []): string[] {
  const names = broad(root) ? [...PRUNE, ...HOME_PRUNE] : PRUNE
  return ['(', ...names.flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name])), ...ignored.flatMap(p => ['-o', '-path', p]), ')', '-prune', '-o']
}

async function newer($: EngineInterface, paths: string[], sinceMs: number): Promise<string[]> {
  const stats = await Promise.all(
    paths.map(async p => {
      try {
        return (await $.fs.stat(p)).mtimeMs > sinceMs ? p : ''
      } catch {
        return ''
      }
    }),
  )
  return stats.filter(Boolean)
}

function broad(root: string): boolean {
  return root === home || root === '/' || /^[A-Za-z]:\/$/.test(root)
}

function rootOfDisk(root: string): boolean {
  return root === '/' || /^[A-Za-z]:\/$/.test(root)
}

async function changedSince($: EngineInterface, root: string, since: Since, depth: number, ignored: string[] = []): Promise<string[]> {
  if (rootOfDisk(root)) return []
  const test = since.mark ? ['-newer', since.mark] : ['-newermt', `@${(since.ms / 1000).toFixed(3)}`]
  try {
    const run = await $.process.run(['find', '-H', root, '-xdev', ...(depth ? ['-maxdepth', String(depth)] : []), ...pruneArgs(root, ignored.filter(p => inside(root, p)).slice(0, 40)), ...test, '-print0'], { timeoutMs: 8_000 })
    return run.stdout.split('\0').filter(p => p && p !== root)
  } catch {
    return []
  }
}

async function changedInRepo($: EngineInterface, root: string, since: Since, before: Record<string, Change>, ignored: string[]): Promise<{ hits: string[]; gone: string[] }> {
  if (since.os !== 'win32') return { hits: await changedSince($, root, since, 0, ignored), gone: [] }
  if (dirty.root !== root) return { hits: [], gone: [] }
  const entries = Object.entries(dirty.files)
  const gone = entries.filter(([p, c]) => c === 'del' && before[p] !== 'del').map(([p]) => p)
  const live = entries.filter(([, c]) => c !== 'del').map(([p]) => p)
  return { hits: await newer($, live.slice(0, 4_000), since.ms), gone }
}

type Since = { ms: number; mark: string; os: 'linux' | 'darwin' | 'win32' }

async function sinceNow($: EngineInterface, writes: boolean): Promise<Since> {
  const ms = await $.clock.now()
  const os = await osName($)
  if (os !== 'darwin' || !writes) return { ms, mark: '', os }
  const mark = `${((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')}/filetree-${await $.session.id()}-${++markId}.mark`
  try {
    await $.process.run(['touch', mark], { timeoutMs: 3_000 })
    return { ms, mark, os }
  } catch {
    return { ms, mark: '', os }
  }
}

async function walkSize($: EngineInterface, dir: string): Promise<number> {
  let total = 0
  let seen = 0
  let level = [dir]
  while (level.length) {
    const next: string[] = []
    for (const d of level) {
      let entries
      try {
        entries = await $.fs.list(d)
      } catch {
        continue
      }
      for (const e of entries) {
        if (++seen > SIZE_WALK_LIMIT) return -1
        if (e.kind === 'dir' && !e.isLink) next.push(join(d, e.name))
        else if (e.kind === 'file') total += e.size
      }
    }
    level = next
  }
  return total
}

async function dirSize($: EngineInterface, dir: string): Promise<number> {
  if (rootOfDisk(dir)) return -1
  if ((await osName($)) === 'win32') return walkSize($, dir)
  try {
    const run = await $.process.run(['du', '-skxH', dir], { timeoutMs: SIZE_TIMEOUT_MS })
    const kb = Number(run.stdout.trim().split(/\s/)[0] || NaN)
    return Number.isFinite(kb) ? kb * 1024 : -1
  } catch {
    return -1
  }
}

function pumpSizes($: EngineInterface): void {
  while (sizeActive < SIZE_JOBS && sizeQueue.length) {
    const dir = sizeQueue.shift() ?? ''
    const epoch = sizeEpoch
    sizing.add(dir)
    sizeActive += 1
    void dirSize($, dir)
      .then(async bytes => {
        if (epoch === sizeEpoch) return patch($, cur => (inside(cur.root, dir) ? { dirSizes: { ...cur.dirSizes, [dir]: bytes } } : {}))
        const cur = await get($)
        if (cur.showSize && inside(cur.root, dir) && !(dir in cur.dirSizes) && !sizeQueue.includes(dir)) sizeQueue.push(dir)
      })
      .catch(() => undefined)
      .finally(() => {
        sizing.delete(dir)
        sizeActive -= 1
        pumpSizes($)
      })
  }
}

function wantSizes($: EngineInterface, dirs: string[]): void {
  for (const dir of dirs) if (!sizing.has(dir) && !sizeQueue.includes(dir)) sizeQueue.push(dir)
  pumpSizes($)
}

async function staleSizes($: EngineInterface, paths?: string[]): Promise<void> {
  sizeEpoch += 1
  sizeQueue = []
  await patch($, cur => {
    if (!paths) return { dirSizes: {} }
    const keep: Record<string, number> = {}
    for (const [dir, bytes] of Object.entries(cur.dirSizes)) if (!paths.some(p => inside(dir, p))) keep[dir] = bytes
    return { dirSizes: keep }
  })
}

function openDirs(t: FileTree): string[] {
  const open = new Set(t.expanded)
  return t.nodes.filter(n => n.kind === 'dir' && n.loaded && open.has(n.id)).map(n => n.id)
}

function keepTop(cur: FileTree, expanded: string[]): Partial<FileTree> {
  if (followClaude) return { scroll: null }
  const top = visibleRows(cur)[cur.scroll ?? view.from]?.node.id
  const at = top ? visibleRows({ ...cur, expanded }).findIndex(r => r.node.id === top) : -1
  return at < 0 ? {} : { scroll: at }
}

async function flash($: EngineInterface, tones: Record<string, string>): Promise<void> {
  const unique = Object.keys(tones)
  if (unique.length === 0) return
  const mine = ++generation
  const root = (await get($)).root
  blink?.cancel()
  blink = null
  await patch($, cur => {
    if (cur.root !== root) return {}
    const open = new Set(cur.expanded)
    const bright = new Set([...(cur.flashOn ? cur.flash.filter(id => !unique.includes(id)) : []), ...unique])
    const dim = new Set<string>()
    const all: Record<string, string> = cur.flashOn ? { ...cur.flashTones } : {}
    if (cur.flashOn) {
      for (const id of cur.flashDim) dim.add(id)
    }
    for (const id of unique) {
      const tone = tones[id] ?? 'orange'
      all[id] = tone
      if (id === BRANCH_ROW) continue
      const chain = ancestorsOf(id, cur.root)
      if (!chain.some(a => !open.has(a))) continue
      for (const a of chain) {
        if (!open.has(a)) {
          dim.add(a)
          all[a] = all[a] ?? tone
        }
        open.add(a)
      }
    }
    for (const id of bright) dim.delete(id)
    return {
      flash: [...bright],
      flashDim: [...dim],
      flashOn: true,
      flashTones: all,
      expanded: [...open],
      ...keepTop(cur, [...open]),
    }
  })
  if (generation !== mine) return
  blink = $.clock.after(FLASH_MS, () => {
    if (generation !== mine) return
    blink = null
    void patch($, cur => (generation === mine ? { flash: [], flashDim: [], flashOn: false, flashTones: {} } : {}))
  })
}

async function followCwd($: EngineInterface): Promise<boolean> {
  if (!follow) return false
  const cwd = await cwdOf($)
  const t = await get($)
  if (t.root === cwd) return false
  await reset($, cwd)
  return true
}

type Pending = { actions: GitAction[]; ids: number[]; command: string; head: string }
type Job = { actions: GitAction[]; since: Since; initRepo: boolean; readOnly: boolean }
type Background = { p: Pending | null; job: Job; reads: string[] }
type GitOperation = NonNullable<BuiltinToolResults['Bash']['gitOperation']>
type Outcome = { state: 'done' | 'failed'; label: string; detail: string }

const PROOF: Record<string, (op: GitOperation) => boolean> = {
  push: op => Boolean(op.push),
  merge: op => op.branch?.action === 'merged',
  rebase: op => op.branch?.action === 'rebased',
  'pr create': op => op.pr?.action === 'created',
  'pr merge': op => op.pr?.action === 'merged',
  'pr comment': op => op.pr?.action === 'commented',
}

async function startGit($: EngineInterface, actions: GitAction[]): Promise<number[]> {
  const now = await $.clock.now()
  const ids = actions.map(() => ++activityId)
  await setActivities($, cur => [
    ...cur.filter(a => a.state === 'running' || now - a.at < ACTIVITY_TTL_MS),
    ...actions.map((a, i) => ({
      id: ids[i] ?? 0,
      kind: a.kind,
      label: a.running,
      state: 'running' as const,
      detail: '',
      at: now,
      tone: a.tone,
      nerd: a.icon.nerd,
      plain: a.icon.plain,
    })),
  ])
  return ids
}

async function headOf($: EngineInterface, cwd: string): Promise<string> {
  try {
    const run = await git($, cwd, ['rev-parse', 'HEAD'], 5_000)
    return run.exitCode === 0 ? run.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function outcomes($: EngineInterface, p: Pending, ok: boolean, op: GitOperation | undefined): Promise<Outcome[]> {
  const chain = chainOf(p.command)
  const after = p.actions.some(a => a.verb === 'commit') && !op?.commit ? await headOf($, (await get($)).root || (await cwdOf($))) : ''
  return p.actions.map(a => {
    if (a.verb === 'commit') {
      const sha = op?.commit?.sha || (after && after !== p.head ? after : '')
      return sha ? { state: 'done', label: a.done, detail: sha.slice(0, 7) } : { state: 'failed', label: `${a.verb} failed`, detail: '' }
    }
    if ((op && PROOF[a.verb]?.(op)) || (ok && chain.and)) return { state: 'done', label: a.done, detail: '' }
    if (!ok && chain.and && chain.size === 1) return { state: 'failed', label: `${a.verb} failed`, detail: '' }
    return { state: 'done', label: `ran ${a.kind}`, detail: '' }
  })
}

async function finishGit($: EngineInterface, p: Pending, results: Outcome[]): Promise<void> {
  const now = await $.clock.now()
  await setActivities($, cur =>
    cur.map(a => {
      const i = p.ids.indexOf(a.id)
      const result = i < 0 ? undefined : results[i]
      return result ? { ...a, ...result, at: now } : a
    }),
  )
  $.clock.after(ACTIVITY_TTL_MS + 500, () => void setActivities($, cur => cur.filter(a => a.state === 'running' || a.at > now)))
}

function failAll(p: Pending): Outcome[] {
  return p.actions.map(a => ({ state: 'failed', label: `${a.verb} failed`, detail: '' }))
}

function proven(p: Pending | null, results: Outcome[]): GitAction[] {
  return p ? p.actions.filter((_, i) => results[i]?.state !== 'failed') : []
}

function taskEnds(text: string): [string, string][] {
  return [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].flatMap(m => {
    const id = /<task-id>([^<]*)<\/task-id>/.exec(m[1] ?? '')?.[1]?.trim()
    const status = /<status>([^<]*)<\/status>/.exec(m[1] ?? '')?.[1]?.trim()
    return id && status ? [[id, status] as [string, string]] : []
  })
}

async function settleBackground($: EngineInterface, text: string): Promise<void> {
  if (background.size === 0 || !text.includes('<task-notification>')) return
  for (const [id, status] of taskEnds(text)) {
    const task = background.get(id)
    if (!task) continue
    background.delete(id)
    const ok = status === 'completed'
    const results = task.p ? await outcomes($, task.p, ok, undefined) : []
    if (task.p) await finishGit($, task.p, results)
    if (showReads) queuedReads.push(...task.reads)
    scheduleScan($, { ...task.job, actions: proven(task.p, results) })
  }
}

async function gitPaths($: EngineInterface, root: string, prefix: string, committed: boolean): Promise<string[]> {
  const map = mapper(root, prefix)
  try {
    const run = committed
      ? await git($, root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'], 5_000)
      : await git($, root, ['diff', '--cached', '--name-only', '-z'], 5_000)
    return run.exitCode === 0 ? run.stdout.split('\0').filter(Boolean).flatMap(rel => map(rel) ?? []) : []
  } catch {
    return []
  }
}

async function gitDir($: EngineInterface, cwd: string): Promise<string> {
  for (let dir = cwd, i = 0; i < 64; i++) {
    try {
      const dot = join(dir, '.git')
      const st = await $.fs.stat(dot)
      if (st.kind === 'dir') return dot
      const ref = /^gitdir:\s*(.+)$/m.exec(String(await $.fs.read(dot)))?.[1]?.trim()
      if (ref) return resolve(dir, ref, home)
    } catch {
      const up = dirname(dir)
      if (up === dir) return ''
      dir = up
      continue
    }
    return ''
  }
  return ''
}

async function sync($: EngineInterface, force = false): Promise<void> {
  const now = await $.clock.now()
  if (!force && now - lastSync < 2_000) return
  lastSync = now
  searchIndex = null
  const t = await get($)
  if (!t.root) return
  await loadDirs($, [t.root, ...openDirs(t)])
  if (t.top) await refreshGit($)
}

async function copyPath($: EngineInterface, id: string, absolute: boolean, surface?: string): Promise<void> {
  const t = await get($)
  const text = !absolute && id !== t.root && inside(t.root, id) ? id.slice(t.root.endsWith('/') ? t.root.length : t.root.length + 1) : id
  const done = await $.ui.copy({ text, ...(surface ? { surface: surface as 'terminal' } : {}) })
  $.ui.toast(done.isCopied ? `Copied ${text}` : 'Could not copy the path')
}

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function afterBash($: EngineInterface, jobs: Job[]): Promise<void> {
  const reads = queuedReads
  queuedReads = []
  if (await followCwd($)) return
  const t = await get($)
  if (!t.root) return
  const actions = jobs.flatMap(j => j.actions)
  const writers = jobs.filter(j => !j.readOnly)
  const since = (writers.length ? writers : jobs).reduce((a, j) => (j.since.ms < a.ms ? j.since : a), (writers[0] ?? jobs[0])?.since ?? { ms: 0, mark: '', os: 'linux' as const })
  const writes = !jobs.every(j => j.readOnly)
  const before = dirty.root === t.root ? dirty.files : {}
  if (jobs.some(j => j.initRepo)) await detectRepo($)
  else if (!t.top && (await exists($, join(t.root, '.git')))) await detectRepo($)
  const probed = await get($)
  if (probed.top && (writes || probed.top !== t.top)) await refreshGit($)
  if (writes) {
    searchIndex = null
    await staleSizes($)
  }
  const fresh = await get($)
  const ignored = new Set(fresh.ignored)
  const tones: Record<string, string> = {}
  if (writes) {
    const found = fresh.top
      ? await changedInRepo($, t.root, since, before, fresh.ignored)
      : { hits: since.os === 'win32' ? [] : await changedSince($, t.root, since, NO_REPO_DEPTH), gone: [] }
    const hits = found.hits.filter(x => inside(t.root, x) && !underAny(x, ignored, t.root)).slice(0, FIND_LIMIT)
    await revealPaths($, hits)
    const loaded = await get($)
    const dirs = [...new Set([loaded.root, ...openDirs(loaded), ...hits.map(dirname), ...found.gone.map(dirname)])].filter(d => inside(loaded.root, d))
    const listed = await loadDirs($, dirs)
    if (!fresh.top && since.os === 'win32')
      for (const kids of listed.values()) for (const n of kids) if (n.mtime > since.ms && hits.length < FIND_LIMIT) hits.push(n.id)
    await patch($, cur => {
      const ids = new Set(cur.nodes.map(n => n.id))
      return { expanded: cur.expanded.filter(id => ids.has(id)) }
    })
    const present = new Set((await get($)).nodes.map(n => n.id))
    const touchTone = actions.find(a => !['commit', 'push', 'add'].includes(a.verb))?.tone ?? 'orange'
    if (showWrites) for (const id of hits) if (present.has(id)) tones[id] = touchTone
  }
  if (showReads) {
    const found: string[] = []
    for (const r of reads) {
      if (found.length >= READ_REVEAL_LIMIT) break
      if (r !== t.root && inside(t.root, r) && !underAny(r, ignored, t.root) && (await exists($, r))) found.push(r)
    }
    if (found.length) {
      await revealPaths($, found)
      const shown = new Set((await get($)).nodes.map(n => n.id))
      for (const r of found) if (shown.has(r) && !tones[r]) tones[r] = 'purple'
    }
  }
  if (showWrites && actions.length) {
    const final = await get($)
    const committed = actions.some(a => a.verb === 'commit')
    if ((committed || actions.some(a => a.verb === 'add')) && final.top) {
      const paths = (await gitPaths($, final.root, final.prefix, committed)).filter(x => !underAny(x, ignored, final.root)).slice(0, READ_REVEAL_LIMIT)
      await revealPaths($, paths)
      const shown = new Set((await get($)).nodes.map(n => n.id))
      for (const x of paths) if (shown.has(x)) tones[x] = 'green'
    }
    const pushLike = actions.find(a => ['push', 'pull', 'fetch', 'checkout', 'switch', 'branch', 'merge', 'rebase', 'tag'].includes(a.verb) || a.kind.startsWith('gh '))
    if (pushLike) tones[BRANCH_ROW] = pushLike.tone
    else if (committed) tones[BRANCH_ROW] = 'green'
  }
  await flash($, tones)
}

function scheduleScan($: EngineInterface, job: Job): void {
  scanJobs.push(job)
  if (scanning) return
  scanning = (async () => {
    while (scanJobs.length) {
      const jobs = scanJobs
      scanJobs = []
      try {
        await afterBash($, jobs)
      } finally {
        const marks = jobs.map(j => j.since.mark).filter(Boolean)
        if (marks.length) await $.process.run(['rm', '-f', ...marks], { timeoutMs: 3_000 }).catch(() => undefined)
      }
    }
  })().finally(() => {
    scanning = null
  })
}

async function touched($: EngineInterface, paths: string[], tone: string, show: boolean): Promise<void> {
  if (tone !== 'purple' && previewed && paths.map(posix).includes(previewed.path)) previewed = null
  if (await followCwd($)) return
  const t = await get($)
  if (!t.root) return
  const within = paths.map(posix).filter(p => inside(t.root, p))
  if (within.length === 0) return
  if (tone !== 'purple') {
    searchIndex = null
    await staleSizes($, within)
    await revealPaths($, within.map(dirname))
    await loadDirs($, [...new Set(within.map(dirname))].filter(d => inside(t.root, d)))
    await refreshGit($)
  } else await revealPaths($, within)
  if (!show) return
  const tones: Record<string, string> = {}
  for (const p of within) tones[p] = tone
  await flash($, tones)
}

async function reveal($: EngineInterface, paths: string[]): Promise<void> {
  if (await followCwd($)) return
  await revealPaths($, paths)
  await patch($, cur => {
    const open = new Set(cur.expanded)
    for (const p of paths) for (const a of ancestorsOf(p, cur.root)) open.add(a)
    return { expanded: [...open], cursor: paths[paths.length - 1] ?? cur.cursor, scroll: null }
  })
}

async function walk($: EngineInterface, root: string, depth: number, limit: number): Promise<string[]> {
  const out: string[] = []
  let level = [root]
  for (let d = 0; d < depth && level.length && out.length < limit; d++) {
    const next: string[] = []
    for (const dir of level) {
      for (const n of (await list($, dir)) ?? []) {
        if (n.kind === 'dir') {
          if (!PRUNE.includes(n.name)) next.push(n.id)
        } else out.push(n.id)
      }
      if (out.length >= limit) break
    }
    level = next
  }
  return out
}

async function listAll($: EngineInterface, t: FileTree): Promise<string[] | null> {
  try {
    if (!t.top && (await osName($)) === 'win32') return await walk($, t.root, rootOfDisk(t.root) ? 3 : 6, 20_000)
    const run = t.top
      ? await git($, t.root, ['ls-files', '-co', '--exclude-standard', '-z'], 10_000)
      : await $.process.run(['find', '-H', t.root, '-xdev', '-maxdepth', rootOfDisk(t.root) ? '3' : '6', ...pruneArgs(t.root), '-type', 'f', '-print0'], { timeoutMs: 10_000 })
    if (t.top && run.exitCode !== 0) return null
    const paths = run.stdout.split('\0').filter(Boolean)
    if (run.isStdoutTruncated) paths.pop()
    return paths.map(p => (isAbsolute(p) ? p : join(t.root, p)))
  } catch {
    return null
  }
}

function indexPaths($: EngineInterface, t: FileTree): Promise<string[]> {
  if (searchIndex?.root !== t.root) {
    const index: { root: string; paths: Promise<string[]> } = {
      root: t.root,
      paths: listAll($, t).then(paths => {
        if (paths === null && searchIndex === index) searchIndex = null
        return paths ?? []
      }),
    }
    searchIndex = index
  }
  return searchIndex.paths
}

async function search($: EngineInterface, query: string): Promise<string[]> {
  if (!(await get($)).query.trim()) searchIndex = null
  await patch($, () => ({ query }))
  const q = query.trim().toLowerCase()
  if (!q) return []
  const t = await get($)
  const hits = (await indexPaths($, t)).filter(p => relative(t.root, p).toLowerCase().includes(q)).slice(0, SEARCH_REVEAL_LIMIT)
  if ((await get($)).query !== query) return []
  await revealPaths($, hits)
  const shown = await get($)
  const ids = new Set(shown.nodes.map(n => n.id))
  const stale = [...new Set(hits.filter(p => !ids.has(p)).map(dirname))].filter(d => inside(shown.root, d))
  if (stale.length) await loadDirs($, stale)
  return hits
}

async function jump($: EngineInterface, query: string): Promise<void> {
  const hits = (await search($, query)).slice(0, 10)
  await patch($, cur => {
    const open = new Set(cur.expanded)
    for (const p of hits) for (const a of ancestorsOf(p, cur.root)) open.add(a)
    return { query: '', expanded: [...open], cursor: hits[0] ?? cur.cursor, scroll: null }
  })
}

async function fontState($: EngineInterface, charset: string): Promise<'ok' | 'stale' | 'missing'> {
  try {
    const out = (await $.process.run(['sh', '-c', FONT_SCRIPT, 'sh', charset], { timeoutMs: 5_000 })).stdout.trim()
    return out === 'stale' || out === 'missing' ? out : 'ok'
  } catch {
    return 'missing'
  }
}

async function finePointerOk($: EngineInterface): Promise<boolean> {
  if (!(await $.env.get('HERDR_ENV'))) return true
  try {
    const out = (await $.process.run([(await $.env.get('HERDR_BIN_PATH')) || 'herdr', '--version'], { timeoutMs: 3_000 })).stdout
    const [major = 0, minor = 0, fix = 0] = (/(\d+)\.(\d+)\.(\d+)/.exec(out) ?? []).slice(1).map(Number)
    return major * 1e6 + minor * 1e3 + fix >= 9_001
  } catch {
    return false
  }
}

const PREVIEW_CHARS = 90_000
const PREVIEW_LINE = 2_000

function fitSerialized(lines: string[], max: number): string[] {
  let size = 0
  for (let i = 0; i < lines.length; i++) {
    size += JSON.stringify(lines[i]).length
    if (size > max) return lines.slice(0, i)
  }
  return lines
}

async function loadPreview($: EngineInterface, path: string): Promise<void> {
  let text = ''
  let note = ''
  try {
    const stat = await $.fs.stat(path)
    if (stat.size > 4_000_000) note = `${formatSize(stat.size)}, too large to preview`
    else {
      text = await $.fs.read(path)
      if (text.slice(0, 8000).includes('\0')) {
        text = ''
        note = `binary file, ${formatSize(stat.size)}`
      }
    }
  } catch (err) {
    note = `could not read: ${String((err as Error)?.message ?? err).split('\n')[0]}`
  }
  const total = text.length
  let lines = text.slice(0, PREVIEW_CHARS).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split('\n')
  if (total > PREVIEW_CHARS && lines.length > 1) lines.pop()
  lines = lines.map(l => (l.length > PREVIEW_LINE ? `${l.slice(0, PREVIEW_LINE)}…` : l))
  const fit = fitSerialized(lines, PREVIEW_CHARS)
  if (total > PREVIEW_CHARS || fit.length < lines.length) note = `first ${fit.length.toLocaleString('en')} lines of ${total.toLocaleString('en')} characters`
  previewed = { path, text: fit.join('\n'), note }
}

async function showPreview($: EngineInterface, path: string): Promise<void> {
  await loadPreview($, path)
  await patch($, () => ({ preview: path, previewTop: 0, selected: path }))
}

async function closePreview($: EngineInterface): Promise<void> {
  await patch($, () => ({ preview: '', previewTop: 0 }))
}

async function scrollPreview($: EngineInterface, by: number): Promise<void> {
  const t = await get($)
  const last = Math.max(0, (previewed?.text.split('\n').length ?? 1) - previewRows)
  const top = Math.max(0, Math.min(last, t.previewTop + by))
  if (top !== t.previewTop) await patch($, () => ({ previewTop: top }))
}

function previewLines(text: string, top: number, rows: number, markdown: boolean): { text: string; top: number } {
  const lines = text.split('\n')
  const from = Math.max(0, Math.min(top, lines.length - 1))
  let shown = lines.slice(from, from + rows)
  if (markdown) {
    // Reopen a code fence the window starts inside, so the rest is not read as prose.
    let fence = ''
    let opener = ''
    for (const line of lines.slice(0, from)) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (!m) continue
      const mark = m[1] ?? ''
      if (!fence) {
        fence = mark
        opener = line.trimStart()
      } else if (mark[0] === fence[0] && mark.length >= fence.length && !(m[2] ?? '').trim()) fence = ''
    }
    if (fence) shown = [opener, ...shown]
  }
  return { text: shown.join('\n'), top: from }
}

async function openFile($: EngineInterface, path: string, external = false): Promise<void> {
  if (!external && openWithSetting.trim() === 'preview') return showPreview($, path)
  const os = await osName($)
  const native = (p: string) => (os === 'win32' ? p.replace(/\//g, '\\') : p)
  const custom = external ? null : openWithCommand(openWithSetting, native(path), native(dirname(path)))
  const { argv, init } = custom ? { argv: os === 'linux' ? ['sh', '-c', LINUX_LAUNCH, 'sh', ...custom] : custom, init: { timeoutMs: 10_000 } } : openCommand(os, path)
  try {
    const run = await $.process.run(argv, init)
    if (run.exitCode !== 0) $.ui.toast(`could not open ${path} with ${custom?.[0] ?? argv[0]}: ${run.stderr.trim().split('\n')[0] || `exit ${run.exitCode}`}`)
  } catch {
    $.ui.toast(`could not open ${path} with ${custom?.[0] ?? argv[0]}`)
  }
}

async function quickLook($: EngineInterface, path: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', '(nohup qlmanage -p "$1" >/dev/null 2>&1 &); sleep 0.4; osascript -e \'tell application "System Events" to set frontmost of first process whose name is "qlmanage" to true\' >/dev/null 2>&1 || true', 'sh', path], { timeoutMs: 10_000 })
  } catch {
    $.ui.toast(`could not preview ${path} with Quick Look`)
  }
}

async function toggle($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir' && !(await get($)).expanded.includes(n.id)) await loadDirs($, [n.id])
  await patch($, t => {
    const open = new Set(t.expanded)
    if (n.kind === 'dir') open.has(n.id) ? open.delete(n.id) : open.add(n.id)
    return { expanded: [...open], cursor: n.id, selected: n.kind === 'dir' ? t.selected : n.id }
  })
}

async function press($: EngineInterface, n: FileNode): Promise<void> {
  const now = await $.clock.now()
  const isDouble = lastPress.key === n.id && now - lastPress.at < DOUBLE_MS
  lastPress = { key: isDouble ? '' : n.id, at: now }
  if (!isDouble) {
    await toggle($, n)
    return
  }
  await openNode($, n)
}

async function openNode($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir') {
    follow = false
    await reset($, n.id)
  } else await openFile($, n.id)
}

async function loadTheme($: EngineInterface): Promise<void> {
  const path = `${(await $.env.get('HOME')) ?? ''}/${THEME_FILE}`
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') throw new Error('no theme file')
    if (stat.mtimeMs === themeMtime) return
    await $.state.set(THEME, parseTheme(String(await $.fs.read(path))))
    themeMtime = stat.mtimeMs
  } catch {
    if (themeMtime === 0) return
    await $.state.set(THEME, DEFAULT_THEME)
    themeMtime = 0
  }
}

async function pressHeader($: EngineInterface, id: string): Promise<void> {
  const t = await get($)
  if (id === 'up') {
    follow = false
    await reset($, dirname(t.root))
  } else if (id === 'cwd') {
    follow = true
    await reset($, await cwdOf($))
  } else if (id === 'refresh') {
    searchIndex = null
    await staleSizes($)
    await loadDirs($, [t.root, ...t.expanded])
    await detectRepo($)
    await refreshGit($)
    if (t.query.trim()) await search($, t.query)
  } else if (id === 'hidden') await setHidden($, !t.showHidden)
  else if (id === 'size') await patch($, cur => ({ showSize: !cur.showSize }))
  else if (id === 'collapse') await patch($, cur => ({ expanded: [], nodes: dropBelow(cur.nodes, cur.nodes.filter(x => x.parent === cur.root && x.kind === 'dir').map(x => x.id)) }))
  else if (id === 'unselect') await patch($, () => ({ selected: '' }))
  else if (id === 'external' && t.preview) await openFile($, t.preview, true)
  else if (id === 'back') {
    // The button is gone once pressed, so no leave arrives for it.
    hovered = ''
    await closePreview($)
  } else if (id === 'clear') {
    hovered = ''
    await search($, '')
  }
}

function shortPath(path: string): string {
  return home && inside(home, path) ? `~${path.slice(home.length)}` : path
}

type Words = { en: string; pt: string }
type Field = { field: string; section: 'pane' | 'tree' | 'claude'; label: Words; help: Words; options?: string[]; toggle?: true; fallback: string }

// One row per `userConfig` field in plugin.json. A field whose options are on and off is a
// toggle; the others are a choice, or a text field for Open with.
const FIELDS: Field[] = [
  {
    field: 'start',
    section: 'pane',
    label: { en: 'Open at start', pt: 'Abrir ao iniciar' },
    help: { en: 'Opens the pane when a session starts; off keeps it closed until you open it here', pt: 'Abre o painel quando uma sessão começa; desligado, ele fica fechado até você abri-lo aqui' },
    options: ['on', 'off'],
    toggle: true,
    fallback: 'on',
  },
  {
    field: 'open',
    section: 'pane',
    label: { en: 'Open with', pt: 'Abrir com' },
    help: {
      en: 'What a double-click or Enter does with a file. Empty: the default app; preview: show it in the pane; anything else: a command, {path} the file and {dir} its folder',
      pt: 'O que um duplo clique ou Enter faz com um arquivo. Vazio: o app padrão; preview: mostra no painel; qualquer outra coisa: um comando, {path} o arquivo e {dir} a pasta',
    },
    fallback: '',
  },
  {
    field: 'column',
    section: 'tree',
    label: { en: 'Right column', pt: 'Coluna da direita' },
    help: { en: 'What it shows by default: the date last modified, the age since then, or the size. The Sizes button switches', pt: 'O que ela mostra por padrão: a data da última modificação, a idade desde então ou o tamanho. O botão Sizes alterna' },
    options: ['date', 'age', 'size'],
    fallback: 'date',
  },
  {
    field: 'glyphs',
    section: 'tree',
    label: { en: 'Icons', pt: 'Ícones' },
    help: { en: 'auto uses Nerd Font icons in a terminal that has one; plain uses Unicode only; nerd always uses Nerd Font', pt: 'auto usa ícones Nerd Font num terminal que tenha uma; plain usa só Unicode; nerd sempre usa Nerd Font' },
    options: ['auto', 'nerd', 'plain'],
    fallback: 'auto',
  },
  {
    field: 'hints',
    section: 'tree',
    label: { en: 'No-repo hint', pt: 'Aviso sem repositório' },
    help: { en: 'Outside a git repo, a line under the header says git status starts after git init', pt: 'Fora de um repositório git, uma linha sob o cabeçalho diz que o status do git começa após git init' },
    options: ['on', 'off'],
    toggle: true,
    fallback: 'on',
  },
  {
    field: 'activity',
    section: 'claude',
    label: { en: 'Show activity', pt: 'Mostrar atividade' },
    help: { en: 'Which of Claude’s file activity glows in the tree: reads, writes in the accent, git in green', pt: 'Qual atividade do Claude nos arquivos brilha na árvore: leituras, escritas na cor de destaque, git em verde' },
    options: ['reads and writes', 'writes', 'reads', 'none'],
    fallback: 'reads and writes',
  },
  {
    field: 'follow',
    section: 'claude',
    label: { en: 'Follow Claude', pt: 'Seguir o Claude' },
    help: { en: 'Scrolls the tree to what Claude reads, writes or commits; off, only your own scrolling moves it', pt: 'Rola a árvore até o que o Claude lê, escreve ou commita; desligado, só a sua rolagem a move' },
    options: ['on', 'off'],
    toggle: true,
    fallback: 'on',
  },
]

const say = (lang: FiletreeLang, words: Words) => words[lang]

async function paneIsOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE)
  } catch {
    return false
  }
}

async function configValues($: EngineInterface): Promise<Record<string, string>> {
  const values: Record<string, string> = {}
  let rows: Awaited<ReturnType<EngineInterface['config']['list']>> = []
  try {
    rows = await $.config.list()
  } catch {
    rows = []
  }
  for (const spec of FIELDS) {
    const row = rows.find(r => r.key === `filetree.${spec.field}`)
    values[spec.field] = row && typeof row.value === 'string' ? row.value : spec.fallback
  }
  return values
}

function fieldItem(lang: FiletreeLang, spec: Field, value: string): FiletreeItem {
  const id = `config:${spec.field}`
  const label = say(lang, spec.label)
  const help = say(lang, spec.help)
  if (spec.toggle) return { kind: 'toggle', id, label, help, value: value !== 'off' }
  if (spec.options) return { kind: 'choice', id, label, help, value, options: spec.options.map(option => ({ value: option, label: option })) }
  return {
    kind: 'input',
    id,
    label,
    help: `${say(lang, { en: 'Now', pt: 'Agora' })}: ${value || say(lang, { en: 'the default app', pt: 'o app padrão' })}. ${help}`,
    placeholder: 'preview',
    submitLabel: say(lang, { en: 'Save', pt: 'Salvar' }),
  }
}

// `$.filetree.panel`: the Files tab of the /mods hub.
async function panelOf($: EngineInterface, args: FiletreePanelArgs): Promise<FiletreePanel> {
  const lang: FiletreeLang = args?.lang === 'pt' ? 'pt' : 'en'
  hubLang = lang
  await pullSettings($)
  const t = await get($)
  const root = t.root || (await cwdOf($))
  const isOpen = await paneIsOpen($)
  const branch = t.branch?.head ?? ''
  const summary = [isOpen ? say(lang, { en: 'open', pt: 'aberto' }) : say(lang, { en: 'closed', pt: 'fechado' }), shortPath(root), branch].filter(Boolean).join(' · ')

  const pane: FiletreeItem[] = [
    isOpen
      ? {
          kind: 'action',
          id: 'close',
          label: say(lang, { en: 'Close', pt: 'Fechar' }),
          help: say(lang, { en: 'Closes the pane; it stays closed until you open it again', pt: 'Fecha o painel; ele fica fechado até você abri-lo de novo' }),
          scope: 'session',
        }
      : {
          kind: 'action',
          id: 'open',
          label: say(lang, { en: 'Open', pt: 'Abrir' }),
          help: say(lang, { en: 'Opens the pane on the working folder, which it follows, and gives it the keyboard', pt: 'Abre o painel na pasta de trabalho, que ele acompanha, e passa o teclado para ele' }),
          primary: true,
          scope: 'session',
        },
    {
      kind: 'input',
      id: 'folder',
      label: say(lang, { en: 'Folder', pt: 'Pasta' }),
      help: `${say(lang, { en: 'Now', pt: 'Agora' })}: ${shortPath(root)}${follow ? say(lang, { en: ', following the working folder', pt: ', acompanhando a pasta de trabalho' }) : ''}. ${say(lang, {
        en: 'Shows another folder, absolute or relative to the working folder, until you open the pane again',
        pt: 'Mostra outra pasta, absoluta ou relativa à pasta de trabalho, até você abrir o painel de novo',
      })}`,
      placeholder: '~/projects/app',
      submitLabel: say(lang, { en: 'Show', pt: 'Mostrar' }),
      scope: 'session',
    },
  ]
  if (isOpen)
    pane.push({
      kind: 'action',
      id: 'open',
      label: say(lang, { en: 'Focus', pt: 'Focar' }),
      help: say(lang, { en: 'Back to the working folder, and the keyboard to the tree', pt: 'Volta à pasta de trabalho e passa o teclado para a árvore' }),
      scope: 'session',
    })

  const values = await configValues($)
  const of = (section: Field['section']) => FIELDS.filter(spec => spec.section === section).map(spec => fieldItem(lang, spec, values[spec.field] ?? spec.fallback))
  const hidden: FiletreeItem = {
    kind: 'toggle',
    id: 'hidden',
    label: say(lang, { en: 'Hidden files', pt: 'Arquivos ocultos' }),
    help: say(lang, { en: 'Shows dotfiles in the tree; the Hidden button switches it too', pt: 'Mostra os dotfiles na árvore; o botão Hidden também alterna' }),
    value: t.showHidden,
  }

  return {
    title: say(lang, { en: 'Files', pt: 'Arquivos' }),
    summary,
    tone: isOpen ? 'ok' : 'muted',
    sections: [
      { id: 'pane', title: say(lang, { en: 'Pane', pt: 'Painel' }), items: [...pane, ...of('pane')] },
      { id: 'tree', title: say(lang, { en: 'Tree', pt: 'Árvore' }), items: [hidden, ...of('tree')] },
      { id: 'claude', title: say(lang, { en: 'Claude’s activity', pt: 'Atividade do Claude' }), items: of('claude') },
    ],
  }
}

const NEEDS_FULLSCREEN: Words = {
  en: 'The file tree shows in the sidebar, which needs the fullscreen layout. Run /tui fullscreen, then open it from /mods.',
  pt: 'A árvore de arquivos aparece na barra lateral, que precisa do layout de tela cheia. Rode /tui fullscreen e abra-a pelo /mods.',
}

// Opens or focuses the pane on the cwd (followed), or pinned on `path`.
async function openTree($: EngineInterface, path: string): Promise<FiletreeActResult> {
  if (inlineLayout) return { message: say(hubLang, NEEDS_FULLSCREEN) }
  noDock = false
  const arg = path.trim()
  const cwd = await cwdOf($)
  follow = !arg
  const root = arg ? resolve(cwd, arg, home) : cwd
  await reset($, root, true)
  return inlineLayout ? { message: say(hubLang, NEEDS_FULLSCREEN) } : {}
}

// `$.filetree.act`: a press in the Files tab. A message only when it failed.
async function actOn($: EngineInterface, args: FiletreeActArgs): Promise<FiletreeActResult> {
  const lang = hubLang
  const id = typeof args?.id === 'string' ? args.id : ''
  const value = typeof args?.value === 'string' ? args.value : ''
  if (id === 'open' || id === 'folder') return openTree($, value)
  if (id === 'close') {
    noDock = true
    try {
      await $.ui.close({ id: PANE })
    } catch (err) {
      return { message: `${say(lang, { en: 'The file tree did not close', pt: 'A árvore de arquivos não fechou' })}: ${err instanceof Error ? err.message : String(err)}` }
    }
    return {}
  }
  if (id === 'hidden') {
    await setHidden($, value === 'on')
    return {}
  }
  const spec = id.startsWith('config:') ? FIELDS.find(f => f.field === id.slice('config:'.length)) : undefined
  if (spec) {
    if (spec.options && !spec.options.includes(value)) {
      return { message: say(lang, { en: `${value || '(empty)'} is not an option for ${spec.label.en}`, pt: `${value || '(vazio)'} não é uma opção de ${spec.label.pt}` }) }
    }
    const failed = say(lang, { en: `${spec.label.en} did not change`, pt: `${spec.label.pt} não mudou` })
    try {
      const result = await $.config.set({ key: `filetree.${spec.field}`, value: spec.options ? value : value.trim() })
      if (result.deny) return { message: `${failed}: ${result.deny}` }
    } catch (err) {
      return { message: `${failed}: ${err instanceof Error ? err.message : String(err)}` }
    }
    return {}
  }
  return { message: say(lang, { en: `Unknown action: ${id}`, pt: `Ação desconhecida: ${id}` }) }
}

// `$.filetree.catalog`: every piece of the pane, named, for the Components tab of /mods.
async function catalog($: EngineInterface, args: FiletreePanelArgs): Promise<FiletreeCatalogEntry[]> {
  const surface = args?.surface ?? 'terminal'
  const theme: Theme = (await $.state.get(THEME)).value ?? DEFAULT_THEME
  const els = $.ui.resolve({ surface, component: 'Pane' })
  return catalogOf(els, { ...args, surface }, { unicode: unicodeOn(surface), theme, now: await $.clock.now() })
}

export const register: Register = (on, options) => {
  glyphSetting = typeof options?.glyphs === 'string' ? options.glyphs : 'auto'
  const activity = typeof options?.activity === 'string' ? options.activity : 'reads and writes'
  showReads = activity.includes('reads')
  showWrites = activity.includes('writes')
  followClaude = options?.follow !== 'off'
  sizeDefault = options?.column === 'size'
  showAge = options?.column === 'age'
  showHints = options?.hints !== 'off'
  openWithSetting = typeof options?.open === 'string' ? options.open : ''
  noDock = options?.start === 'off'
  // Adds `$.filetree` for the /mods hub; a call is the event the hooks below answer.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    return { ...built, filetree: { panel: async () => ({ title: '', sections: [] }), act: async () => ({}), catalog: async () => [] } }
  })

  on('filetree.panel', async ($, e) => ({ value: await panelOf($, e) }))
  on('filetree.act', async ($, e) => ({ value: await actOn($, e) }))
  on('filetree.catalog', async ($, e) => ({ value: await catalog($, e) }))

  on('session.start', async ($, e, next) => {
    const windows = (await $.env.get('OS')) === 'Windows_NT'
    useDrives(windows)
    home = posix(((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/[\\/]+$/, ''))
    activityId = Math.max(activityId, ...(await activities($)).map(a => a.id))
    await pullSettings($)
    storePoll?.cancel()
    storePoll = $.clock.every(STORE_POLL_MS, () => void pullSettings($))
    void (async () => {
      pointer = await finePointerOk($)
      try {
        const remote = Boolean((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY')))
        noNerd = !remote && (windows || (await fontState($, 'f04eb')) !== 'ok')
      } catch {
        noNerd = true
      }
      await loadTheme($)
      themePoll?.cancel()
      themePoll = themeMtime ? $.clock.every(THEME_POLL_MS, () => void loadTheme($)) : null
      ageTick?.cancel()
      ageTick = showAge ? $.clock.every(AGE_TICK_MS, () => $.ui.invalidate('ui.render')) : null
      const t = await get($)
      if (t.flashOn) await patch($, () => ({ flash: [], flashDim: [], flashOn: false, flashTones: {} }))
      if (t.preview) await patch($, () => ({ preview: '', previewTop: 0 }))
      await setActivities($, cur => cur.map(a => (a.state === 'running' ? { ...a, state: 'failed', label: `${a.kind} interrupted` } : a)))
      const cwd = await cwdOf($)
      if (!t.root || t.nodes.length === 0 || (follow && t.root !== cwd)) await reset($, cwd)
      else if (!noDock) await $.ui.open({ id: PANE, title: `Files: ${t.root.split('/').pop() || t.root}` })
    })()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const shell = e.tool === 'Bash' || e.tool === 'PowerShell'
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit' && !shell) return next(e)
    const command = e.tool === 'Bash' || e.tool === 'PowerShell' ? e.command : ''
    const cwd = shell ? await cwdOf($) : ''
    const actions = gitActions(command)
    const quiet = !actions.length && readOnly(command)
    const since = await sinceNow($, shell && !quiet)
    const before = actions.some(a => a.verb === 'commit') ? await get($) : null
    const head = before?.top ? await headOf($, before.root) : ''
    const pending: Pending | null = actions.length ? { actions, ids: await startGit($, actions), command, head } : null
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (err) {
      if (pending) await finishGit($, pending, failAll(pending))
      if (since.mark) void $.process.run(['rm', '-f', since.mark], { timeoutMs: 3_000 }).catch(() => undefined)
      throw err
    }
    if (pending && result.deny) {
      const ids = pending.ids
      void setActivities($, cur => cur.filter(a => !ids.includes(a.id)))
    }
    if (result.deny || (result.isError && !shell)) {
      if (since.mark) void $.process.run(['rm', '-f', since.mark], { timeoutMs: 3_000 }).catch(() => undefined)
      return result
    }
    if (shell) {
      const out: Partial<BuiltinToolResults['Bash']> = !result.isError && result.result && typeof result.result === 'object' ? (result.result as Partial<BuiltinToolResults['Bash']>) : {}
      const reads = showReads ? readTargets(command, cwd, typeof out.stdout === 'string' ? out.stdout : '', home) : []
      const job: Job = { actions: [], since, initRepo: actions.some(a => a.init), readOnly: quiet || result.isReadOnly === true }
      if (out.backgroundTaskId) background.set(out.backgroundTaskId, { p: pending, job, reads })
      else void (async () => {
        const results = pending ? await outcomes($, pending, !result.isError, out.gitOperation) : []
        if (pending) await finishGit($, pending, results)
        queuedReads.push(...reads)
        scheduleScan($, { ...job, actions: proven(pending, results) })
      })()
      if (follow && /(^|[;&|\s])(cd|pushd|popd)(\s|$)/.test(command)) $.clock.after(400, () => void followCwd($))
    } else {
      const file =
        'file_path' in e && typeof e.file_path === 'string'
          ? e.file_path
          : 'notebook_path' in e && typeof e.notebook_path === 'string'
            ? e.notebook_path
            : ''
      if (file) void touched($, [file], 'orange', showWrites)
    }
    return result
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny || result.isError || e.tool !== 'Read' || !showReads) return result
    void touched($, [posix(e.file_path)], 'purple', true)
    return result
  })

  for (const tool of ['Grep', 'Glob'] as const)
    on('tool.call', { tool }, async ($, e, next) => {
      const result = await next(e)
      if (result.deny || result.isError || !showReads) return result
      const names = (result.result as Partial<BuiltinToolResults['Grep']> | undefined)?.filenames
      if (!Array.isArray(names) || names.length === 0) return result
      const cwd = await cwdOf($)
      void touched($, names.slice(0, SEARCH_REVEAL_LIMIT).map(f => resolve(cwd, posix(f), home)), 'purple', true)
      return result
    })

  on('ui.message', async ($, e, next) => {
    if (e.requestId === PANE && e.element.startsWith('button-') && e.data && typeof e.data === 'object') {
      const id = e.element.slice('button-'.length)
      const data = e.data as { over?: unknown; press?: unknown }
      if (data.press) await pressHeader($, id)
      else if (data.over === true || hovered === id) {
        hovered = data.over === true ? id : ''
        void $.ui.invalidate('ui.render')
      }
      return {}
    }
    if (e.requestId !== PANE || e.element !== 'rows' || !e.data || typeof e.data !== 'object') return next(e)
    const data = e.data as { press?: unknown; key?: unknown; ctrl?: unknown; shift?: unknown; scrollTo?: unknown; copy?: unknown }
    void sync($)
    const t = await get($)
    if (typeof data.copy === 'string') {
      await copyPath($, data.copy, Boolean(data.shift), e.surface)
      return {}
    }
    if (typeof data.scrollTo === 'number') {
      const to = Math.round(Math.max(0, Math.min(1, data.scrollTo)) * view.max)
      if (to !== t.scroll) await patch($, () => ({ scroll: to }))
      return {}
    }
    if (typeof data.press === 'string') {
      const n = t.nodes.find(x => x.id === data.press)
      if (!n) return {}
      if (t.scroll === null) await patch($, () => ({ scroll: view.from }))
      if (data.ctrl || data.shift) await openNode($, n)
      else await press($, n)
      return {}
    }
    if (typeof data.key !== 'string') return {}
    if (t.preview) {
      const page = Math.max(1, previewRows - 2)
      const by: Record<string, number> = { up: -1, k: -1, down: 1, j: 1, pageup: -page, pagedown: page, home: -Infinity, end: Infinity }
      if (data.key === 'left' || data.key === 'h') await closePreview($)
      else if (data.key in by) await scrollPreview($, by[data.key] ?? 0)
      return {}
    }
    const rows = visibleRows(t)
    const at = rows.findIndex(r => r.node.id === t.cursor)
    const cur = rows[at]?.node
    const move = (d: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + d))]
      return target ? patch($, () => ({ cursor: target.node.id, scroll: null })) : Promise.resolve()
    }
    if (data.key === 'up' || data.key === 'k') await move(-1)
    else if (data.key === 'down' || data.key === 'j') await move(1)
    else if (data.key === 'pageup') await move(-10)
    else if (data.key === 'pagedown') await move(10)
    else if (data.key === 'home') await move(-rows.length)
    else if (data.key === 'end') await move(rows.length)
    else if (cur && (data.key === 'y' || data.key === 'Y')) await copyPath($, cur.id, data.key === 'Y' || Boolean(data.shift), e.surface)
    else if (cur && (data.key === 'right' || data.key === 'l') && cur.kind === 'dir' && !t.expanded.includes(cur.id)) await toggle($, cur)
    else if (cur && (data.key === 'left' || data.key === 'h')) {
      if (cur.kind === 'dir' && t.expanded.includes(cur.id)) await toggle($, cur)
      else if (cur.parent !== t.root) await patch($, () => ({ cursor: cur.parent }))
    } else if (cur && data.key === 'return') await (cur.kind !== 'dir' ? openNode($, cur) : toggle($, cur))
    else if (cur && (data.key === ' ' || data.key === 'space')) await (cur.kind !== 'dir' && (await osName($)) === 'darwin' ? quickLook($, cur.id) : toggle($, cur))
    return {}
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      void (async () => {
        await loadTheme($)
        const root = follow || !lastRoot ? await cwdOf($) : lastRoot
        const t = await get($)
        if (t.root !== root || t.nodes.length === 0) await reset($, root)
      })()
    }
    const gd = await gitDir($, posix(e.cwd))
    return gd ? { ...result, watchPaths: [...(result.watchPaths ?? []), join(gd, 'index'), join(gd, 'HEAD')] } : result
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    void followCwd($)
    return result
  })

  on('classic.FileChanged', async ($, e, next) => {
    const result = await next(e)
    if (/[\\/]\.git[\\/]|[\\/](index|HEAD)$/.test(e.file_path)) $.clock.after(300, () => void sync($, true))
    return result
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const result = await next(e)
    void sync($)
    return result
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (nativeScroll) return next(e)
    const t = await get($)
    if (t.preview) {
      await scrollPreview($, Math.sign(e.by) * Math.max(3, Math.abs(e.by)))
      return {}
    }
    const to = Math.max(0, Math.min(view.max, (t.scroll ?? view.from) + Math.sign(e.by) * Math.max(3, Math.abs(e.by))))
    if (to !== t.scroll) await patch($, () => ({ scroll: to }))
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    void settleBackground($, e.text)
    if (!(await followCwd($))) void sync($)
    const t = await get($)
    const context = [...(e.context ?? [])]
    if (t.selected && (await exists($, t.selected))) context.push(`The user has this file selected in the file tree; "this" or "it" in the prompt likely refers to it: ${t.selected}`)
    const mentions = [...e.text.matchAll(/@([^\s"'`]+)/g)]
      .map(m => (m[1] ?? '').replace(/[.,;:!?)]+$/, ''))
      .filter(Boolean)
      .map(p => resolve(t.root, p, home))
      .filter(p => inside(t.root, p))
    if (mentions.length) {
      void (async () => {
        const found: string[] = []
        for (const p of mentions) {
          try {
            await $.fs.stat(p)
            found.push(p.replace(/\/$/, ''))
          } catch {
            continue
          }
        }
        if (found.length) await reveal($, found)
      })()
    }
    return next(context.length ? { ...e, context } : e)
  })

  on('prompt.attachment', async ($, e, next) => {
    void settleBackground($, e.text)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.surface === 'terminal' && e.props.placement === 'inline') {
      noDock = true
      inlineLayout = true
      void $.ui.close({ id: PANE }).catch(() => undefined)
      const { Box: Empty } = $.ui.resolve(e)
      return <Empty />
    }
    const unicode = unicodeOn(e.surface)
    const { Box, Text, Input, Client } = $.ui.resolve(e)
    const els = { Box, Text }
    const t = await get($)
    const theme: Theme = (await $.state.get(THEME)).value ?? DEFAULT_THEME
    // The desktop tab never hands the wheel or the scrollbar drag to the pane, so
    // there it draws every row and lets the engine scroll the body.
    nativeScroll = e.surface === 'desktop'
    const bodyRows = e.props.scroll?.bodyRows ?? 1
    const button = (b: HeaderButton) => <Client key={`button-${b.id}`} module="./button.tsx" props={{ id: b.id, label: b.label, dim: b.dim } satisfies ButtonProps} />
    // What the hovered header button does, left of the buttons, when it fits beside a title that
    // long; the buttons are Clients only so that they can say when the pointer is over them.
    const hint = (buttons: HeaderButton[], title: number) => drawHint(els, hintFor(buttons, hovered, e.props.bodyColumns, title, e.surface), theme)
    if (t.preview) {
      if (previewed?.path !== t.preview) await loadPreview($, t.preview)
      const p = previewed
      const markdown = /\.(md|markdown|mdx)$/i.test(t.preview)
      const all = (p?.text ?? '').split('\n').length
      previewRows = nativeScroll ? all : Math.max(4, (e.props.scroll?.bodyRows ?? 40) - (p?.note ? 2 : 1))
      const win = previewLines(p?.text ?? '', nativeScroll ? 0 : Math.min(t.previewTop, Math.max(0, all - previewRows)), previewRows, markdown)
      const name = t.preview !== t.root && inside(t.root, t.preview) ? relative(t.root, t.preview) : shortPath(t.preview)
      const back = backButton(unicode)
      const external = externalButton(unicode)
      return drawFrame(els, bodyRows, theme, [
        drawPreviewHeader(els, button(back), name, hint([back, external], 8 + name.length), button(external)),
        p?.note ? drawPreviewNote(els, p.note) : null,
        <Client
          key="rows"
          module="./rows.tsx"
          props={{ rows: [], active: '', activeBg: theme.selection, hoverBg: faint(theme.selection), tones: SHIMMER, pointer: false, preview: { text: win.text, path: t.preview, startLine: win.top + 1, markdown } } satisfies RowsProps}
        />,
      ])
    }
    const now = await $.clock.now()
    const live = (await activities($)).filter(a => now - a.at < (a.state === 'running' ? RUNNING_MAX_MS : ACTIVITY_TTL_MS))
    const latest = [...live].reverse().find(a => a.state === 'running') ?? live[live.length - 1]
    const bright = new Set(t.flashOn ? t.flash : [])
    const dimmed = new Set(t.flashOn ? t.flashDim : [])
    const ignored = new Set(t.ignored)
    const untracked = new Set(t.untrackedDirs)
    const width = Math.max(24, e.props.bodyColumns)
    const rows = visibleRows(t)
    const fixed = 2 + (t.top ? (t.branch ? 1 : 0) : showHints ? 1 : 0) + (t.selected || latest ? 1 : 0)
    const room = nativeScroll ? Math.max(1, rows.length) : Math.max(5, (e.props.scroll?.bodyRows ?? 40) - fixed)
    const isLit = (id: string) => bright.has(id) || dimmed.has(id)
    const focus = followClaude && t.flashOn ? ([...t.flash].reverse().find(id => id !== BRANCH_ROW) ?? t.cursor) : t.cursor
    const at = Math.max(0, rows.findIndex(r => r.node.id === focus))
    const lit = followClaude && t.flashOn ? rows.findIndex(r => isLit(r.node.id)) : -1
    const cap = Math.max(1, Math.floor(room / 3))
    let from = Math.max(0, Math.min(lit >= 0 && at - lit < room - 2 ? Math.max(0, lit - 1) : at - Math.floor(room / 2), rows.length - room))
    let pinned = !nativeScroll && followClaude && t.flashOn ? rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap) : []
    if (pinned.length) {
      const rest = Math.max(3, room - pinned.length)
      from = Math.max(0, Math.min(at - Math.floor(rest / 2), rows.length - rest))
      pinned = rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap)
    }
    const max = Math.max(0, rows.length - room)
    if (t.scroll !== null) {
      from = Math.max(0, Math.min(t.scroll, max))
      pinned = []
    }
    view = { from, max }
    const shown = rows.slice(from, from + room - pinned.length)
    if (t.showSize) wantSizes($, [...pinned, ...shown].filter(r => r.node.kind === 'dir' && !(r.node.id in t.dirSizes)).map(r => r.node.id))
    const totals: [number, number] = t.top ? (t.diff[t.root] ?? [0, 0]) : [0, 0]
    const rootCounts = t.top ? countSegs(t.counts[t.root], theme) : []
    const buttons = headerButtons(unicode, { follow, showHidden: t.showHidden, showSize: t.showSize, selected: Boolean(t.selected) })
    const clear = clearButton(unicode)
    const header = t.top ? [t.top.split('/').pop() ?? t.top, t.prefix.replace(/\/$/, '')].filter(Boolean).join('/') : t.root.split('/').pop() || t.root

    const rowSpec = (r: (typeof rows)[number]): RowSpec => {
      const n = r.node
      const status = t.git[n.id] ?? (underAny(dirname(n.id), untracked, t.root) ? '?' : undefined)
      const isBright = bright.has(n.id)
      const loc = t.diff[n.id]
      return nodeRow({
        node: n,
        depth: r.depth,
        open: r.open,
        status,
        isIgnored: !status && underAny(n.id, ignored, t.root),
        isBright,
        isDim: !isBright && dimmed.has(n.id),
        tone: t.flashTones[n.id] ?? 'orange',
        loc,
        counts: t.counts[n.id],
        meta: metaOf(n, { showSize: t.showSize, dirSizes: t.dirSizes, loc, showAge, now }),
        selected: n.id === t.selected,
        isRepo: n.kind === 'dir' && n.id === t.top,
        unicode,
        theme,
        width,
      })
    }

    const note = (text: string): RowSpec => noteRow(text, theme)
    const specs: RowSpec[] = [
      ...(rows.length === 0 ? [note(EMPTY_NOTE)] : []),
      ...pinned.map(rowSpec),
      ...(pinned.length > 0 ? [note(PINNED_GAP)] : []),
      ...shown.map(rowSpec),
    ]
    if (nativeScroll) {
      let size = 0
      const cut = specs.findIndex(r => (size += JSON.stringify(r).length + 1) > ROWS_BUDGET)
      if (cut >= 0) specs.splice(cut, specs.length - cut, note(cutNote(specs.length - cut)))
    }
    const barSize = Math.max(1, Math.round((specs.length * shown.length) / Math.max(1, rows.length)))
    const bar =
      !nativeScroll && rows.length > shown.length + pinned.length
        ? { pos: max ? Math.round((from / max) * (specs.length - barSize)) : 0, size: barSize, thumb: theme.accent, track: theme.muted }
        : undefined

    const branchRow = () =>
      t.top && t.branch
        ? drawBranchRow(els, { branch: t.branch, ...(bright.has(BRANCH_ROW) ? { flashTone: t.flashTones[BRANCH_ROW] ?? 'teal' } : {}), totals, rootCounts, unicode, theme })
        : null
    const selectedPath = t.selected ? (t.selected !== t.root && inside(t.root, t.selected) ? t.selected.slice(t.root.endsWith('/') ? t.root.length : t.root.length + 1) : shortPath(t.selected)) : ''

    return drawFrame(els, bodyRows, theme, [
      drawHeader(els, header, theme, hint(buttons, header.length), buttons.map(button)),
      branchRow(),
      !t.top && showHints && drawNoRepo(els, unicode, theme),
      drawSearchRow(els, {
        query: t.query,
        field: <Input key="q" label={SEARCH.label} placeholder={SEARCH.placeholder} submitLabel={SEARCH.submitLabel} autoFocus value={t.query} onInput={(v: string) => void search($, v)} onSubmit={(v: string) => void jump($, v)} />,
        hint: t.query ? hint([clear], 2 + t.query.length) : null,
        clear: t.query ? button(clear) : null,
      }),
      <Client
        key="rows"
        module="./rows.tsx"
        props={{ rows: specs, active: t.cursor, activeBg: theme.selection, hoverBg: faint(theme.selection), tones: SHIMMER, pointer, ...(bar ? { bar } : {}) } satisfies RowsProps}
      />,
      <Box flexGrow={1} />,
      t.selected || latest ? drawFooter(els, selectedPath, latest ? drawChip(els, latest, unicode, theme) : null) : null,
    ])
  })
}
