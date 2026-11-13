/**
 * Bounded top-k selection.
 *
 * The heap stores the current best `limit` values with the worst value at the
 * root. `compare` returns a negative number when `a` is better than `b`.
 * Memory is O(limit); time is O(n log limit).
 */
export class BoundedTopK<T> {
  private readonly heap: T[] = [];
  private readonly limit: number;
  private readonly compare: (a: T, b: T) => number;

  constructor(limit: number, compare: (a: T, b: T) => number) {
    this.limit = limit;
    this.compare = compare;
  }

  offer(value: T): void {
    if (this.limit <= 0) {
      return;
    }

    if (this.heap.length < this.limit) {
      this.heap.push(value);
      this.siftUp(this.heap.length - 1);
      return;
    }

    const worst = this.heap[0];
    if (worst !== undefined && this.compare(value, worst) < 0) {
      this.heap[0] = value;
      this.siftDown(0);
    }
  }

  toSortedArray(): T[] {
    return [...this.heap].sort(this.compare);
  }

  private siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const current = this.heap[index];
      const parent = this.heap[parentIndex];
      if (current === undefined || parent === undefined) {
        return;
      }
      if (this.compare(current, parent) <= 0) {
        return;
      }
      this.heap[index] = parent;
      this.heap[parentIndex] = current;
      index = parentIndex;
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex;
    const length = this.heap.length;

    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let worstIndex = index;

      const worst = this.heap[worstIndex];
      const left = leftIndex < length ? this.heap[leftIndex] : undefined;
      const right = rightIndex < length ? this.heap[rightIndex] : undefined;

      if (worst === undefined) {
        return;
      }
      if (left !== undefined && this.compare(left, worst) > 0) {
        worstIndex = leftIndex;
      }
      const selected = this.heap[worstIndex];
      if (right !== undefined && selected !== undefined && this.compare(right, selected) > 0) {
        worstIndex = rightIndex;
      }

      if (worstIndex === index) {
        return;
      }

      const selectedValue = this.heap[worstIndex];
      if (selectedValue === undefined) {
        return;
      }
      this.heap[worstIndex] = this.heap[index] as T;
      this.heap[index] = selectedValue;
      index = worstIndex;
    }
  }
}
