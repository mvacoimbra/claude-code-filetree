export type FileNode = {
  id: string
  parent: string
  name: string
  kind: 'dir' | 'file' | 'link'
  hidden: boolean
  mtime: number
  size: number
  loaded: boolean
}

export type Branch = {
  head: string
  upstream: string
  ahead: number
  behind: number
}

export type Activity = {
  id: number
  kind: string
  label: string
  state: 'running' | 'done' | 'failed'
  detail: string
  at: number
  tone: string
  nerd: string
  plain: string
}

export type FileTree = {
  root: string
  nodes: FileNode[]
  expanded: string[]
  cursor: string
  selected: string
  query: string
  showHidden: boolean
  showSize: boolean
  dirSizes: Record<string, number>
  git: Record<string, string>
  diff: Record<string, [number, number]>
  ignored: string[]
  untrackedDirs: string[]
  top: string
  prefix: string
  branch: Branch | null
  counts: Record<string, [number, number, number]>
  flash: string[]
  flashDim: string[]
  flashOn: boolean
  flashTones: Record<string, string>
  scroll: number | null
  preview: string
  previewTop: number
}

export type Theme = {
  fg: string
  accent: string
  muted: string
  urgent: string
  selection: string
  bg: string
}

// `$.filetree`: the tab the /mods hub draws for this mod (the mods panel protocol).
export type FiletreeLang = 'en' | 'pt'
export type FiletreePanelArgs = { lang: FiletreeLang; surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'; columns: number }
export type FiletreeTone = 'ok' | 'warn' | 'err' | 'muted' | 'accent'
// Whose setting an item changes: the user's, in every session (the default), or this session's
// alone, which the hub marks "this session only".
export type FiletreeScope = 'user' | 'session'
export type FiletreeItem =
  | { kind: 'toggle'; id: string; label: string; help?: string; value: boolean; scope?: FiletreeScope }
  | { kind: 'choice'; id: string; label: string; help?: string; value: string; options: { value: string; label: string }[]; scope?: FiletreeScope }
  // `title` names the row, `help` under it; `label` is what the button says.
  | { kind: 'action'; id: string; title?: string; label: string; help?: string; primary?: boolean; scope?: FiletreeScope }
  | { kind: 'input'; id: string; label: string; help?: string; placeholder?: string; submitLabel?: string; scope?: FiletreeScope }
  | { kind: 'info'; label: string; value: string; tone?: FiletreeTone }
  | { kind: 'text'; text: string; tone?: FiletreeTone }
  | { kind: 'swatch'; id: string; label: string; color: string; selected: boolean }
  | { kind: 'tree'; tree: unknown }
export type FiletreeSection = { id: string; title: string; items: FiletreeItem[] }
export type FiletreePanel = {
  // The tab's name.
  title: string
  // One line for the overview and under the tab row.
  summary?: string
  tone?: FiletreeTone
  // Drawn as sub-tabs when there is more than one.
  sections: FiletreeSection[]
  // While this tab shows, the hub draws it again this often (a countdown).
  refreshMs?: number
}
export type FiletreeActArgs = { id: string; value?: string }
export type FiletreeActResult = { message?: string }
// One piece of the pane for the Components tab of /mods (the mods panel protocol's catalog).
export type FiletreeCatalogEntry = {
  // Stable, kebab-case: what a person names when asking for a change.
  id: string
  // The component's name, as a person would say it ("File row, modified").
  name: string
  // One line on what it is and where it shows.
  help?: string
  // The component drawn for `args.surface` at `args.columns`, from the same builders the pane
  // draws it with, in a state worth seeing. Static: a press cannot cross to the mod.
  tree: unknown
}

declare module 'claude-code' {
  interface EngineInterface {
    filetree: {
      panel: (args: FiletreePanelArgs) => Promise<FiletreePanel>
      act: (args: FiletreeActArgs) => Promise<FiletreeActResult>
      catalog: (args: FiletreePanelArgs) => Promise<FiletreeCatalogEntry[]>
    }
  }

  interface PluginState {
    filetree: {
      tree: FileTree
      theme: Theme
      activity: Activity[]
    }
  }
}
