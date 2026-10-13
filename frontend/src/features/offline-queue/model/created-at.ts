let last = 0;

/** Time of adding to the queue, strictly increasing: two expenses added in one millisecond keep their order. */
export function nextCreatedAt(): number {
  last = Math.max(Date.now(), last + 1);
  return last;
}
