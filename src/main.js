import "./style.css";
import { gsap } from "gsap";
import { Observer } from "gsap/Observer";

/*
 * PAPERCUT infinite index — virtual-scroll conductor.
 * Markup lives in index.html; static styling, theming vars and
 * first-paint staging live in style.css.
 *
 * The page does NOT scroll natively. An Observer collects wheel /
 * touch / drag / arrow-key input into an unbounded `target`; a lerp
 * eases `current` toward it every tick, and the content is translated
 * by `current` wrapped into the middle of three cloned copies. Because
 * the wrap happens in the modulo — never as a scroll jump — the loop
 * is seamless in both directions and can never glide backwards.
 *
 * Everything is derived from `current` in one ticker pass per frame:
 *   drum bend   rotateX + scale ladder from distance to centre
 *   unveil      clip-path slit opens as a row climbs to centre stage
 *   parallax    photo drifts/settles inside its card
 *   headline    fixed at viewport centre over the cards (blended in
 *               CSS), text = row crossing centre
 *   snap        on idle, target tweens to the next card centre in the
 *               travel direction — never backwards, so the settle can't
 *               rubber-band against the glide
 */

gsap.registerPlugin(Observer);

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

if (!reduceMotion) {
  document.documentElement.classList.add("is-live");

  const content = document.querySelector("#smooth-content");
  const list = document.querySelector(".index");
  const originals = gsap.utils.toArray(".row", list);
  const COPIES = 3;

  for (let c = 0; c < COPIES - 1; c++) {
    originals.forEach((row) => {
      const clone = row.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      list.appendChild(clone);
    });
  }

  const rows = gsap.utils.toArray(".row", list);
  const cards = rows.map((row) => ({
    el: row,
    media: row.querySelector(".row__media"),
    clip: row.querySelector(".row__clip"),
    lastClip: "",
  }));

  // --- tuning ------------------------------------------------------

  const MIN_VIS = 0.18; // edge cards open to this fraction of full height
  const MAX_NARROW = 8; // % clipped from each side at the viewport edges
  const CURVE = 1.8; // barrel exponent: flat at centre, bowing to the edges
  const EDGE_SAMPLES = 6; // polygon points per side tracing the curve
  const LADDER_ROWS = 1.7; // rows from centre until the ladder bottoms out
  const LERP = 3.8; // scroll ease (higher = tighter follow)
  const SNAP_DELAY = 200; // ms of quiet before snapping

  // --- layout maths (recomputed on resize) --------------------------

  let pitch = 0; // one row, top to top
  let copyH = 0; // one full copy of the list
  let rowTop0 = 0; // static top of row 0 inside the content
  let mediaMid = 0; // media centre measured from its row top
  let mediaH = 0; // full (centre-stage) card height
  let mediaW = 0; // card width (constant strips)
  let clipR = 0; // corner radius for the clip window (from --clip-r)
  let headH = 0; // label band: row top to media top
  let bandC = 0; // per-row constant chrome (labels + paddings)
  let vh = window.innerHeight;

  const measure = () => {
    vh = window.innerHeight;
    // offsetTop/offsetHeight are pure layout values — unlike rects they
    // can never be polluted by the transforms this engine applies
    pitch = rows[1].offsetTop - rows[0].offsetTop;
    copyH = pitch * originals.length;
    rowTop0 = rows[0].offsetTop;
    const m = cards[0].media;
    mediaH = m.offsetHeight;
    mediaW = m.offsetWidth;
    clipR =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--clip-r"),
      ) || 0;
    headH = m.offsetTop - rows[0].offsetTop;
    mediaMid = headH + mediaH / 2;
    bandC = pitch - mediaH;
  };

  // scroll position that puts card n dead-centre
  const snapPos = (n) => rowTop0 + mediaMid - vh / 2 + n * pitch;

  // --- virtual scroll state -----------------------------------------

  const pos = { current: 0, target: 0 };
  let snapTween = null;
  let lastInput = 0;
  let lastDir = 0;

  const onInput = (delta) => {
    lastInput = performance.now();
    if (snapTween) {
      snapTween.kill();
      snapTween = null;
    }
    pos.target += delta;
    if (delta) lastDir = Math.sign(delta);
  };

  Observer.create({
    target: window,
    type: "wheel,touch,pointer",
    preventDefault: true,
    onChangeY(self) {
      const wheel = self.event.type === "wheel";
      onInput(self.deltaY * (wheel ? 1 : -2.2));
    },
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "PageDown") onInput(pitch);
    else if (e.key === "ArrowUp" || e.key === "PageUp") onInput(-pitch);
  });

  const snap = () => {
    const frac = (pos.target - snapPos(0)) / pitch;
    // land on the next card centre IN the travel direction — nearest-card
    // rounding could pick a centre slightly behind an overshot glide and
    // drag the settle backwards, which read as a jerk ending every gesture
    const n =
      lastDir > 0
        ? Math.ceil(frac - 0.02)
        : lastDir < 0
          ? Math.floor(frac + 0.02)
          : Math.round(frac);
    const dest = snapPos(n);
    if (Math.abs(dest - pos.target) < 1) return;
    snapTween = gsap.to(pos, {
      target: dest,
      duration: 1.5,
      ease: "expo.out",
      onComplete: () => (snapTween = null),
    });
  };

  // --- fixed centre-stage headline ----------------------------------

  const titleEl = document.querySelector(".index-title");

  // The headline never moves — it sits dead-centre and only its text
  // value swaps when a new project takes the centreline.
  let currentTitle = "";
  const setActive = (row) => {
    const text = row.dataset.title;
    if (text === currentTitle) return;
    currentTitle = text;
    titleEl.textContent = text;
  };

  // Hover-to-reveal: the headline only shows while the pointer is over
  // the centre-stage card, whose rect is always a mediaW × mediaH box
  // dead-centre in the viewport. Touch devices have no hover, so there
  // the title stays permanently visible (CSS gates on hover: hover).
  if (window.matchMedia("(hover: hover)").matches) {
    window.addEventListener("pointermove", (e) => {
      const overCentre =
        Math.abs(e.clientX - window.innerWidth / 2) < mediaW / 2 &&
        Math.abs(e.clientY - vh / 2) < mediaH / 2;
      titleEl.classList.toggle("is-visible", overCentre);
    });
    document.documentElement.addEventListener("mouseleave", () =>
      titleEl.classList.remove("is-visible"),
    );
  }

  // --- the one render pass ------------------------------------------

  const wrap = gsap.utils.wrap(0, 1);

  // Ladder in row units from the continuous centre index: a card |u|
  // rows from centre opens to vis(u) of its full height.
  const visAt = (au) =>
    MIN_VIS + (1 - MIN_VIS) * (1 - Math.min(au, LADDER_ROWS) / LADDER_ROWS);

  let lastV = -1;

  const render = (force) => {
    // middle-copy translate: identical pixels on every wrap, no jump
    const v = copyH + wrap(pos.current / copyH) * copyH;
    // idle short-circuit: nothing moved since last frame → zero work
    if (!force && v === lastV) return;
    lastV = v;
    gsap.set(content, { y: -v });

    const mid = vh / 2;
    // fractional row index whose card centre sits on the centreline
    const f = (v + mid - rowTop0 - mediaMid) / pitch;

    // Exact pairwise placement: neighbouring centres sit half of each
    // card's visible height plus the label chrome apart, accumulated
    // outward from the pair straddling the centreline. (A continuous
    // integral of row height undershoots wherever a pair straddles the
    // ladder's bottom-out kink, letting a strip poke past the next
    // row's rule — accumulation makes overlap impossible.) Positions
    // depend only on i - f, so the three copies still tile seamlessly.
    const visArr = [];
    for (let i = 0; i < cards.length; i++) visArr.push(visAt(Math.abs(i - f)));
    const gapTo = (a, b) => bandC + (mediaH * (visArr[a] + visArr[b])) / 2;

    const posArr = new Array(cards.length);
    const j = gsap.utils.clamp(1, cards.length - 1, Math.ceil(f)); // i - f ∈ [0, 1)
    posArr[j] = mid + (j - f) * gapTo(j - 1, j);
    for (let i = j + 1; i < cards.length; i++)
      posArr[i] = posArr[i - 1] + gapTo(i - 1, i);
    for (let i = j - 1; i >= 0; i--)
      posArr[i] = posArr[i + 1] - gapTo(i, i + 1);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const u = i - f;

      const vis = visArr[i];
      const visH = vis * mediaH;
      const posC = posArr[i]; // card centre on screen
      const visTop = posC - visH / 2;

      // place the row so its label band sits tight above the open strip.
      // ALWAYS written: v wraps by a copy-height, so a stale row translate
      // would relocate a parked row a full copy away — into the viewport.
      const rowTopScreen = rowTop0 + i * pitch - v;
      gsap.set(card.el, { y: visTop - headH - rowTopScreen });

      // card effects can be skipped while parked offscreen
      if (!force && (visTop > vh * 1.3 || visTop + visH < -vh * 0.3)) continue;

      // Rolling window: the clip opens toward centre and slides across the
      // photo by position — cards above centre show the lower crop, cards
      // below the upper crop — so the image content rolls like a drum.
      const d = gsap.utils.clamp(-1, 1, u / LADDER_ROWS);
      const closed = 1 - vis;
      const topShare = 0.5 - 0.5 * d; // 1 above centre, 0 below
      const topT = closed * topShare * 100;
      const botT = closed * (1 - topShare) * 100;

      // pin the window's top edge to visTop no matter where it sits
      gsap.set(card.media, { y: -closed * topShare * mediaH });

      // Barrel sides + rounded corners: polygon() can't take a radius, so
      // the clip is an SVG path — the same ONE global narrowing curve of
      // screen position traces the sides, and a quadratic arc turns each
      // corner. path() is px-based; the clip box is exactly mediaW × mediaH,
      // so the % maths converts straight to px.
      const winTop = topT;
      const winH = 100 - topT - botT;
      const winHpx = (winH / 100) * mediaH; // visible window height in px
      const r = Math.min(clipR, winHpx / 2, mediaW / 4);
      const rf = winHpx > 0 ? r / winHpx : 0; // corner span as window fraction

      const yAt = (fk) => ((winTop + winH * fk) / 100) * mediaH;
      const lAt = (fk) => {
        const yScr = visTop + visH * fk; // same scanline on screen
        const n =
          MAX_NARROW *
          Math.pow(Math.min(1, Math.abs(yScr - mid) / (vh * 0.55)), CURVE);
        return (n / 100) * mediaW; // left inset in px; right = mediaW - this
      };

      const fx = (v) => v.toFixed(2);
      const y0 = yAt(0);
      const y1 = yAt(1);
      const l0 = lAt(0);
      const l1 = lAt(1);
      const seg = [`M ${fx(l0 + r)} ${fx(y0)}`];
      seg.push(`L ${fx(mediaW - l0 - r)} ${fx(y0)}`); // top edge
      seg.push(
        `Q ${fx(mediaW - l0)} ${fx(y0)} ${fx(mediaW - lAt(rf))} ${fx(yAt(rf))}`,
      );
      for (let k = 1; k < EDGE_SAMPLES; k++) {
        const fk = rf + (1 - 2 * rf) * (k / (EDGE_SAMPLES - 1)); // right side down
        seg.push(`L ${fx(mediaW - lAt(fk))} ${fx(yAt(fk))}`);
      }
      seg.push(
        `Q ${fx(mediaW - l1)} ${fx(y1)} ${fx(mediaW - l1 - r)} ${fx(y1)}`,
      );
      seg.push(`L ${fx(l1 + r)} ${fx(y1)}`); // bottom edge
      seg.push(`Q ${fx(l1)} ${fx(y1)} ${fx(lAt(1 - rf))} ${fx(yAt(1 - rf))}`);
      for (let k = 1; k < EDGE_SAMPLES; k++) {
        const fk = 1 - rf - (1 - 2 * rf) * (k / (EDGE_SAMPLES - 1)); // left side up
        seg.push(`L ${fx(lAt(fk))} ${fx(yAt(fk))}`);
      }
      seg.push(`Q ${fx(l0)} ${fx(y0)} ${fx(l0 + r)} ${fx(y0)}`, "Z");
      const clip = `path("${seg.join(" ")}")`;
      if (clip !== card.lastClip) {
        card.lastClip = clip;
        gsap.set(card.clip, { clipPath: clip });
      }
    }

    // headline belongs to the row nearest the centreline
    const active = rows[gsap.utils.clamp(0, rows.length - 1, Math.round(f))];
    if (active) setActive(active);
  };

  gsap.ticker.add((time, deltaMS) => {
    pos.current +=
      (pos.target - pos.current) * Math.min(1, (deltaMS / 1000) * LERP);
    // close out the lerp's asymptote so an idle page truly goes still
    if (Math.abs(pos.target - pos.current) < 0.02) pos.current = pos.target;
    if (!snapTween && performance.now() - lastInput > SNAP_DELAY) snap();
    render(false);
  });

  // --- boot + resize -------------------------------------------------

  measure();
  pos.current = pos.target = snapPos(originals.length); // middle copy, card 0 centred
  render(true);

  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const n = Math.round((pos.target - snapPos(0)) / pitch); // keep the same card
      measure();
      pos.current = pos.target = snapPos(n);
      render(true);
    }, 150);
  });
}
