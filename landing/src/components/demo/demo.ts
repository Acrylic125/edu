import { createScrollAnimation } from "../scroll-animation";

const stepStarts = [0, 1.15, 2.05, 2.95, 4.25];
const timelineEnd = 5.25;

function interpolate(progress: number, start: number, end: number) {
  const value = Math.min(1, Math.max(0, (progress - start) / (end - start)));
  return value * value * (3 - 2 * value);
}

class LearningDemo extends HTMLElement {
  connectedCallback() {
    const captions = this.querySelectorAll<HTMLElement>("[data-demo-caption]");
    const conversation = this.querySelector<HTMLElement>(".demo-conversation");
    const conversationWindow = this.querySelector<HTMLElement>(".demo-conversation-window");
    const explanation = this.querySelector<HTMLElement>(".demo-explanation");
    const check = this.querySelector<HTMLElement>(".demo-check");
    const documentPane = this.querySelector<HTMLElement>(".demo-document");
    const documentBody = this.querySelector<HTMLElement>(".demo-document-body");
    const notes = this.querySelector<HTMLElement>(".demo-notes");
    const home = this.querySelector<HTMLElement>(".demo-home");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const landscape = window.matchMedia("(orientation: landscape)");
    const controller = new AbortController();
    let currentStep = -1;
    let sectionTop = 0;
    let scrollDistance = 1;
    let explanationTop = 0;
    let checkScroll = 0;

    const render = (progress: number) => {
      let step = 0;
      for (let index = 1; index < stepStarts.length; index += 1) {
        if (progress >= stepStarts[index]) step = index;
      }

      // Reduced motion keeps the same story, with completed, still frames per step.
      let time = progress;
      if (motion.matches) time = [1.1, 1.85, 2.55, 3.35, timelineEnd][step];

      const create = interpolate(time, 1.15, 1.85);
      let document = interpolate(time, 2.05, 2.45);
      if (!landscape.matches) document = create;
      const confirm = interpolate(time, 2.6, 2.9);
      const lesson = interpolate(time, 2.95, 3.35);
      const chatScroll = interpolate(time, 3.45, 4.2);
      const reply = interpolate(time, 4.4, 5.05);

      this.style.setProperty("--file-one", String(interpolate(time, 0.1, 0.55)));
      this.style.setProperty("--file-two", String(interpolate(time, 0.25, 0.7)));
      this.style.setProperty("--prompt", String(interpolate(time, 0.35, 0.95)));
      this.style.setProperty("--create", String(create));
      this.style.setProperty("--document", String(document));
      this.style.setProperty("--confirm", String(confirm));
      this.style.setProperty("--lesson", String(lesson));
      this.style.setProperty("--mobile-chat", String(interpolate(time, 3.5, 3.85)));
      this.style.setProperty("--chat-scroll", `${-(explanationTop * lesson + (checkScroll - explanationTop) * chatScroll)}px`);
      this.style.setProperty("--check", String(interpolate(time, 3.6, 4.15)));
      this.style.setProperty("--reply", String(reply));

      captions.forEach((caption, index) => {
        let opacity = 0;
        let offset = 10;
        if (index === step) {
          opacity = 1;
          offset = 0;
          if (index > 0 && !motion.matches) {
            opacity = interpolate(progress, stepStarts[index], stepStarts[index] + 0.14);
            offset = (1 - opacity) * 10;
          }
        }
        caption.style.opacity = String(opacity);
        caption.style.transform = `translateY(${offset}px)`;
      });

      if (step !== currentStep) {
        currentStep = step;
        this.dataset.step = String(step);
        captions.forEach((caption, index) => caption.setAttribute("aria-hidden", String(index !== step)));

      }
    };

    const animation = createScrollAnimation(
      () => Math.min(timelineEnd, Math.max(0, (window.scrollY - sectionTop) / scrollDistance * timelineEnd)),
      render,
      motion,
    );
    const { schedule } = animation;

    const measure = () => {
      const sticky = this.querySelector<HTMLElement>("section");
      sectionTop = this.getBoundingClientRect().top + window.scrollY;
      scrollDistance = Math.max(1, this.offsetHeight - (sticky?.offsetHeight ?? window.innerHeight));
      if (home && home.parentElement) {
        let contentHeight = 0;
        for (const child of home.querySelectorAll<HTMLElement>(":scope > *")) {
          if (child.offsetHeight === 0) continue;
          const style = window.getComputedStyle(child);
          contentHeight += child.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        }
        // Scale the app's component proportions together to fit the pinned viewport.
        this.style.setProperty("--home-scale", String(Math.min(1, (home.parentElement.clientHeight - 24) / Math.max(1, contentHeight))));
      }
      if (conversation && conversationWindow && explanation && check) {
        explanationTop = Math.max(0, explanation.offsetTop - conversation.offsetTop - 80);
        const checkPadding = Math.min(20, Math.max(0, (conversationWindow.clientHeight - check.offsetHeight) / 2));
        checkScroll = Math.max(explanationTop, check.offsetTop - conversation.offsetTop + check.offsetHeight + checkPadding - conversationWindow.clientHeight);
      }
      let documentScroll = 0;
      if (documentPane && documentBody && notes) {
        const notesTop = Math.max(0, notes.offsetTop - 55);
        documentScroll = Math.min(notesTop, Math.max(0, notesTop + notes.offsetHeight + documentBody.offsetTop * 2 - documentPane.clientHeight));
      }
      this.style.setProperty("--document-scroll-offset", `${-documentScroll}px`);
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true, signal: controller.signal });
    window.addEventListener("resize", measure, { signal: controller.signal });
    motion.addEventListener("change", schedule, { signal: controller.signal });
    const observer = new ResizeObserver(measure);
    observer.observe(this);
    if (conversationWindow) observer.observe(conversationWindow);
    measure();

    this.cleanup = () => {
      controller.abort();
      observer.disconnect();
      animation.cancel();
    };
  }

  cleanup = () => {};

  disconnectedCallback() {
    this.cleanup();
  }
}

if (!customElements.get("learning-demo")) customElements.define("learning-demo", LearningDemo);
