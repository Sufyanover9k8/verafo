/* ============================================================================
   <verafo-flow> — the verdict diagram.

   Buyers arrive from the left as tiles, pass through the hub, and leave as three
   coloured verdict tiles on the right, each carrying its share of the traffic.

   One inline SVG, no libraries, requestAnimationFrame only.

   ---------------------------------------------------------------------------
   TWEAK HERE — everything worth changing lives in this one object.
   ---------------------------------------------------------------------------
*/
const VERAFO_FLOW = {
  /* SPEED: how often a dot appears, and how long it takes to cross a connector. */
  spawnEveryMs: [1000, 2000],
  travelMs: [1700, 2300],

  /* OUTCOME MIX. These must add up to 100. This is the only place the
     Safe / Neutral / Risky percentages are set — the chips on the connectors and
     the section's summary both read from here. */
  weights: { safe: 60, neutral: 25, risky: 15 },

  /* Float amplitude, and the range each node picks its loop length from. */
  floatPx: 5,
  floatPxMobile: 3,
  floatMs: [3000, 6000],

  /* Two compositions of the same diagram.

     A composition this wide cannot fill a narrow column — at 475px its labels
     rendered at about 8px — so below portraitAt the same shapes are laid out on
     a taller canvas and the viewBox follows. Nothing is squashed; the diagram is
     composed for the space it is in.

     Edit either block to move things. Everything else reads from these. */
  wide: {
    /* The panel is narrower than the column now, because a drawer takes the rest
       of it. Everything inside is therefore drawn a little larger so the labels
       and chips still land at a readable size at the width this actually
       renders at. */
    viewBox: '0 0 1000 520',
    customers: [
      { x: 172, y: 93, label: 'Lahore', phone: '2288' },
      { x: 156, y: 215, label: 'Karachi', phone: '8207' },
      { x: 176, y: 337, label: 'Rawalpindi', phone: '1190' },
      { x: 160, y: 459, label: 'Faisalabad', phone: '7714' }
    ],
    hub: { x: 500, y: 276, badge: 50 },
    /* The concentric glow behind the badge. */
    rings: [104, 154],
    outcomes: [
      { id: 'safe', x: 850, y: 156, label: 'Safe' },
      { id: 'neutral', x: 850, y: 276, label: 'Neutral' },
      { id: 'risky', x: 850, y: 396, label: 'Risky' }
    ],
    tile: 76,            /* side of a node tile */
    labelSize: 21, labelGap: 16,
    chipW: 62, chipH: 28, chipSize: 16,
    /* Left chips carry the phone fragment; on the narrow composition there is no
       room for them, so they are switched off there. */
    leftChips: true,
    hubSize: 22
  },

  portraitAt: 620,
  tall: {
    /* Four rows have to fit the tile, the gap and the label that sits above each
       one. The row pitch must therefore exceed tile + gap + label size, or a
       label lands on the tile above it — which is what happened at 102 units. */
    viewBox: '0 0 600 560',
    customers: [
      { x: 100, y: 88, label: 'Lahore', phone: '2288' },
      { x: 100, y: 218, label: 'Karachi', phone: '8207' },
      { x: 100, y: 348, label: 'Rawalpindi', phone: '1190' },
      { x: 100, y: 478, label: 'Faisalabad', phone: '7714' }
    ],
    hub: { x: 300, y: 283, badge: 50 },
    rings: [82, 114],
    outcomes: [
      { id: 'safe', x: 470, y: 142, label: 'Safe' },
      { id: 'neutral', x: 470, y: 283, label: 'Neutral' },
      { id: 'risky', x: 470, y: 424, label: 'Risky' }
    ],
    tile: 84,
    labelSize: 21, labelGap: 16,
    chipW: 62, chipH: 28, chipSize: 17,
    leftChips: false,
    hubSize: 23
  }

  /* Colours are not here on purpose. They live in styles.css under the .vf-*
     rules, so the diagram is styled from CSS rather than from JS. */
};

