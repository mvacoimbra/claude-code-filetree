import type { ClientModule, RenderElement } from 'claude-code'
import { type Bar, cutNote, FRAMES, paintPreview, paintRow, type Preview, type RowSpec, type Tones } from './paint'

export type { RowSpec, Seg } from './paint'
export type RowsProps = {
  rows: RowSpec[]
  active: string
  activeBg: string
  hoverBg: string
  tones: Tones
  spinner?: string[]
  pointer?: boolean
  bar?: Bar
  preview?: Preview
}
type Local = { hover: number; phase: number; drag: boolean; ref: { stop?: () => void; unpoint?: () => void } }

const TICK_MS = 90
const TREE_BUDGET = 70_000
const MAX_ROWS = 1_500

const Rows: ClientModule<RowsProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { hover: -1, phase: 0, drag: false, ref: {} }
    surface.setState(state)
  }
  let visible = props.rows.length
  const lit = props.rows.some(r => r.left.some(s => s.sh || s.spin) || r.right.some(s => s.sh || s.spin))
  if (lit && !state.ref.stop) {
    state.ref.stop = surface.every(TICK_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, phase: cur.phase + 1 })
    })
  } else if (!lit && state.ref.stop) {
    state.ref.stop()
    state.ref.stop = undefined
  }
  if (props.pointer === false) {
    state.ref.unpoint?.()
    state.ref.unpoint = undefined
  } else state.ref.unpoint = surface.onPointer(e => {
    const cur = surface.state ?? state
    const span = Math.max(1, props.rows.length - 1)
    const onBar = Boolean(props.bar) && e.x >= surface.columns - 1
    if (props.bar && (cur.drag || (onBar && e.type === 'down' && (e.button ?? 'left') === 'left'))) {
      if (e.type === 'up' || e.type === 'leave') {
        surface.setState({ ...cur, drag: false })
        return
      }
      if (e.type === 'down' || e.type === 'move') {
        if (!cur.drag) surface.setState({ ...cur, drag: true, hover: -1 })
        surface.post({ scrollTo: Math.max(0, Math.min(1, e.y / span)) })
        return
      }
    }
    if (e.type === 'leave' || e.y < 0 || e.y >= visible) {
      if (cur.hover !== -1) surface.setState({ ...cur, hover: -1 })
      return
    }
    if (e.type === 'move' && !e.button && cur.hover !== e.y) surface.setState({ ...cur, hover: e.y })
    const row = props.rows[e.y]
    if (e.type === 'down' && e.button === 'right' && row?.id) {
      surface.post({ copy: row.id, shift: Boolean(e.shift) })
      return
    }
    if (e.type !== 'down' || (e.button ?? 'left') !== 'left' || !row) return
    let x = 0
    for (const seg of row.left) {
      const w = [...seg.t].length
      if (seg.tab && e.x >= x && e.x < x + w) {
        surface.post({ tab: seg.tab })
        return
      }
      x += w
    }
    if (row.id) surface.post({ press: row.id, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) })
  })
  surface.onKey(e => surface.post({ key: e.key, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) }))
  // The preview draws in this same element, so the focus a click gave the tree stays put.
  if (props.preview) return paintPreview(surface.elements, props.preview)
  const frames = props.spinner?.length ? props.spinner : FRAMES
  const bar = props.bar
  const rowEl = (r: RowSpec, i: number) => {
    const thumb = Boolean(bar) && i >= (bar?.pos ?? 0) && i < (bar?.pos ?? 0) + (bar?.size ?? 0)
    return paintRow(surface.elements, r, {
      bg: r.id && r.id === props.active ? props.activeBg : r.id && i === state.hover ? props.hoverBg : undefined,
      phase: state.phase,
      tones: props.tones,
      frames,
      ...(bar ? { bar: { thumb, color: thumb ? bar.thumb : bar.track } } : {}),
    })
  }
  const drawn: RenderElement[] = []
  let size = 0
  for (let i = 0; i < props.rows.length; i++) {
    const el = rowEl(props.rows[i] as RowSpec, i)
    let cost = 1_000
    try {
      cost = JSON.stringify(el).length
    } catch {}
    if (size + cost > TREE_BUDGET || drawn.length >= MAX_ROWS) {
      visible = i
      drawn.push(<Text dimColor>{cutNote(props.rows.length - i)}</Text>)
      break
    }
    size += cost
    drawn.push(el)
  }
  return <Box flexDirection="column">{drawn}</Box>
}

export default Rows
