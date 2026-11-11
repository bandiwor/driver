/**
 * Lock-free single-producer / single-consumer triple buffer over an
 * Int32Array cell (works on SharedArrayBuffer across threads).
 *
 * Three slots; at any time the writer owns `back`, the reader owns `front`,
 * and the third index sits in the shared cell ("middle") with a FRESH bit.
 *   writer: fill back → publish(): back ⇄ middle (set FRESH)
 *   reader: acquire(): if FRESH, front ⇄ middle (clear FRESH)
 * Neither side ever blocks or touches a slot the other one owns → no tearing.
 */
export const FRESH = 4
const INDEX = 3

export const initTripleCell = (cell: Int32Array, at = 0): void => {
  Atomics.store(cell, at, 1) // writer: back=0, middle=1, reader: front=2
}

export class TripleWriter {
  back = 0
  constructor(
    readonly cell: Int32Array,
    readonly at = 0,
  ) {}
  /** Publishes the slot just written; returns the next slot to write. */
  publish(): number {
    this.back = Atomics.exchange(this.cell, this.at, this.back | FRESH) & INDEX
    return this.back
  }
}

export class TripleReader {
  front = 2
  constructor(
    readonly cell: Int32Array,
    readonly at = 0,
  ) {}
  /** True if a newer slot was taken; read it at `front`. */
  acquire(): boolean {
    if ((Atomics.load(this.cell, this.at) & FRESH) === 0) return false
    this.front = Atomics.exchange(this.cell, this.at, this.front) & INDEX
    return true
  }
}
