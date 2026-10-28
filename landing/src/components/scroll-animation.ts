export function createScrollAnimation(
  readProgress: () => number,
  render: (progress: number) => void,
  motion: MediaQueryList,
) {
  let frame = 0;
  let progress: number | undefined;
  let previousTime = 0;

  const tick = (time: number) => {
    frame = 0;
    const target = readProgress();
    if (progress === undefined) progress = target;
    // Use elapsed time so touch-scroll gaps settle consistently on 60 Hz and 120 Hz screens.
    const blend = 1 - Math.exp(-Math.max(0, time - previousTime) / 70);
    previousTime = time;
    progress += (target - progress) * blend;
    if (motion.matches || Math.abs(target - progress) < 0.0001) progress = target;
    render(progress);
    if (progress !== target) frame = window.requestAnimationFrame(tick);
  };

  return {
    schedule() {
      if (frame) return;
      previousTime = performance.now();
      frame = window.requestAnimationFrame(tick);
    },
    cancel() {
      window.cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
