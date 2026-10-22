function interpolate(progress: number, start: number, end: number) {
  const value = Math.min(1, Math.max(0, (progress - start) / (end - start)));
  return value * value * (3 - 2 * value);
}

class TransformationHero extends HTMLElement {
  connectedCallback() {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const portrait = window.matchMedia("(orientation: portrait)");
    const controller = new AbortController();
    const { signal } = controller;
    const viewport = this.querySelector<HTMLElement>(".hero-viewport");
    const stage = this.querySelector<HTMLElement>(".transformation-stage");
    const headline = this.querySelector<HTMLElement>(".hero-headline");
    const words = this.querySelectorAll<HTMLElement>(".hero-word");
    const canvas = this.querySelector<HTMLElement>(".transformation-canvas");
    const copy = this.querySelector<HTMLElement>(".transformation-copy");
    let frame = 0;
    let sectionTop = 0;
    let scrollDistance = 1;

    const render = () => {
      frame = 0;
      let progress = (window.scrollY - sectionTop) / scrollDistance;
      if (motion.matches) progress = 1;
      this.style.setProperty("--hero-progress", String(interpolate(progress, 0.15, 0.8)));
      this.style.setProperty("--hero-copy-progress", String(interpolate(progress, 0.35, 0.75)));
      this.style.setProperty("--hero-paper-progress", String(interpolate(progress, 0.2, 0.8)));
      words.forEach((_, index) => {
        this.style.setProperty(`--hero-word-${index}`, String(interpolate(progress, 0.15 + index * 0.13, 0.5 + index * 0.13)));
      });
      const understood = progress >= 0.5;
      this.dataset.view = understood ? "understood" : "lecture";
      this.querySelector("[data-lecture]")?.setAttribute("aria-hidden", String(understood));
      this.querySelector("[data-explanation]")?.setAttribute("aria-hidden", String(!understood));
      const explanation = this.querySelector<HTMLElement>("[data-explanation]");
      if (explanation) explanation.inert = !understood;
      this.querySelector(".hero-description .hero-before")?.setAttribute("aria-hidden", String(understood));
      this.querySelector(".hero-description .hero-after")?.setAttribute("aria-hidden", String(!understood));
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };

    const measure = () => {
      if (!viewport || !stage || !headline || !canvas || !copy) return;
      sectionTop = window.scrollY + this.getBoundingClientRect().top;
      scrollDistance = Math.max(1, this.offsetHeight - viewport.offsetHeight);
      const fontSize = parseFloat(getComputedStyle(headline).fontSize);
      this.style.setProperty("--hero-subtext-rise", `${fontSize * 0.55}px`);
      const englishWidths = [...words].map((word) => word.querySelector<HTMLElement>(".hero-word-after")?.offsetWidth ?? 0);
      const chineseWidths = [...words].map((word) => word.querySelector<HTMLElement>(".hero-word-before")?.offsetWidth ?? 0);
      const wordGap = fontSize * 0.22;
      const firstLineWidth = englishWidths[0] + wordGap + englishWidths[1];
      const chineseWidth = chineseWidths.reduce((total, width) => total + width, 0) + fontSize * 0.12;
      let chineseLeft = 0;
      let firstLineLeft = 0;
      if (portrait.matches) {
        chineseLeft = (headline.clientWidth - chineseWidth) / 2;
        firstLineLeft = (headline.clientWidth - firstLineWidth) / 2;
      }
      words.forEach((word, index) => {
        word.style.setProperty("--word-start-left", `${chineseLeft}px`);
        chineseLeft += chineseWidths[index] + fontSize * 0.04;
        let endLeft = firstLineLeft;
        if (index === 1) endLeft += englishWidths[0] + wordGap;
        if (index === 2) {
          endLeft = 0;
          if (portrait.matches) endLeft = (headline.clientWidth - englishWidths[2]) / 2;
        }
        word.style.setProperty("--word-end-left", `${endLeft}px`);
      });
      headline.style.setProperty("--punctuation-left", `${chineseLeft}px`);
      const stageStyle = getComputedStyle(stage);
      const stagePadding = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
      let availableHeight = stage.clientHeight - stagePadding;
      if (portrait.matches) availableHeight -= copy.offsetHeight + parseFloat(stageStyle.rowGap);
      const availableWidth = canvas.parentElement?.clientWidth ?? canvas.offsetWidth;
      const artScale = Math.max(0.1, Math.min(1, availableWidth / canvas.offsetWidth, availableHeight / canvas.offsetHeight));
      this.style.setProperty("--hero-art-scale", String(artScale));
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true, signal });
    window.addEventListener("resize", measure, { signal });
    portrait.addEventListener("change", measure, { signal });
    motion.addEventListener("change", measure, { signal });
    const observer = new ResizeObserver(measure);
    if (viewport) observer.observe(viewport);
    if (headline) observer.observe(headline);
    document.fonts.ready.then(() => {
      if (!signal.aborted) measure();
    });
    measure();
    this.cleanup = () => {
      controller.abort();
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }

  private cleanup = () => {};

  disconnectedCallback() {
    this.cleanup();
  }
}

customElements.define("transformation-hero", TransformationHero);

export {};
