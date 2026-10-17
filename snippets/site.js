// Snippets site behaviour. Every page loads this with `defer`; the theme
// itself is applied by a one-line inline script in <head> before first paint
// (see THEME_BOOT in the pages) so there is never a flash of the wrong theme.

(() => {
  const root = document.documentElement;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const systemDark = matchMedia("(prefers-color-scheme: dark)");

  root.classList.add("js");

  // ───────────── Theme: auto / light / dark ─────────────

  const store = {
    get() { try { return localStorage.getItem("theme"); } catch { return null; } },
    set(v) { try { v ? localStorage.setItem("theme", v) : localStorage.removeItem("theme"); } catch {} },
  };

  const resolvedTheme = () =>
    root.dataset.theme || (systemDark.matches ? "dark" : "light");

  const toggle = document.querySelector(".theme-toggle");
  const choices = ["auto", "light", "dark"];

  function paintToggle() {
    if (!toggle) return;
    const choice = root.dataset.theme || "auto";
    const index = choices.indexOf(choice);
    toggle.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.choice === choice)));
    toggle.querySelector(".thumb").style.transform = `translateX(${index * 30}px)`;
  }

  function applyTheme(choice) {
    const commit = () => {
      if (choice === "auto") delete root.dataset.theme;
      else root.dataset.theme = choice;
      store.set(choice === "auto" ? null : choice);
      paintToggle();
      syncVideos();
    };
    // Ease the light↔dark change instead of jumping (a hard brightness flip
    // is what accessibility guidance says to avoid).
    if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(commit);
    else commit();
  }

  toggle?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-choice]");
    if (b) applyTheme(b.dataset.choice);
  });
  systemDark.addEventListener("change", () => { if (!root.dataset.theme) syncVideos(); });
  paintToggle();

  // ───────────── Nav material thickens once content scrolls under it ─────────────

  const nav = document.querySelector(".nav");
  const onScroll = () => nav?.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ───────────── Reveal on scroll ─────────────

  const groups = new Map();
  document.querySelectorAll(".reveal").forEach((el) => {
    // Stagger siblings that share a parent (DSMotion.staggeredEntrance).
    const parent = el.parentElement;
    const i = groups.get(parent) ?? 0;
    groups.set(parent, i + 1);
    el.style.setProperty("--i", i);
  });

  const revealer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      revealer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => revealer.observe(el));

  // ───────────── Videos: theme-matched source, play only while visible ─────────────

  const videos = [...document.querySelectorAll("video[data-src]")];

  function syncVideos() {
    const theme = resolvedTheme();
    for (const v of videos) {
      const base = v.dataset.src.replace("{theme}", theme);
      if (v.dataset.loaded === base) continue;
      v.dataset.loaded = base;
      const poster = v.dataset.poster?.replace("{theme}", theme);
      if (poster) v.poster = poster;
      v.innerHTML =
        `<source src="${base}.hevc.mp4" type='video/mp4; codecs="hvc1"'>` +
        `<source src="${base}.mp4" type="video/mp4">`;
      v.load();
      if (v.dataset.visible === "1" && !reduceMotion.matches) v.play().catch(() => {});
    }
  }

  const player = new IntersectionObserver((entries) => {
    for (const { target: v, isIntersecting } of entries) {
      v.dataset.visible = isIntersecting ? "1" : "0";
      if (!v.dataset.loaded && isIntersecting) syncVideos();
      if (isIntersecting && !reduceMotion.matches) v.play().catch(() => {});
      else v.pause();
    }
  }, { threshold: 0.25 });
  videos.forEach((v) => player.observe(v));

  // ───────────── Hero tilt: follows the pointer on a spring ─────────────
  // Per-axis springs (X and Y decomposed) integrated every frame, so the
  // window always moves from where it is now and can be redirected
  // mid-flight. Parameters match DSMotion.tilt (response 0.24, damping 0.74).

  const tilt = document.querySelector("[data-tilt]");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

  if (tilt && finePointer.matches) {
    const response = 0.24, damping = 0.74;
    const k = (2 * Math.PI / response) ** 2;
    const c = 4 * Math.PI * damping / response;
    const axes = { x: { v: 0, vel: 0, to: 0 }, y: { v: 0, vel: 0, to: 0 } };
    const MAX = 5; // degrees
    let raf = 0, last = 0;

    const step = (now) => {
      const dt = Math.min((now - last) / 1000 || 1 / 60, 1 / 30);
      last = now;
      let moving = false;
      for (const a of Object.values(axes)) {
        const force = -k * (a.v - a.to) - c * a.vel;
        a.vel += force * dt;
        a.v += a.vel * dt;
        if (Math.abs(a.v - a.to) > 0.001 || Math.abs(a.vel) > 0.001) moving = true;
      }
      tilt.style.transform =
        `perspective(1600px) rotateX(${axes.y.v.toFixed(3)}deg) rotateY(${axes.x.v.toFixed(3)}deg)`;
      raf = moving ? requestAnimationFrame(step) : 0;
    };
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); } };

    const area = tilt.closest("[data-tilt-area]") || tilt;
    area.addEventListener("pointermove", (e) => {
      if (reduceMotion.matches) return;
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      axes.x.to = Math.max(-1, Math.min(1, px * 2)) * MAX;
      axes.y.to = Math.max(-1, Math.min(1, py * 2)) * -MAX * 0.7;
      kick();
    });
    area.addEventListener("pointerleave", () => { axes.x.to = 0; axes.y.to = 0; kick(); });
  }

  // ───────────── Scroll parallax for floating panels ─────────────
  // transform-only, one rAF per scroll burst.

  const floaters = [...document.querySelectorAll("[data-parallax]")];
  if (floaters.length) {
    let ticking = false;
    const update = () => {
      ticking = false;
      if (reduceMotion.matches) return;
      const vh = innerHeight;
      for (const el of floaters) {
        const r = el.parentElement.getBoundingClientRect();
        const progress = (r.top + r.height / 2 - vh / 2) / vh; // 0 when centred
        el.style.translate = `0 ${(progress * parseFloat(el.dataset.parallax)).toFixed(1)}px`;
      }
    };
    addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ───────────── Copy-to-clipboard for the install command ─────────────

  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        const label = b.querySelector("span");
        const was = label.textContent;
        label.textContent = "copied";
        setTimeout(() => (label.textContent = was), 1400);
      } catch {}
    });
  });
})();
