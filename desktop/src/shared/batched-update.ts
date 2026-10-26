export function createBatchedUpdate(publish: () => void, intervalMs = 40) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
    publish()
  }
  return {
    schedule() {
      if (!timer) timer = setTimeout(flush, intervalMs)
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}
