import { afterAll } from "vitest";

// UI suites can replace requestAnimationFrame with a Node timer that outlives jsdom.
if (typeof document !== "undefined") {
  afterAll(async () => {
    const { gsap } = await import("gsap");
    gsap.ticker.sleep();
  });
}
