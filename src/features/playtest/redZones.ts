import type { ChartNote } from '../chart/types'

interface RedInterval { start: number; end: number }
// Beat conversion can place visually identical boundaries a few ULPs apart.
// This is numerical tolerance in milliseconds, not a gameplay timing window.
const BOUNDARY_EPSILON_MS = 1e-6
export const RED_HOLD_GRACE_MS = 80

/** Immutable merged intervals: O(n log n) preparation, O(log n) point queries. */
export function createRedZoneIndex(notes: ChartNote[], holdPaddingMs = 0) {
  const lanes: RedInterval[][] = [[], [], [], []]
  for (const note of notes) if (note.red) {
    const end = note.endTime ?? note.time
    // Negative padding narrows danger; keep at least half of a short hold active.
    // Positive padding protects ordinary hold ticks around the transition.
    const padding = note.kind === 'hold' ? Math.max(holdPaddingMs, -(end - note.time) / 4) : 0
    lanes[note.lane].push({ start: Math.max(0, note.time - padding), end: end + padding })
  }
  for (const lane of lanes) {
    lane.sort((a, b) => a.start - b.start)
    let count = 0
    for (const interval of lane) {
      const previous = lane[count - 1]
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end)
      else lane[count++] = interval
    }
    lane.length = count
  }
  const contains = (lane: number, time: number) => {
    const intervals = lanes[lane]
    let low = 0, high = intervals.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (intervals[mid].start <= time + BOUNDARY_EPSILON_MS) low = mid + 1
      else high = mid
    }
    return low > 0 && intervals[low - 1].end >= time - BOUNDARY_EPSILON_MS
  }
  return { lanes, contains }
}

/** A cursor per lane: no allocations or full-chart scans in the frame/input loop. */
export class RedZoneTracker {
  private readonly cursors = new Uint32Array(4)
  private previousTime = -Infinity
  constructor(private readonly index: ReturnType<typeof createRedZoneIndex>) {}

  reset(time: number) {
    this.previousTime = time
    for (let lane = 0; lane < 4; lane++) {
      const intervals = this.index.lanes[lane]
      let low = 0, high = intervals.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (intervals[mid].end < time) low = mid + 1
        else high = mid
      }
      this.cursors[lane] = low
    }
  }

  advance(time: number, pressed: ReadonlySet<number>) {
    if (time < this.previousTime) this.reset(time)
    let hits = 0
    for (let lane = 0; lane < 4; lane++) {
      const intervals = this.index.lanes[lane]
      let cursor = this.cursors[lane]
      while (cursor < intervals.length && intervals[cursor].start <= time) {
        const interval = intervals[cursor]
        if (pressed.has(lane) && interval.end >= this.previousTime) hits |= 1 << lane
        if (interval.end >= time) break
        cursor++
      }
      this.cursors[lane] = cursor
    }
    this.previousTime = time
    return hits
  }
}
