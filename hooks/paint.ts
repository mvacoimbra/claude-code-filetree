import type { BoxProps, CodeProps, ElementConstructor, MarkdownProps, RenderElement, TextProps } from 'claude-code'

// How a tree row is painted, shared by the rows surface module and the catalog the /mods hub
// shows, so both draw the same thing. No JSX here: the element constructors are called directly.

export type Seg = { t: string; c?: string; b?: boolean; s?: boolean; i?: boolean; sh?: string; dim?: boolean; one?: boolean; spin?: boolean; bg?: string; tab?: string }
export type RowSpec = { id: string; left: Seg[]; right: Seg[] }
export type Tones = Record<string, { bright: string[]; dim: string[] }>
export type Bar = { pos: number; size: number; thumb: string; track: string }
export type Preview = { text: string; path: string; startLine: number; markdown: boolean }
export type Paints = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }
export type PreviewPaints = { Code: ElementConstructor<CodeProps>; Markdown: ElementConstructor<MarkdownProps> }

export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function shimmer(i: number, phase: number, len: number, palette: string[]): string {
  const band = ((phase * 1.6) % (len + 8)) - 4
  const d = Math.abs(i - band)
  return palette[d < 0.8 ? 3 : d < 1.8 ? 2 : d < 2.8 ? 1 : 0] ?? palette[0] ?? '#f97316'
}

// The note that ends a tree too large to draw whole.
export function cutNote(more: number): string {
  return `  … ${more} more rows, collapse folders or use search`
}

export function paintSeg(Text: Paints['Text'], s: Seg, phase: number, tones: Tones, frames: string[] = FRAMES): RenderElement {
  if (s.spin) return Text({ color: s.c, bold: s.b, children: s.t + (frames[phase % frames.length] ?? '') })
  const palette = s.sh ? (s.dim ? tones[s.sh]?.dim : tones[s.sh]?.bright) : undefined
  if (!palette) return Text({ color: s.c, backgroundColor: s.bg, bold: s.b, strikethrough: s.s, italic: s.i, children: s.t })
  if (s.one) return Text({ color: shimmer(-1, phase, s.t.length, palette), children: s.t })
  const chars = [...s.t]
  return Text({ bold: s.b, children: chars.map((ch, i) => Text({ color: shimmer(i, phase, chars.length, palette), children: ch })) })
}

// One row: the left segments, room, the right segments, and the scrollbar cell when there is one.
export function paintRow(
  { Box, Text }: Paints,
  r: RowSpec,
  o: { bg?: string; phase: number; tones: Tones; frames?: string[]; bar?: { thumb: boolean; color: string } },
): RenderElement {
  const draw = (s: Seg) => paintSeg(Text, s, o.phase, o.tones, o.frames)
  return Box({
    flexDirection: 'row',
    height: 1,
    overflow: 'hidden',
    backgroundColor: o.bg,
    children: [
      Box({ flexShrink: 1, overflow: 'hidden', children: r.left.map(draw) }),
      Box({ flexGrow: 1 }),
      ...r.right.map(draw),
      ...(o.bar ? [Text({ color: o.bar.color, children: o.bar.thumb ? '┃' : '│' })] : []),
    ],
  })
}

export function paintPreview({ Code, Markdown }: PreviewPaints, p: Preview): RenderElement {
  return p.markdown ? Markdown({ text: p.text }) : Code({ source: p.text, path: p.path, startLine: p.startLine, wrap: 'truncate-end' })
}
