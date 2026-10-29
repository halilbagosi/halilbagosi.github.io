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

  // ───────────── No download on phones and tablets ─────────────
  // Snippets is a Mac app. The <head> script marks browsers whose user agent
  // names iOS or Android before first paint. Touch support is no signal:
  // Macs have touchscreens too (so iPadOS Safari, which says it is a Mac,
  // gets the button as well).

  if (root.dataset.device === "mobile") {
    document.querySelectorAll('a.btn[href$="Snippets.dmg"]').forEach((a) => {
      a.removeAttribute("href");
      a.classList.add("is-disabled");
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("role", "link");
    });
    document.querySelectorAll(".soon").forEach((p) => {
      p.textContent = "Snippets is a Mac app. Open this page on your Mac to download it.";
    });
  }

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

  // ───────────── Menu bar scenes: the panel opens from the scissors ─────────────
  // Opens once the scene is well in view, as if someone just clicked the
  // status item; after that the scissors toggle it, and a click on the
  // desktop closes it — the way the real panel behaves.

  const desks = [...document.querySelectorAll("[data-desk]")];
  const setOpen = (desk, open) => {
    desk.classList.toggle("is-open", open);
    desk.querySelector(".desk-scissors").setAttribute("aria-expanded", String(open));
  };
  const opener = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      opener.unobserve(target);
      setTimeout(() => setOpen(target, true), reduceMotion.matches ? 0 : 450);
    }
  }, { threshold: 0.55 });
  for (const desk of desks) {
    opener.observe(desk);
    const scissors = desk.querySelector(".desk-scissors");
    // Respond on press, not release (the real status item does).
    scissors.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      opener.unobserve(desk);
      setOpen(desk, !desk.classList.contains("is-open"));
    });
    scissors.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      opener.unobserve(desk);
      setOpen(desk, !desk.classList.contains("is-open"));
    });
    desk.addEventListener("pointerdown", (e) => {
      if (e.target === desk || e.target.classList.contains("desk-bg")) setOpen(desk, false);
    });
  }

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

  // ───────────── Continuous corners ─────────────
  // CSS rounds corners with circular arcs; Apple's continuous ("squircle")
  // corners ease into the curve instead. Safari has no corner-shape, so each
  // rounded element gets an even-odd clip path of three rings: a large
  // rectangle (so the drop shadow outside the box still shows), a circular
  // rounded rect, and the continuous shape, which cuts away whatever lies
  // between the two. The CSS radius is lowered to the largest circle that
  // still contains the continuous shape: Safari clips a composited glass
  // layer's backdrop by border-radius alone, not by the clip path. A CSS
  // border would be cut away with the corners, so it is redrawn on the
  // continuous outline as an SVG background layer.

  const SMOOTHING = 1;     // Figma corner smoothing: 1 = curvature ramps over the whole corner
  const BLEED = 80;        // room around the box for its drop shadow
  const touched = new WeakMap();
  const n = (v) => +v.toFixed(2);

  // Figma's squircle construction (figma-squircle, MIT): a circular arc in
  // the middle of each corner, eased into the edges by two cubic Béziers.
  function continuousPath(x, y, w, h, radius) {
    const max = Math.min(w, h) / 2;
    const R = Math.min(radius, max);
    const s = Math.max(0, Math.min(SMOOTHING, max / R - 1));
    const p = (1 + s) * R;
    const rad = (deg) => (deg * Math.PI) / 180;
    const arcMeasure = 90 * (1 - s);
    const arc = Math.sin(rad(arcMeasure / 2)) * R * Math.SQRT2;
    const c = R * Math.tan(rad((90 - arcMeasure) / 4)) * Math.cos(rad(45 * s));
    const d = c * Math.tan(rad(45 * s));
    const b = (p - arc - c - d) / 3;
    const a = 2 * b;
    const [A, AB, ABC, BC] = [a, a + b, a + b + c, b + c].map(n);
    const [D, C, ARC, RR] = [d, c, arc, R].map(n);
    return `M${n(x + w - p)} ${n(y)}c${A} 0 ${AB} 0 ${ABC} ${D}a${RR} ${RR} 0 0 1 ${ARC} ${ARC}c${D} ${C} ${D} ${BC} ${D} ${ABC}` +
      `L${n(x + w)} ${n(y + h - p)}c0 ${A} 0 ${AB} ${-D} ${ABC}a${RR} ${RR} 0 0 1 ${-ARC} ${ARC}c${-C} ${D} ${-BC} ${D} ${-ABC} ${D}` +
      `L${n(x + p)} ${n(y + h)}c${-A} 0 ${-AB} 0 ${-ABC} ${-D}a${RR} ${RR} 0 0 1 ${-ARC} ${-ARC}c${-D} ${-C} ${-D} ${-BC} ${-D} ${-ABC}` +
      `L${n(x)} ${n(y + p)}c0 ${-A} 0 ${-AB} ${D} ${-ABC}a${RR} ${RR} 0 0 1 ${ARC} ${-ARC}c${C} ${-D} ${BC} ${-D} ${ABC} ${-D}Z`;
  }

  // A capsule with continuous ends: each end is half a superellipse, so its
  // curvature starts at zero where it leaves the straight edge (a semicircle
  // jumps straight to full curvature there).
  const CAPSULE_EXPONENT = 2.5;
  const CAPSULE_REACH = 1.2;   // how far each end reaches along the edge, × radius
  function capsulePath(x, y, w, h) {
    const R = h / 2, k = Math.min(CAPSULE_REACH * R, w / 2), e = 2 / CAPSULE_EXPONENT;
    const pow = (v) => Math.sign(v) * Math.abs(v) ** e;
    const end = (cx, side) => {
      const pts = [];
      for (let i = 0; i <= 32; i++) {
        const t = Math.PI * (i / 32 - 0.5);   // -90° → 90°
        pts.push(`${n(cx + side * k * pow(Math.cos(t)))} ${n(y + R + side * R * pow(Math.sin(t)))}`);
      }
      return pts;
    };
    return `M${end(x + w - k, 1).join("L")}L${end(x + k, -1).join("L")}Z`;
  }

  function roundedPath(w, h, r) {
    r = n(r);
    return `M${r} 0H${n(w - r)}A${r} ${r} 0 0 1 ${n(w)} ${r}V${n(h - r)}A${r} ${r} 0 0 1 ${n(w - r)} ${n(h)}` +
      `H${r}A${r} ${r} 0 0 1 0 ${n(h - r)}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
  }

  // The largest circular corner radius whose rounded rect still contains
  // the outline `d`, found from points along its top-left corner.
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
  function containedRadius(d, w, h) {
    probe.setAttribute("d", d);
    const length = probe.getTotalLength(), pts = [];
    for (let i = 0; i <= 400; i++) {
      const q = probe.getPointAtLength((length * i) / 400);
      if (q.x < w / 2 && q.y < h / 2) pts.push(q);
    }
    const fits = (r) => pts.every((q) => q.x >= r || q.y >= r || (q.x - r) ** 2 + (q.y - r) ** 2 <= r * r + 0.01);
    let lo = 0, hi = Math.min(w, h) / 2;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; fits(mid) ? (lo = mid) : (hi = mid); }
    return lo;
  }

  // Top-level comma split: "url(a), linear-gradient(red, blue)" → 2 layers.
  function layers(value) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      else if (value[i] === "," && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; }
    }
    out.push(value.slice(start).trim());
    return out;
  }

  const PROPS = ["clipPath", "borderRadius", "borderColor", "backgroundImage", "backgroundSize", "backgroundRepeat", "backgroundOrigin", "backgroundPosition"];

  function reset(el) {
    if (!touched.has(el)) return;
    for (const prop of PROPS) el.style[prop] = "";
    touched.delete(el);
  }

  function shape(el) {
    reset(el);
    const cs = getComputedStyle(el);
    const radius = parseFloat(cs.borderTopLeftRadius);
    const w = el.offsetWidth, h = el.offsetHeight;
    if (cs.display === "inline" || !w || !h || !(radius >= 3)) return;
    const capsule = radius >= Math.min(w, h) / 2 - 0.5;
    if (capsule && w < h * 1.2) return;   // a circle, or nearly: leave it round
    const outline = (inset) => capsule
      ? capsulePath(inset, inset, w - 2 * inset, h - 2 * inset)
      : continuousPath(inset, inset, w - 2 * inset, h - 2 * inset, Math.max(0, radius - inset));

    const d = outline(0);
    const inner = containedRadius(d, w, h);
    el.style.borderRadius = `${n(inner)}px`;
    el.style.clipPath = `path(evenodd, "M${-BLEED} ${-BLEED}H${w + BLEED}V${h + BLEED}H${-BLEED}Z` +
      `${roundedPath(w, h, inner)}${d}")`;

    const bw = parseFloat(cs.borderTopWidth);
    const color = cs.borderTopColor;
    if (bw > 0 && !/rgba\(.*,\s*0\)$|transparent/.test(color)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path fill="none" stroke="${color}" stroke-width="${bw}" ` +
        `d="${outline(bw / 2)}"/></svg>`;
      const own = cs.backgroundImage === "none" ? [] : layers(cs.backgroundImage);
      const list = (value, fallback) => {
        const given = layers(value);
        return [fallback, ...own.map((_, i) => given[i % given.length])].join(", ");
      };
      el.style.backgroundImage = [`url("data:image/svg+xml,${encodeURIComponent(svg)}")`, ...own].join(", ");
      el.style.backgroundSize = list(cs.backgroundSize, "100% 100%");
      el.style.backgroundRepeat = list(cs.backgroundRepeat, "no-repeat");
      el.style.backgroundOrigin = list(cs.backgroundOrigin, "border-box");
      el.style.backgroundPosition = list(cs.backgroundPosition, "0% 0%");
      el.style.borderColor = "transparent";
    }
    touched.set(el, true);
  }

  if (window.ResizeObserver && CSS.supports("clip-path", 'path(evenodd, "M0 0H1V1Z")')) {
    const shaped = [];
    const sizes = new ResizeObserver((entries) => entries.forEach((e) => shape(e.target)));
    for (const el of document.body.querySelectorAll("*")) {
      if (el instanceof SVGElement) continue;
      const r = getComputedStyle(el).borderTopLeftRadius;
      if (r.includes("%") || !(parseFloat(r) >= 3)) continue;
      shaped.push(el);
      sizes.observe(el);
    }
    // Borders are baked into the SVG in the current theme's colour.
    const reshape = () => shaped.forEach(shape);
    new MutationObserver(reshape).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    systemDark.addEventListener("change", reshape);
  }

})();
