class DownloadSection extends HTMLElement {
  connectedCallback() {
    const stage = this.querySelector<HTMLElement>(".download-stage");
    const icons = this.querySelectorAll<HTMLElement>("[data-download-icon]");
    const paths = this.querySelectorAll<SVGPathElement>("[data-download-path]");
    const orbits = this.querySelectorAll<SVGGElement>("[data-download-orbit]");
    const gradients = this.querySelectorAll<SVGLinearGradientElement>("linearGradient");
    const svg = this.querySelector<SVGSVGElement>("[data-download-orbits]");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = new AbortController();
    let frame = 0;
    let sectionTop = 0;
    let distance = 1;
    let width = 1;
    let height = 1;
    // One polar coordinate system keeps the icon centers and SVG trail tips identical.
    const spiralPoint = (progress: number, index: number) => {
      const finalRadius = Math.min(width * 0.44, height * 0.44) * 0.76;
      const radius = finalRadius * (4 - 3 * progress);
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 3 + (progress - 1) * Math.PI * 4 / 3;
      return {
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      };
    };

    const render = () => {
      frame = 0;
      let progress = Math.min(1, Math.max(0, (window.scrollY - sectionTop) / distance));
      if (motion.matches) progress = 1;
      const travel = Math.min(1, Math.max(0, (progress - 0.06) / 0.76));
      const eased = travel * travel * (3 - 2 * travel);
      const reveal = Math.min(1, Math.max(0, (progress - 0.62) / 0.22));
      this.style.setProperty("--download-progress", String(eased));
      this.style.setProperty("--download-reveal", String(reveal));
      this.toggleAttribute("ready", reveal > 0);

      icons.forEach((icon, index) => {
        const point = spiralPoint(eased, index);
        const tailProgress = Math.max(0, eased - 0.42);
        const tail = spiralPoint(tailProgress, index);
        const samples = 80;
        let route = `M ${tail.x} ${tail.y}`;
        for (let sample = 1; sample <= samples; sample += 1) {
          const position = spiralPoint(tailProgress + (eased - tailProgress) * sample / samples, index);
          route += ` L ${position.x} ${position.y}`;
        }
        paths[index].setAttribute("d", route);
        orbits[index].querySelector(".download-trail-glow")?.setAttribute("d", route);
        icon.style.left = `${point.x}px`;
        icon.style.top = `${point.y}px`;
        gradients[index].setAttribute("x1", String(tail.x));
        gradients[index].setAttribute("y1", String(tail.y));
        gradients[index].setAttribute("x2", String(point.x));
        gradients[index].setAttribute("y2", String(point.y));
        orbits[index].style.setProperty("--trail-progress", String(eased));
      });
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };

    const measure = () => {
      if (!stage) return;
      sectionTop = this.getBoundingClientRect().top + window.scrollY;
      distance = Math.max(1, this.offsetHeight - stage.offsetHeight);
      width = stage.clientWidth;
      height = stage.clientHeight;
      svg?.setAttribute("viewBox", `0 0 ${width} ${height}`);
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true, signal: controller.signal });
    window.addEventListener("resize", measure, { signal: controller.signal });
    motion.addEventListener("change", measure, { signal: controller.signal });
    const observer = new ResizeObserver(measure);
    observer.observe(this);
    if (stage) observer.observe(stage);
    measure();

    this.cleanup = () => {
      controller.abort();
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }

  cleanup = () => {};

  disconnectedCallback() {
    this.cleanup();
  }
}

if (!customElements.get("download-section")) customElements.define("download-section", DownloadSection);
