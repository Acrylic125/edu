class TransformationHero extends HTMLElement {
  private timer = 0;
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private controller = new AbortController();

  connectedCallback() {
    this.controller = new AbortController();
    const { signal } = this.controller;

    this.querySelectorAll<HTMLButtonElement>("[data-view-button]").forEach((button) => {
      button.addEventListener("click", () => {
        window.clearTimeout(this.timer);
        this.show(button.dataset.viewButton === "understood");
      }, { signal });
    });

    this.motion.addEventListener("change", () => {
      window.clearTimeout(this.timer);
      if (this.motion.matches) this.show(true);
    }, { signal });

    if (this.motion.matches) {
      this.show(true);
      return;
    }

    this.timer = window.setTimeout(() => this.show(true), 3200);
  }

  disconnectedCallback() {
    window.clearTimeout(this.timer);
    this.controller.abort();
  }

  private show(understood: boolean) {
    this.dataset.view = understood ? "understood" : "lecture";
    this.querySelector("[data-lecture]")?.setAttribute("aria-hidden", String(understood));
    this.querySelector("[data-explanation]")?.setAttribute("aria-hidden", String(!understood));
    this.querySelectorAll<HTMLButtonElement>("[data-view-button]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.viewButton === this.dataset.view));
    });
  }
}

customElements.define("transformation-hero", TransformationHero);
