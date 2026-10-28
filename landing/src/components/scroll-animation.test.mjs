import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createScrollAnimation } from "./scroll-animation.ts";

test("scroll animation interpolates coarse input, reverses, and stops at rest", () => {
  let time = 0;
  let target = 0;
  let nextFrame;
  let rendered = 0;
  const originalWindow = globalThis.window;
  globalThis.window = {
    requestAnimationFrame(callback) {
      nextFrame = callback;
      return 1;
    },
    cancelAnimationFrame() {
      nextFrame = undefined;
    },
  };
  mock.method(performance, "now", () => time);
  const motion = { matches: false };
  const animation = createScrollAnimation(() => target, (value) => { rendered = value; }, motion);
  const advance = (elapsed) => {
    time += elapsed;
    const callback = nextFrame;
    nextFrame = undefined;
    callback(time);
  };

  try {
    animation.schedule();
    advance(16);
    assert.equal(rendered, 0);
    assert.equal(nextFrame, undefined);

    target = 1;
    animation.schedule();
    advance(-1);
    assert.equal(rendered, 0, "a stale frame timestamp must not move away from the target");
    advance(17);
    assert.ok(rendered > 0 && rendered < 1);
    const forward = rendered;
    target = 0;
    advance(16);
    assert.ok(rendered > 0 && rendered < forward);
    for (let index = 0; nextFrame && index < 100; index += 1) advance(16);
    assert.equal(rendered, 0);
    assert.equal(nextFrame, undefined, "idle sections must not keep requesting frames");

    const results = [];
    for (const hz of [60, 120]) {
      target = 0;
      const timed = createScrollAnimation(() => target, (value) => { rendered = value; }, motion);
      timed.schedule();
      advance(1000 / hz);
      target = 1;
      timed.schedule();
      for (let index = 0; index < hz / 10; index += 1) advance(1000 / hz);
      results.push(rendered);
      timed.cancel();
    }
    assert.ok(Math.abs(results[0] - results[1]) < 0.000001, "smoothing must be independent of refresh rate");

    motion.matches = true;
    animation.schedule();
    advance(16);
    assert.equal(rendered, target, "reduced motion must skip interpolation");
    assert.equal(nextFrame, undefined);

    motion.matches = false;
    target = 0;
    animation.schedule();
    animation.cancel();
    assert.equal(nextFrame, undefined);
  } finally {
    globalThis.window = originalWindow;
    mock.restoreAll();
  }
});
