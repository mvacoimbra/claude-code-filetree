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
export type FiletreeItem =
  | { kind: 'toggle'; id: string; label: string; help?: string; value: boolean }
  | { kind: 'choice'; id: string; label: string; help?: string; value: string; options: { value: string; label: string }[] }
  | { kind: 'action'; id: string; label: string; help?: string; primary?: boolean }
  | { kind: 'input'; id: string; label: string; help?: string; placeholder?: string; submitLabel?: string }
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

declare module 'claude-code' {
  interface EngineInterface {
    filetree: {
      panel: (args: FiletreePanelArgs) => Promise<FiletreePanel>
      act: (args: FiletreeActArgs) => Promise<FiletreeActResult>
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