/* Distance from the centre of a square to its edge along a unit direction. */
function boxEdge(ux, uy, half) {
  const m = Math.max(Math.abs(ux), Math.abs(uy)) || 1;
  return half / m;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function svgEl(tag, attrs, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

/* A quadratic whose control point sits off the straight line, so the connector
   bends rather than sagging. `bend` is that offset in viewBox units. */
function curveBetween(a, b, bend) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = { x: mx + (-dy / len) * bend, y: my + (dx / len) * bend };
  return {
    c,
    d: 'M' + a.x.toFixed(1) + ',' + a.y.toFixed(1) +
       ' Q' + c.x.toFixed(1) + ',' + c.y.toFixed(1) +
       ' ' + b.x.toFixed(1) + ',' + b.y.toFixed(1)
  };
}

/* Point on a quadratic at t. Matches the Q path above. */
function pointOn(a, c, b, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
  };
}

function hexPoints(cx, cy, r) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    out.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
  }
  return out.join(' ');
}

class VerafoFlow extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;

    const C = VERAFO_FLOW;
    this._C = C;
    /* Reduced motion: draw the final diagram once and stop. No float, no dots. */
    this._reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    this._build();
    this._layout();

    this._onResize = () => this._layout();
    window.addEventListener('resize', this._onResize);

    if (this._reduce) {
      this._drawFrame(0);
      return;
    }

    this._dots = [];
    this._hubPulse = 0;
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._tick(t));
    this._scheduleSpawn();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    clearTimeout(this._spawnTimer);
    window.removeEventListener('resize', this._onResize);
  }

  /* ---------------- build ---------------- */
  _build() {
    const C = VERAFO_FLOW;
    const L = this._layoutFor(C);
    this._L = L;

    const svg = svgEl('svg', {
      viewBox: L.viewBox,
      class: 'vflow__svg',
      role: 'img',
      'aria-label': 'Four buyers from across Pakistan flow into Verafo and come out labelled Safe, Neutral or Risky, with the share each verdict takes.'
    });

    /* Every colour comes from CSS, not from a presentation attribute, so the
       diagram is styled from styles.css and nowhere else. The markup carries
       classes and geometry only. */
    const defs = svgEl('defs');
    const grad = (id, stops) => {
      const g = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0.35', y2: '1' });
      stops.forEach(([offset, cls]) => g.appendChild(svgEl('stop', { offset, class: cls })));
      defs.appendChild(g);
    };
    grad(this._id('tile'), [['0%', 'vf-tile-a'], ['100%', 'vf-tile-b']]);
    grad(this._id('safe'), [['0%', 'vf-safe-a'], ['100%', 'vf-safe-b']]);
    grad(this._id('neutral'), [['0%', 'vf-neutral-a'], ['100%', 'vf-neutral-b']]);
    grad(this._id('risky'), [['0%', 'vf-risky-a'], ['100%', 'vf-risky-b']]);
    grad(this._id('badge'), [['0%', 'vf-badge-a'], ['100%', 'vf-badge-b']]);

    /* The glow behind the badge, as a soft radial wash. */
    const glow = svgEl('radialGradient', { id: this._id('glow') });
    glow.appendChild(svgEl('stop', { offset: '0%', class: 'vf-glow-a' }));
    glow.appendChild(svgEl('stop', { offset: '55%', class: 'vf-glow-b' }));
    glow.appendChild(svgEl('stop', { offset: '100%', class: 'vf-glow-c' }));
    defs.appendChild(glow);

    svg.appendChild(defs);

    const half = L.tile / 2;
    this._half = half;

    /* Concentric rings behind the badge, like a radar sweep settling. */
    this._rings = (L.rings || []).map((r) => {
      const c = svgEl('circle', { cx: L.hub.x, cy: L.hub.y, r, class: 'vf-ringglow' });
      svg.appendChild(c);
      return c;
    });
    this._glow = svgEl('circle', {
      cx: L.hub.x, cy: L.hub.y, r: (L.rings && L.rings[L.rings.length - 1]) || 120,
      class: 'vf-glow', fill: 'url(#' + this._id('glow') + ')'
    });
    svg.appendChild(this._glow);

    /* Connectors go under everything else. */
    this._lineLayer = svgEl('g', { class: 'vf-lines' });
    svg.appendChild(this._lineLayer);

    this._leftArrows = L.customers.map((c, i) => {
      const p = svgEl('path', { fill: 'none', class: 'vf-line vf-line--in', 'data-key': 'c' + i });
      this._lineLayer.appendChild(p);
      return p;
    });

    this._rightArrows = L.outcomes.map((o, i) => {
      const p = svgEl('path', {
        fill: 'none', class: 'vf-line vf-line--out vf-line--' + o.id, 'data-key': 'o' + i
      });
      this._lineLayer.appendChild(p);
      return p;
    });

    /* A chip riding each connector. On the right it carries the share; on the
       left the phone fragment, so the two sides read as one flow of information
       rather than a decorated arrow. */
    this._chips = [];
    const makeChip = (text, variant, w) => {
      const g = svgEl('g', { class: 'vf-chip' });
      g.appendChild(svgEl('rect', {
        x: -w / 2, y: -L.chipH / 2, width: w, height: L.chipH, rx: L.chipH / 2,
        class: 'vf-chip__bg vf-chip__bg--' + variant
      }));
      g.appendChild(svgEl('text', {
        x: 0, y: L.chipSize * 0.36, 'text-anchor': 'middle',
        class: 'vf-chip__text vf-chip__text--' + variant,
        'font-size': String(L.chipSize),
        'font-family': 'Inter, system-ui, sans-serif'
      }, text));
      svg.appendChild(g);
      return g;
    };

    const leftChips = [];
    if (L.leftChips) {
      L.customers.forEach((c) => leftChips.push(makeChip(c.phone, 'in', L.chipW)));
    }
    this._chips.push(...leftChips);

    const w = C.weights;
    const shares = [w.safe + '%', w.neutral + '%', w.risky + '%'];
    const rightChips = L.outcomes.map((o, i) => makeChip(shares[i], o.id, L.chipW));
    this._chips.push(...rightChips);
    this._leftChipCount = leftChips.length;

    /* The hub: badge, brand mark, wordmark. */
    const hubGroup = svgEl('g', { class: 'vf-hubwrap' });
    this._hubGroup = hubGroup;
    this._hubShape = svgEl('circle', {
      cx: L.hub.x, cy: L.hub.y, r: L.hub.badge,
      class: 'vf-hub', fill: 'url(#' + this._id('badge') + ')'
    });
    hubGroup.appendChild(this._hubShape);
    hubGroup.appendChild(svgEl('polygon', {
      points: hexPoints(L.hub.x, L.hub.y, L.hub.badge * 0.62), class: 'vf-glyph'
    }));
    hubGroup.appendChild(svgEl('text', {
      x: L.hub.x, y: L.hub.y + L.hub.badge + L.hubSize + 6, 'text-anchor': 'middle',
      class: 'vf-hubname', 'font-size': String(L.hubSize), 'font-weight': '700',
      'font-family': 'Inter, system-ui, sans-serif'
    }, 'Verafo'));
    svg.appendChild(hubGroup);

    /* Buyer tiles. */
    this._customerGroups = L.customers.map((c, i) => {
      const g = svgEl('g', { class: 'vf-node vf-node--buyer', 'data-key': 'c' + i });
      const halo = svgEl('rect', {
        x: c.x - half - 9, y: c.y - half - 9,
        width: (half + 9) * 2, height: (half + 9) * 2, rx: half * 0.55,
        class: 'vf-halo', 'fill-opacity': '0', 'stroke-opacity': '0', 'stroke-width': '2'
      });
      g.appendChild(halo);
      g.appendChild(svgEl('rect', {
        x: c.x - half, y: c.y - half, width: L.tile, height: L.tile, rx: half * 0.42,
        class: 'vf-tile', fill: 'url(#' + this._id('tile') + ')'
      }));
      /* A person, sized to the tile: a bare square read as a generic box. */
      const s = (half * 0.68) / 30;
      const ico = svgEl('g', {
        class: 'vf-icon',
        transform: 'translate(' + c.x + ' ' + c.y + ') scale(' + s.toFixed(3) + ')'
      });
      ico.appendChild(svgEl('circle', { cx: '0', cy: '-9', r: '6.4', 'stroke-width': '2.4' }));
      ico.appendChild(svgEl('path', {
        d: 'M-11,13 V9.5 a11,9 0 0 1 22,0 V13 Z', 'stroke-width': '2.4', fill: 'none'
      }));
      g.appendChild(ico);
      g.appendChild(svgEl('text', {
        x: c.x, y: c.y - half - L.labelGap, 'text-anchor': 'middle',
        class: 'vf-label', 'font-size': String(L.labelSize),
        'font-family': 'Inter, system-ui, sans-serif'
      }, c.label));
      svg.appendChild(g);
      (this._customerRings || (this._customerRings = [])).push(halo);
      return g;
    });

    /* Verdict tiles. */
    this._outGroups = L.outcomes.map((o, i) => {
      const g = svgEl('g', { class: 'vf-node vf-node--out', 'data-key': 'o' + i });
      const shape = svgEl('rect', {
        x: o.x - half, y: o.y - half, width: L.tile, height: L.tile, rx: half * 0.42,
        class: 'vf-tile', fill: 'url(#' + this._id(o.id) + ')'
      });
      g.appendChild(shape);

      /* A wash that brightens when a buyer lands in this verdict. */
      const lit = svgEl('rect', {
        x: o.x - half, y: o.y - half, width: L.tile, height: L.tile, rx: half * 0.42,
        class: 'vf-lit', 'fill-opacity': '0'
      });
      g.appendChild(lit);

      const s = (half * 0.72) / 30;
      const ico = svgEl('g', {
        class: 'vf-icon vf-icon--' + o.id,
        transform: 'translate(' + o.x + ' ' + o.y + ') scale(' + s.toFixed(3) + ')'
      });
      /* Three glyphs drawn to the same weight and the same reach, so they read as
         a set. Each path may carry its own stroke width, which the exclamation's
         dot needs — as a one-unit dash it rendered as a speck, not a dot. */
      const ICONS = {
        /* A tick with a short lead-in and a long, firm upstroke. The plainest
           reading of safe; weighed rather than casual. */
        safe: [{ d: 'M-13,1 L-4,10 L14,-12' }],
        /* A tilde — "about the same". A single flat dash said nothing at all. */
        neutral: [{ d: 'M-13,0 C-9,-9 -4,-9 0,0 C4,9 9,9 13,0' }],
        /* An exclamation as a bar plus a real dot. */
        risky: [{ d: 'M0,-13 L0,1' }, { d: 'M0,10 L0,10.01', w: 5.6 }]
      };
      ICONS[o.id].forEach((spec) => ico.appendChild(svgEl('path', {
        d: spec.d, 'stroke-width': String(spec.w || 3.6), fill: 'none'
      })));
      g.appendChild(ico);

      g.appendChild(svgEl('text', {
        x: o.x, y: o.y - half - L.labelGap, 'text-anchor': 'middle',
        class: 'vf-label', 'font-size': String(L.labelSize),
        'font-family': 'Inter, system-ui, sans-serif'
      }, o.label));
      svg.appendChild(g);
      return { g, shape, lit };
    });

    this._dotLayer = svgEl('g');
    svg.appendChild(this._dotLayer);

    this._svg = svg;
    this._wireFocus();
    this.appendChild(svg);
  }

  /* Gradient ids must be unique; one instance per page today, but a page could
     hold two and identical ids would have the second reading the first. */
  _id(name) {
    if (!this._prefix) this._prefix = 'vf' + Math.random().toString(36).slice(2, 7);
    return this._prefix + '-' + name;
  }

  /* Hovering a buyer or a verdict dims the routes that are not that one.
     Clicking pins the highlight; clicking again releases it. Touch gets the tap
     behaviour for free. */
  _wireFocus() {
    const svg = this._svg;
    const set = (key) => {
      if (key) svg.setAttribute('data-focus', key);
      else svg.removeAttribute('data-focus');
    };
    const clear = () => set(this._pinned || null);

    svg.querySelectorAll('.vf-node').forEach((g) => {
      const key = g.getAttribute('data-key');
      g.addEventListener('pointerenter', () => set(key));
      g.addEventListener('pointerleave', clear);
      g.addEventListener('click', () => {
        this._pinned = this._pinned === key ? null : key;
        set(this._pinned || key);
      });
    });
  }

  /* ---------------- per-node float state ---------------- */
  _layoutFor(C) {
    const w = this.getBoundingClientRect().width || window.innerWidth;
    return w < C.portraitAt ? C.tall : C.wide;
  }

  _layout() {
    const C = VERAFO_FLOW;
    const L = this._L;
    const narrow = this.getBoundingClientRect().width < 640;
    this._amp = narrow ? C.floatPxMobile : C.floatPx;

    if (this._nodes) return;

    /* Each node gets its own periods and phases so nothing moves in step.
       `pulse` is set when a dot leaves this buyer, and decays each frame. */
    this._nodes = L.customers.map((c, i) => ({
      g: this._customerGroups[i],
      ring: this._customerRings[i],
      x: c.x, y: c.y, ox: 0, oy: 0,
      px: rand(...C.floatMs) / 1000,
      py: rand(...C.floatMs) / 1000,
      fx: rand(0, Math.PI * 2),
      fy: rand(0, Math.PI * 2),
      pulse: 0
    }));

    this._outs = L.outcomes.map((o, i) => ({
      g: this._outGroups[i].g,
      shape: this._outGroups[i].shape,
      lit: 0,
      x: o.x, y: o.y, ox: 0, oy: 0,
      px: rand(...C.floatMs) / 1000,
      py: rand(...C.floatMs) / 1000,
      fx: rand(0, Math.PI * 2),
      fy: rand(0, Math.PI * 2)
    }));
  }

  /* ---------------- connectors follow the nodes ---------------- */
  _drawArrows() {
    const L = this._L;
    const half = this._half;

    /* Buyers in. Dotted and neutral: nothing is decided yet. */
    this._nodes.forEach((n, i) => {
      const ax = n.x + n.ox, ay = n.y + n.oy;
      const dx = L.hub.x - ax, dy = L.hub.y - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const start = { x: ax + ux * boxEdge(ux, uy, half), y: ay + uy * boxEdge(ux, uy, half) };
      const end = {
        x: L.hub.x - ux * L.hub.badge,
        y: L.hub.y - uy * L.hub.badge
      };
      const cv = curveBetween(start, end, 26 * (i < 2 ? -1 : 1));
      this._leftArrows[i].setAttribute('d', cv.d);
      n.curve = { a: start, c: cv.c, b: end };

      const chip = this._chips[i];
      if (chip) {
        const at = pointOn(start, cv.c, end, 0.56);
        chip.setAttribute('transform', 'translate(' + at.x.toFixed(1) + ',' + at.y.toFixed(1) + ')');
      }
    });

    /* Verdicts out. Solid, and coloured to match the tile it reaches. */
    this._outs.forEach((o, i) => {
      const bx = o.x + o.ox, by = o.y + o.oy;
      const dx = bx - L.hub.x, dy = by - L.hub.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const start = {
        x: L.hub.x + ux * L.hub.badge,
        y: L.hub.y + uy * L.hub.badge
      };
      const end = {
        x: bx - ux * boxEdge(ux, uy, half + 2),
        y: by - uy * boxEdge(ux, uy, half + 2)
      };
      const cv = curveBetween(start, end, i === 0 ? 18 : i === 2 ? -18 : 0);
      this._rightArrows[i].setAttribute('d', cv.d);
      o.curve = { a: start, c: cv.c, b: end };

      const chip = this._chips[this._leftChipCount + i];
      if (chip) {
        const at = pointOn(start, cv.c, end, 0.46);
        chip.setAttribute('transform', 'translate(' + at.x.toFixed(1) + ',' + at.y.toFixed(1) + ')');
      }
    });
  }

  /* ---------------- positions at a moment in time ---------------- */
  _floatNow(sec) {
    const amp = this._amp;
    this._nodes.forEach((n) => {
      n.ox = Math.sin((sec / n.px) * Math.PI * 2 + n.fx) * amp;
      n.oy = Math.cos((sec / n.py) * Math.PI * 2 + n.fy) * amp;
      n.g.setAttribute('transform', 'translate(' + n.ox.toFixed(2) + ',' + n.oy.toFixed(2) + ')');
    });
    this._outs.forEach((o) => {
      o.ox = Math.sin((sec / o.px) * Math.PI * 2 + o.fx) * amp;
      o.oy = Math.cos((sec / o.py) * Math.PI * 2 + o.fy) * amp;
      o.g.setAttribute('transform', 'translate(' + o.ox.toFixed(2) + ',' + o.oy.toFixed(2) + ')');
    });
    this._drawArrows();
  }

  /* Static frame for reduced motion: every node at rest, connectors drawn once.
     The amplitude is zeroed, because at t=0 each node's phase still produces an
     offset of a few units and the spec asks for the diagram, not a nudged
     version of it. */
  _drawFrame() {
    this._amp = 0;
    this._floatNow(0);
  }

  /* ---------------- dots ---------------- */
  _pickOutcome() {
    const w = VERAFO_FLOW.weights;
    const total = w.safe + w.neutral + w.risky;
    let r = Math.random() * total;
    if ((r -= w.safe) < 0) return 0;
    if ((r -= w.neutral) < 0) return 1;
    return 2;
  }

  _scheduleSpawn() {
    const [lo, hi] = VERAFO_FLOW.spawnEveryMs;
    this._spawnTimer = setTimeout(() => {
      if (this._dots.length < 30) this._spawn();
      this._scheduleSpawn();
    }, rand(lo, hi));
  }

  _spawn() {
    const [lo, hi] = VERAFO_FLOW.travelMs;
    const from = Math.floor(Math.random() * this._nodes.length);
    const to = this._pickOutcome();
    const dot = svgEl('circle', {
      r: '4', class: 'vf-dot vf-dot--' + this._L.outcomes[to].id, opacity: '0'
    });
    this._dotLayer.appendChild(dot);
    /* The buyer that sent this one reacts, so the flow reads as cause and effect
       rather than dots appearing from nowhere. */
    this._nodes[from].pulse = 1;
    this._dots.push({ from, to, leg: 0, t: 0, dur: rand(lo, hi), el: dot });
  }

  /* ---------------- frame ---------------- */
  _tick(now) {
    const dt = Math.min(64, now - this._last);
    this._last = now;

    this._floatNow(now / 1000);

    for (let i = this._dots.length - 1; i >= 0; i--) {
      const d = this._dots[i];
      d.t = Math.min(1, d.t + dt / d.dur);

      const leg = d.leg === 0 ? this._nodes[d.from].curve : this._outs[d.to].curve;
      if (!leg) { d.el.remove(); this._dots.splice(i, 1); continue; }

      const p = pointOn(leg.a, leg.c, leg.b, d.t);
      d.el.setAttribute('cx', p.x.toFixed(1));
      d.el.setAttribute('cy', p.y.toFixed(1));
      /* Fade in on the way in, fade out as it lands. */
      const fade = d.leg === 0 ? Math.min(1, d.t * 6) : d.t > 0.85 ? (1 - d.t) / 0.15 : 1;
      d.el.setAttribute('opacity', Math.max(0, Math.min(1, fade)).toFixed(2));

      if (d.t >= 1) {
        if (d.leg === 0) {
          d.leg = 1;
          d.t = 0;
          this._hubPulse = 1;
        } else {
          this._outs[d.to].lit = 1;
          d.el.remove();
          this._dots.splice(i, 1);
        }
      }
    }

    /* A verdict tile brightens briefly when a buyer lands in it. */
    this._outs.forEach((o) => {
      if (o.lit > 0.001) {
        o.lit = Math.max(0, o.lit - dt / 700);
        const t = this._outGroups[this._outs.indexOf(o)];
        if (t && t.lit) t.lit.setAttribute('fill-opacity', (0.30 * o.lit).toFixed(3));
      }
    });

    /* Buyer halo: a ring blooms outward for a moment when a buyer sends one. */
    this._nodes.forEach((n) => {
      if (n.pulse > 0.001) {
        n.pulse = Math.max(0, n.pulse - dt / 900);
        const k = n.pulse;
        if (n.ring) {
          n.ring.setAttribute('fill-opacity', (0.10 * k).toFixed(3));
          n.ring.setAttribute('stroke-opacity', (0.45 * k).toFixed(3));
        }
      }
    });

    /* Hub pulse: the badge and its mark breathe together, and the glow behind
       them brightens. Only the opacity of the glow moves, so its colour stays
       whatever CSS says.

       The centre comes from the active layout object — reading VERAFO_FLOW.hub
       directly threw once the two compositions existed, and the throw was
       swallowed inside the animation frame, so the pulse silently never
       happened. */
    if (this._hubPulse > 0) {
      this._hubPulse = Math.max(0, this._hubPulse - dt / 520);
      const k = this._hubPulse;
      const s = 1 + 0.05 * k;
      const h = this._L.hub;
      if (this._hubGroup) {
        this._hubGroup.setAttribute('transform',
          'translate(' + h.x + ' ' + h.y + ') scale(' + s.toFixed(3) +
          ') translate(' + (-h.x) + ' ' + (-h.y) + ')');
      }
      if (this._glow) this._glow.style.opacity = (1 + 0.9 * k).toFixed(3);
    } else {
      if (this._hubGroup && this._hubGroup.hasAttribute('transform')) {
        this._hubGroup.removeAttribute('transform');
      }
      if (this._glow && this._glow.style.opacity !== '1') this._glow.style.opacity = '1';
    }

    this._raf = requestAnimationFrame((t) => this._tick(t));
  }
}

if (!customElements.get('verafo-flow')) {
  customElements.define('verafo-flow', VerafoFlow);
}
