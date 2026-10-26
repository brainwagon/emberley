/*!
 * emberley.js - felt-tip "Make a World" drawings for p5.js
 *
 * Draws little Ed Emberley-style figures (built from circles, lines,
 * triangles and dots) with a felt-tip marker look, animates them being
 * drawn step by step, and then brings them to life (wheels roll, legs
 * walk, flags wave, smoke puffs).
 *
 * Needs only p5.js.  Works in instance mode (pass the sketch `p`) or
 * global mode (pass nothing, or `window`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Emberley = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const VARIANTS = 3;        // hand-drawn "boil" frames per stroke
  const STEP = 2;            // resample spacing, local units
  const PEN_LIFT = 14;       // pause between book steps, in ink units
  const FILL_COST = 0.15;    // scribbling is faster than outlining
  const MAX_FILL = 110;      // ...and big areas get coloured briskly
  const INK_ALPHA = 0.9;
  const FILL_ALPHA = 1;      // flat colour; lines and fills match exactly
  const PERSON_M = 1.75;     // natural sizing: a person this tall...
  const PERSON_UNITS = 100;  // ...is drawn this many units tall
  const MIN_SIZE = 14;       // nothing is drawn smaller than this

  // ------------------------------------------------------------------
  // Random numbers
  // ------------------------------------------------------------------
  function rng32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash() {
    const s = Array.prototype.join.call(arguments, '|');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ------------------------------------------------------------------
  // Palettes.  Items refer to colours by these names, so a palette
  // only has to supply the same eight keys.
  // ------------------------------------------------------------------
  // Each palette has the same keys; items name colours, not hex codes.
  // 'makeaworld' is sampled from the cover of Make a World: four inks
  // (red, sky blue, green, black) plus a warm grey and a sage green on
  // white.  The red is pushed more saturated than the cover's #e24a25,
  // and a sunny yellow is added to match.  The book has no orange or
  // brown, so those map to red and grey.
  const palettes = {
    makeaworld: {
      paper: '#fbfbf8', black: '#1f1f1f', red: '#e3241b',
      orange: '#e3241b', yellow: '#fcc30b', green: '#40ac48',
      blue: '#03ade5', brown: '#9f9390', grey: '#9f9390', sage: '#79b881'
    },
    classic: {
      paper: '#f6f0e1', black: '#24201d', red: '#d8402c',
      orange: '#ee8a2a', yellow: '#f4c430', green: '#3b9a4c',
      blue: '#2f64b6', brown: '#8a5733', grey: '#9a918a', sage: '#86b97f'
    },
    retro: {
      paper: '#f2e8d2', black: '#2d2a26', red: '#c4523e',
      orange: '#dc8d48', yellow: '#e3bf4a', green: '#5e8c5a',
      blue: '#3f6d9c', brown: '#7b5537', grey: '#948a7c', sage: '#93ad83'
    },
    riso: {
      paper: '#f7f4ec', black: '#1e1e24', red: '#ff4f9a',
      orange: '#ff7a4a', yellow: '#ffd800', green: '#00a95c',
      blue: '#0078bf', brown: '#9a5b4f', grey: '#88898a', sage: '#7fc29b'
    },
    duotone: {
      paper: '#f5efe3', black: '#1f2a44', red: '#e2493b',
      orange: '#e2493b', yellow: '#e2493b', green: '#1f2a44',
      blue: '#1f2a44', brown: '#1f2a44', grey: '#1f2a44', sage: '#e2493b'
    }
  };

  // ------------------------------------------------------------------
  // Point helpers.  Paths are flat arrays: [x0, y0, x1, y1, ...]
  // Local units: an item is roughly 100 units tall, y grows downward,
  // ground items stand on y = 0.
  // ------------------------------------------------------------------
  function resample(pts, step, closed) {
    const src = closed ? pts.concat(pts[0], pts[1]) : pts;
    const out = [src[0], src[1]];
    for (let i = 2; i < src.length; i += 2) {
      const x0 = src[i - 2], y0 = src[i - 1], x1 = src[i], y1 = src[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let j = 1; j <= n; j++) {
        out.push(x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n);
      }
    }
    return out;
  }

  function cumLengths(pts) {
    const n = pts.length / 2;
    const c = new Float32Array(Math.max(1, n));
    for (let i = 1; i < n; i++) {
      c[i] = c[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2],
                                   pts[2 * i + 1] - pts[2 * i - 1]);
    }
    return c;
  }

  function ellipsePts(cx, cy, rx, ry, a0, sweep, step) {
    const per = Math.PI * (rx + ry) * Math.abs(sweep) / TAU;
    const n = Math.max(10, Math.ceil(per / step));
    const out = [];
    for (let j = 0; j <= n; j++) {
      const a = a0 + sweep * j / n;
      out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    }
    return out;
  }

  function catmull(pts, closed, segs) {
    const n = pts.length / 2;
    const P = (i) => {
      if (closed) i = ((i % n) + n) % n;
      else i = Math.max(0, Math.min(n - 1, i));
      return [pts[2 * i], pts[2 * i + 1]];
    };
    const out = [];
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let s = 0; s < segs; s++) {
        const t = s / segs, t2 = t * t, t3 = t2 * t;
        for (let k = 0; k < 2; k++) {
          out.push(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t +
            (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
            (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
        }
      }
    }
    const e = closed ? P(0) : P(n - 1);
    out.push(e[0], e[1]);
    return out;
  }

  // Hand wobble: a slow sideways drift along the stroke plus a small
  // overall misregistration, both scaled to the pen.
  function wobble(pts, amp, rnd) {
    const n = pts.length / 2;
    if (n < 2 || amp === 0) return pts.slice();
    const cum = cumLengths(pts);
    const wl1 = 45 + rnd() * 45, wl2 = 11 + rnd() * 9;
    const p1 = rnd() * TAU, p2 = rnd() * TAU;
    const sx = (rnd() - 0.5) * amp * 1.2, sy = (rnd() - 0.5) * amp * 1.2;
    const out = new Array(pts.length);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1];
      const len = Math.hypot(dx, dy) || 1;
      const s = cum[i];
      const o = amp * (0.75 * Math.sin(s / wl1 * TAU + p1) +
                       0.35 * Math.sin(s / wl2 * TAU + p2));
      out[2 * i] = pts[2 * i] - dy / len * o + sx;
      out[2 * i + 1] = pts[2 * i + 1] + dx / len * o + sy;
    }
    return out;
  }

  // Marker colouring: one continuous back-and-forth zigzag across the
  // shape's bounding box, later clipped to the shape.
  function scribble(shape, spacing, angle, rnd) {
    const c = Math.cos(angle), s = Math.sin(angle);
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < shape.length; i += 2) {
      const u = shape[i] * c + shape[i + 1] * s;
      const v = -shape[i] * s + shape[i + 1] * c;
      if (u < umin) umin = u; if (u > umax) umax = u;
      if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    }
    const out = [];
    let k = 0;
    for (let v = vmin - spacing * 0.4; v <= vmax + spacing * 0.6; v += spacing, k++) {
      const u = (k % 2 ? umax + spacing * 0.6 : umin - spacing * 0.6) +
                (rnd() - 0.5) * spacing * 1.2;
      const vv = v + (rnd() - 0.5) * spacing * 0.4;
      out.push(u * c - vv * s, u * s + vv * c);
    }
    return out;
  }

  function rotPts(pts, a, cx, cy) {
    const c = Math.cos(a), s = Math.sin(a), out = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] - cx, y = pts[i + 1] - cy;
      out.push(cx + x * c - y * s, cy + x * s + y * c);
    }
    return out;
  }
  function mirrorX(pts) {
    const out = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) out.push(-pts[i], pts[i + 1]);
    return out;
  }

  // ------------------------------------------------------------------
  // Animation helpers for item parts.  Every function receives
  // (t, item): t = seconds alive, item.dist = local units travelled.
  // ------------------------------------------------------------------
  const anim = {
    spin: (speed, px = 0, py = 0) =>
      ({ pivot: [px, py], rot: (t) => t * speed }),
    roll: (r, px = 0, py = 0) =>
      ({ pivot: [px, py], rot: (t, it) => it.dist / r }),
    swing: (amp, freq, px = 0, py = 0, phase = 0) =>
      ({ pivot: [px, py], rot: (t) => amp * Math.sin(TAU * freq * t + phase) }),
    gait: (amp, stride, px = 0, py = 0, phase = 0) =>
      ({ pivot: [px, py], rot: (t, it) => amp * Math.sin(TAU * it.dist / stride + phase) }),
    bob: (amp, freq, phase = 0) =>
      ({ dy: (t) => amp * Math.sin(TAU * freq * t + phase) }),
    flap: (freq, px = 0, py = 0, axis = 'y', min = -1) => {
      const f = (t) => min + (1 - min) * (0.5 + 0.5 * Math.cos(TAU * freq * t));
      return axis === 'y' ? { pivot: [px, py], sy: f } : { pivot: [px, py], sx: f };
    },
    flicker: (amp, freq, px = 0, py = 0) => ({
      pivot: [px, py],
      sy: (t) => 1 + amp * (0.6 * Math.sin(TAU * freq * t) +
                            0.4 * Math.sin(TAU * freq * 2.7 * t + 1))
    }),
    // Deforms points relative to the pivot: a travelling wave that
    // grows with distance from the pivot (flags, banners, tails).
    wave: (amp, wl, speed, px = 0, py = 0) => ({
      pivot: [px, py],
      deform: (x, y, t) => [x, y + amp * Math.min(1, Math.abs(x) / wl) *
                            Math.sin(x / wl * TAU - t * speed)]
    }),
    // A smoke puff or bubble that rises, grows and fades on a loop.
    puff: (period, rise, drift, phase = 0, px = 0, py = 0) => {
      const u = (t) => ((t / period + phase) % 1 + 1) % 1;
      return {
        pivot: [px, py],
        dx: (t) => drift * u(t), dy: (t) => -rise * u(t),
        sx: (t) => 0.5 + u(t), sy: (t) => 0.5 + u(t),
        alpha: (t) => 1 - u(t)
      };
    }
  };

  // ------------------------------------------------------------------
  // Builder: the drawing vocabulary item definitions use.
  // d.step() starts a new book step; shapes take an options object:
  //   { fill, ink, w, part, hatch, knock, fillAlpha, density }
  // fill/ink are palette names (or CSS colours).  A filled shape is
  // solid colour with no outline; shapes and lines cover what is under
  // them like flat printed colour (knock), rather than mixing;
  // unfilled shapes and lines default to black ink.  Setting ink on a
  // filled shape adds an outline; w scales line width; part attaches
  // the shape to an animated part; knock: false lets colours mix like
  // marker ink; fillAlpha and density make a fill lighter or sparser
  // (1 = normal).
  // ------------------------------------------------------------------
  class Builder {
    constructor(rnd) {
      this.rnd = rnd;
      this.prims = [];
      this.parts = {};
      this.stepIdx = 0;
      this.maxStep = 0;
      this._used = false;
      this._part = null;
      this.ox = 0; this.oy = 0;
      this.prefix = '';
      this._uid = 0;
    }
    step() {
      if (this._used) { this.stepIdx++; this._used = false; }
      return this;
    }
    part(name, spec) {
      const s = Object.assign({}, spec);
      const pv = s.pivot || [0, 0];
      s.pivot = [pv[0] + this.ox, pv[1] + this.oy];
      if (s.parent) s.parent = this.prefix + s.parent;
      this.parts[this.prefix + name] = s;
      return this;
    }
    in(part, fn) {
      const prev = this._part;
      this._part = this.prefix + part;
      fn();
      this._part = prev;
      return this;
    }
    at(dx, dy, fn) {
      this.ox += dx; this.oy += dy;
      fn();
      this.ox -= dx; this.oy -= dy;
      return this;
    }
    // Draw another registered item inside this one.
    use(name, dx, dy, opts) {
      const def = registry[name];
      if (!def) throw new Error('Emberley: unknown item "' + name + '"');
      const save = [this.prefix, this._part];
      this.prefix = this.prefix + name + (this._uid++) + '.';
      this._part = null;
      this.at(dx, dy, () => def.build(this, Object.assign({}, def.defaults, opts)));
      [this.prefix, this._part] = save;
      return this;
    }

    _shift(arr) {
      if (!this.ox && !this.oy) return arr;
      const r = arr.slice();
      for (let i = 0; i < r.length; i += 2) { r[i] += this.ox; r[i + 1] += this.oy; }
      return r;
    }
    _add(kind, outline, closed, shape, o) {
      o = o || {};
      const fill = o.fill && o.fill !== 'none' ? o.fill : null;
      // Emberley style: a filled shape is solid colour with no outline;
      // only unfilled shapes and lines default to black ink.
      const ink = o.ink === undefined ? (fill ? null : 'black')
        : (o.ink === 'none' || o.ink === null ? null : o.ink);
      this.prims.push({
        kind, closed, fill, ink,
        outline: this._shift(outline),
        shape: shape ? this._shift(shape) : null,
        w: o.w == null ? 1 : o.w,
        part: o.part ? this.prefix + o.part : this._part,
        step: this.stepIdx,
        hatch: o.hatch == null ? -0.75 + (this.rnd() - 0.5) * 0.6 : o.hatch,
        knock: o.knock != null ? !!o.knock : kind !== 'dot',
        fillAlpha: o.fillAlpha,
        density: o.density || 1,
        dotR: o.r,
        variants: []
      });
      this._used = true;
      this.maxStep = Math.max(this.maxStep, this.stepIdx);
      return this;
    }

    ellipse(x, y, rx, ry, o) {
      const a0 = -Math.PI / 2 - 0.9 + this.rnd() * 0.8;
      const out = ellipsePts(x, y, rx, ry, a0, -(TAU + 0.22), STEP);
      const shape = ellipsePts(x, y, rx, ry, 0, TAU, STEP);
      shape.length -= 2;
      return this._add('ellipse', out, true, shape, o);
    }
    circle(x, y, r, o) { return this.ellipse(x, y, r, r, o); }
    poly(pts, o) {
      const out = resample(pts, STEP, true);
      return this._add('poly', out, true, out.slice(0, -2), o);
    }
    rect(x, y, w, h, o) { return this.poly([x, y, x + w, y, x + w, y + h, x, y + h], o); }
    tri(x1, y1, x2, y2, x3, y3, o) { return this.poly([x1, y1, x2, y2, x3, y3], o); }
    path(pts, o) {
      const out = resample(pts, STEP, false);
      return this._add('path', out, false, o && o.fill ? out : null, o);
    }
    line(x1, y1, x2, y2, o) { return this.path([x1, y1, x2, y2], o); }
    curve(pts, o) {
      const out = resample(catmull(pts, false, 8), STEP, false);
      return this._add('path', out, false, o && o.fill ? out : null, o);
    }
    blob(pts, o) {
      const out = resample(catmull(pts, true, 8), STEP, false);
      return this._add('poly', out, true, out.slice(0, -2), o);
    }
    arc(x, y, r, a0, a1, o) {
      const out = ellipsePts(x, y, r, r, a0, a1 - a0, STEP);
      return this._add('path', out, false, o && o.fill ? out : null, o);
    }
    dot(x, y, o) {
      o = Object.assign({}, o);
      const r = o.r || 1.8;
      const pts = [];
      const ph = this.rnd() * TAU;
      for (let j = 0; j < 12; j++) {
        const a = j / 12 * TAU;
        const rr = r * (1 + 0.12 * Math.sin(a * 2 + ph));
        pts.push(x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      return this._add('dot', pts, true, null, o);
    }
    zigzag(x1, y1, x2, y2, n, amp, o) {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, pts = [];
      for (let i = 0; i <= n * 2; i++) {
        const f = i / (n * 2), s = i % 2 ? amp : 0;
        pts.push(x1 + dx * f + nx * s, y1 + dy * f + ny * s);
      }
      return this.path(pts, o);
    }
    spiral(x, y, r, turns, o) {
      const pts = [], n = Math.ceil(turns * 40);
      for (let i = 0; i <= n; i++) {
        const f = i / n, a = f * turns * TAU - Math.PI / 2;
        pts.push(x + r * f * Math.cos(a), y + r * f * Math.sin(a));
      }
      return this.path(pts, o);
    }
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  // One hand-drawn rendition of a primitive.  k = local units per px.
  function makeVariant(pr, seed, k, world) {
    const rnd = rng32(seed);
    const amp = world.wobble * k * (pr.kind === 'dot' ? 0.3 : 1);
    const v = {};
    v.out = wobble(pr.outline, amp, rnd);
    v.outCum = cumLengths(v.out);
    v.outLen = v.outCum[v.outCum.length - 1];
    if (pr.shape) {
      v.shape = wobble(pr.shape, amp * 0.5, rnd);
      if (pr.fill) {
        const fw = world.penWidth * 1.9 * k;
        v.scr = scribble(v.shape, fw * 0.5 / pr.density, pr.hatch + (rnd() - 0.5) * 0.12, rnd);
        v.scrCum = cumLengths(v.scr);
        v.scrLen = v.scrCum[v.scrCum.length - 1];
      }
    }
    return v;
  }

  function tracePath(ctx, pts, closed) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (closed) ctx.closePath();
  }

  // Strokes the first `prog` (0..1) of a path; returns the pen tip
  // when the stroke is unfinished.
  function strokePart(ctx, pts, cum, prog) {
    const n = pts.length / 2;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    if (prog >= 1) {
      for (let i = 1; i < n; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
      ctx.stroke();
      return null;
    }
    const target = prog * cum[n - 1];
    let tip = [pts[0], pts[1]];
    for (let i = 1; i < n; i++) {
      if (cum[i] <= target) {
        ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
        tip = [pts[2 * i], pts[2 * i + 1]];
      } else {
        const f = (target - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        const x = pts[2 * i - 2] + (pts[2 * i] - pts[2 * i - 2]) * f;
        const y = pts[2 * i - 1] + (pts[2 * i + 1] - pts[2 * i - 1]) * f;
        ctx.lineTo(x, y);
        tip = [x, y];
        break;
      }
    }
    ctx.stroke();
    return tip;
  }

  function deformPts(pts, fn, pivot, t, it) {
    const out = new Array(pts.length), px = pivot[0], py = pivot[1];
    for (let i = 0; i < pts.length; i += 2) {
      const r = fn(pts[i] - px, pts[i + 1] - py, t, it);
      out[i] = r[0] + px; out[i + 1] = r[1] + py;
    }
    return out;
  }

  function colour(pal, name) {
    if (!name) return null;
    return pal[name] || name;
  }

  // Draws one primitive.  Returns { x, y, color } while unfinished.
  function renderPrim(ctx, pr, v, pal, lw, fw, outP, fillP, fx, alpha) {
    const D = fx ? (pts) => deformPts(pts, fx.fn, fx.pivot, fx.t, fx.it) : (pts) => pts;
    let tip = null;
    if (pr.kind === 'dot') {
      if (pr.knock) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pal.paper;
        tracePath(ctx, D(v.out), true);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 0.95 * alpha;
      ctx.fillStyle = colour(pal, pr.ink || 'black');
      tracePath(ctx, D(v.out), true);
      ctx.fill();
      return null;
    }
    // Knockout: a flat-colour fill covers what is under it.  It only
    // covers what the pen has reached so far, so a shape being drawn
    // never shows as a paper-white silhouette erasing earlier steps.
    if (pr.knock && pr.fill && v.shape && outP > 0) {
      const done = fillP >= 1 || !v.scr;
      if (done || fillP > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
        tracePath(ctx, D(v.shape), true);
        if (done) {
          ctx.fillStyle = pal.paper;
          ctx.fill();
        } else {
          ctx.clip();
          ctx.strokeStyle = pal.paper;
          ctx.lineWidth = fw;
          strokePart(ctx, D(v.scr), v.scrCum, fillP);
        }
        ctx.restore();
      }
    }
    const fc = colour(pal, pr.fill);
    if (fc && v.scr && fillP > 0) {
      ctx.save();
      tracePath(ctx, D(v.shape), true);
      ctx.clip();
      ctx.globalAlpha = (pr.fillAlpha != null ? pr.fillAlpha : FILL_ALPHA) * alpha;
      ctx.strokeStyle = fc;
      ctx.lineWidth = fw;
      const t = strokePart(ctx, D(v.scr), v.scrCum, fillP);
      ctx.restore();
      if (t) tip = { x: t[0], y: t[1], color: fc };
    }
    const ic = colour(pal, pr.ink);
    if (ic && outP > 0) {
      const pts = D(v.out);
      const w = lw * pr.w;
      ctx.strokeStyle = ic;
      ctx.lineWidth = w;
      if (pr.knock) {
        // flat colour: the line covers what it crosses instead of
        // darkening it, so a grey trunk over a grey head stays one grey
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
        const t = strokePart(ctx, pts, v.outCum, outP);
        ctx.restore();
        return t ? { x: t[0], y: t[1], color: ic } : tip;
      }
      ctx.globalAlpha = INK_ALPHA * alpha;
      const t = strokePart(ctx, pts, v.outCum, outP);
      // marker ink pools where the pen lands and lifts
      ctx.globalAlpha = 0.28 * alpha;
      ctx.fillStyle = ic;
      ctx.beginPath();
      ctx.arc(pts[0], pts[1], w * 0.62, 0, TAU);
      if (!t && !pr.closed) {
        const n = pts.length;
        ctx.moveTo(pts[n - 2] + w * 0.6, pts[n - 1]);
        ctx.arc(pts[n - 2], pts[n - 1], w * 0.6, 0, TAU);
      }
      ctx.fill();
      if (t) tip = { x: t[0], y: t[1], color: ic };
    }
    return tip;
  }

  function val(f, t, it, dflt) {
    if (f == null) return dflt;
    return typeof f === 'function' ? f(t, it) : f;
  }

  function applyPart(ctx, parts, name, t, it, acc) {
    const a = parts[name];
    if (!a) return acc;
    if (a.parent) applyPart(ctx, parts, a.parent, t, it, acc);
    const px = a.pivot[0], py = a.pivot[1];
    const dx = val(a.dx, t, it, 0), dy = val(a.dy, t, it, 0);
    const r = val(a.rot, t, it, 0);
    let sx = val(a.sx, t, it, 1), sy = val(a.sy, t, it, 1);
    if (Math.abs(sx) < 0.03) sx = sx < 0 ? -0.03 : 0.03;
    if (Math.abs(sy) < 0.03) sy = sy < 0 ? -0.03 : 0.03;
    ctx.translate(px + dx, py + dy);
    if (r) ctx.rotate(r);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.translate(-px, -py);
    if (a.alpha != null) acc.alpha *= clamp01(val(a.alpha, t, it, 1));
    if (a.deform) acc.fx = { fn: a.deform, pivot: a.pivot, t, it };
    return acc;
  }

  // A felt-tip marker drawn at the pen tip, in screen space.
  function drawMarker(ctx, m, tip, pd) {
    const X = m.a * tip.x + m.c * tip.y + m.e;
    const Y = m.b * tip.x + m.d * tip.y + m.f;
    ctx.save();
    ctx.setTransform(pd, 0, 0, pd, X, Y);
    ctx.rotate(-0.95);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(12, 2, 46, 11, 4) : ctx.rect(12, 2, 46, 11);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#2a2622';
    ctx.fillStyle = tip.color;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(9, -3.5); ctx.lineTo(9, 3.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fbf8f1';
    ctx.beginPath();
    ctx.rect(9, -5.5, 30, 11);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = tip.color;
    ctx.beginPath();
    ctx.rect(39, -6, 15, 12);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Motions: how a whole item moves once it has been drawn.
  // speed is in screen px per second.
  // ------------------------------------------------------------------
  const motions = {
    still() {},
    sway(it, dt) {
      it.rot = 0.035 * Math.sin(it.t * 1.2 + it.seed % 11);
    },
    drive(it, dt) {
      it.move(dt);
      it.oy = -Math.abs(Math.sin(it.dist / 9)) * 0.7 * it.scale;
    },
    walk(it, dt) {
      it.move(dt);
      it.oy = -Math.abs(Math.cos(TAU * it.dist / (it.stride || 34))) * 2 * it.scale;
    },
    crawl(it, dt) { it.move(dt); },
    fly(it, dt) {
      it.move(dt);
      const ph = it.seed % 17;
      it.oy = Math.sin(it.t * 1.3 + ph) * 10 * it.scale;
      it.rot = Math.cos(it.t * 1.3 + ph) * 0.06;
    },
    flutter(it, dt) {
      it.move(dt);
      const ph = it.seed % 13;
      it.oy = (Math.sin(it.t * 2.1 + ph) * 14 + Math.sin(it.t * 5.3) * 4) * it.scale;
    },
    hover(it, dt) {
      it.move(dt);
      it.oy = Math.sin(it.t * 1.7) * 4 * it.scale;
      it.rot = 0.08 + Math.sin(it.t * 0.9) * 0.03;
    },
    swim(it, dt) {
      it.move(dt);
      it.oy = Math.sin(it.t * 1.6 + it.seed % 7) * 5 * it.scale;
      it.rot = Math.cos(it.t * 1.6 + it.seed % 7) * 0.08;
    },
    sail(it, dt) {
      it.move(dt);
      it.oy = Math.sin(it.t * 1.6 + it.seed % 5) * 1.6 * it.scale;
      it.rot = Math.sin(it.t * 1.1 + it.seed % 5) * 0.05;
    },
    float(it, dt) {
      it.move(dt);
      it.oy = Math.sin(it.t * 0.7 + it.seed % 5) * 8 * it.scale;
      it.rot = Math.sin(it.t * 0.5) * 0.03;
    },
    drift(it, dt) { it.move(dt); },
    launch(it, dt) {
      const wait = 3;
      const tt = it.t - wait;
      it.launching = tt > 0;
      if (tt <= 0) { it.oy = 0; it.ox = 0; return; }
      it.oy = -45 * tt * tt * it.scale;
      it.ox = (Math.random() - 0.5) * 1.2 * it.scale;
      if (it.y + it.oy < -130 * it.scale) it.t = 0;
    }
  };

  // ------------------------------------------------------------------
  // Item: one placed, animated drawing.
  // ------------------------------------------------------------------
  class Item {
    constructor(world, name, opts) {
      const def = registry[name];
      if (!def) throw new Error('Emberley: unknown item "' + name + '"');
      this.world = world;
      this.name = name;
      this.def = def;
      const o = Object.assign({}, def.defaults, opts);
      this.opts = o;
      this.x = o.x || 0;
      this.y = o.y || 0;
      // scale multiplies the item's natural size (see World.naturalScale)
      this.natural = o.natural === false ? 1 : world.naturalScale(def);
      this.scale = (o.scale || 1) * this.natural;
      this.facing = o.facing === -1 || o.facing === 'left' ? -1 : 1;
      this.motion = o.motion || def.motion || 'still';
      this.speed = o.speed != null ? o.speed : (def.speed || 0);
      this.layer = o.layer != null ? o.layer : (def.layer != null ? def.layer : 2);
      this.z = o.z || 0;
      this.seed = o.seed != null ? o.seed : (world.rnd() * 1e9) | 0;
      this.animate = o.animate !== false;
      this.steps = o.steps != null ? o.steps : Infinity;
      this.from = o.from || 0;
      this.stride = def.stride || 34;
      this.size = def.size || [80, 100];
      if (o.width) this.size = [o.width, this.size[1]];
      this.penWidth = o.penWidth;
      this.dist = 0; this.t = 0;
      this.ox = 0; this.oy = 0; this.rot = 0;
      this.build();
      this.redraw(o.delay || 0, o.instant);
    }

    build() {
      const d = new Builder(rng32(this.seed));
      this.def.build(d, this.opts);
      this.prims = d.prims;
      this.parts = d.parts;
      this.nSteps = d.maxStep + 1;
      let c = 0, last = -1;
      this.prims.forEach((pr, i) => {
        pr.idx = i;
        pr.skip = pr.step >= this.steps;
        if (pr.skip) return;
        if (pr.step < this.from) { pr.t0 = pr.t1 = pr.t2 = -1; return; }
        if (pr.step !== last) { if (last >= 0) c += PEN_LIFT; last = pr.step; }
        const v = this.variant(pr, 0);
        pr.t0 = c;
        c += pr.kind === 'dot' ? 3 : (pr.ink ? v.outLen : 0);
        pr.t1 = c;
        c += pr.fill && v.scr ? Math.min(MAX_FILL, v.scrLen * FILL_COST) : 0;
        pr.t2 = c;
      });
      this.total = c;
    }

    variant(pr, i) {
      if (!pr.variants[i]) {
        pr.variants[i] = makeVariant(pr, hash(this.seed, pr.idx, i),
                                     this.pen() / this.world.penWidth / this.scale,
                                     this.world);
      }
      return pr.variants[i];
    }
    pen() { return this.penWidth || this.world.penWidth; }

    // Start drawing again (after `delay` seconds).
    redraw(delay, instant) {
      const ppx = this.opts.drawTime
        ? this.total / Math.max(0.05, this.opts.drawTime)
        : this.world.inkSpeed / this.scale;
      this.rate = ppx;
      this.wait = delay || 0;
      this.ink = instant ? this.total : 0;
      this.t = 0;
      this.drawn = !!instant;
      return this;
    }
    get drawTime() { return this.total / this.rate; }

    move(dt) {
      const step = this.speed * dt;
      this.x += step * this.facing;
      this.dist += step / this.scale;
      if (!this.world.wrap) return;
      const W = this.world.p.width;
      const half = this.size[0] / 2 * this.scale + 10;
      if (this.facing > 0 && this.x - half > W) this.x = -half;
      if (this.facing < 0 && this.x + half < 0) this.x = W + half;
    }

    update(dt) {
      if (this.wait > 0) { this.wait -= dt; return; }
      if (this.ink < this.total) {
        this.ink = Math.min(this.total, this.ink + dt * this.rate);
        if (this.ink < this.total) return;
      }
      if (!this.drawn) { this.drawn = true; if (this.opts.onDrawn) this.opts.onDrawn(this); }
      if (!this.animate) return;
      this.t += dt * (this.opts.animSpeed || 1);
      const m = typeof this.motion === 'function' ? this.motion : motions[this.motion];
      if (m) m(this, dt, this.world);
    }

    draw(ctx, now, tips) {
      if (this.wait > 0 && this.from === 0) return;
      const w = this.world, pal = w.pal;
      const k = 1 / this.scale;
      const lw = this.pen() * k;
      const fw = this.pen() * 1.9 * k;
      const vi = w.boil ? (Math.floor(now * w.boilRate + (this.seed % 5) / 5) % VARIANTS) : 0;
      const t = this.t;
      ctx.save();
      ctx.translate(this.x + this.ox, this.y + this.oy);
      if (this.rot) ctx.rotate(this.rot * this.facing);
      ctx.scale(this.scale * this.facing, this.scale);
      let tip = null;
      for (const pr of this.prims) {
        if (pr.skip) continue;
        let outP = 1, fillP = 1;
        if (pr.t0 >= 0) {
          outP = pr.t1 > pr.t0 ? clamp01((this.ink - pr.t0) / (pr.t1 - pr.t0)) : (this.ink >= pr.t0 ? 1 : 0);
          fillP = pr.t2 > pr.t1 ? clamp01((this.ink - pr.t1) / (pr.t2 - pr.t1)) : (this.ink >= pr.t1 ? 1 : 0);
          if (pr.t1 === pr.t0 && this.ink > pr.t0) outP = 1;
        }
        if (outP <= 0 && fillP <= 0) continue;
        const v = this.variant(pr, vi);
        const hasPart = pr.part && this.parts[pr.part];
        let acc = { alpha: 1, fx: null };
        if (hasPart) { ctx.save(); acc = applyPart(ctx, this.parts, pr.part, t, this, acc); }
        const tp = renderPrim(ctx, pr, v, pal, lw, fw, outP, fillP, acc.fx, acc.alpha);
        if (tp) tip = { m: ctx.getTransform(), tip: tp };
        if (hasPart) ctx.restore();
      }
      ctx.restore();
      if (tip && tips) tips.push(tip);
    }
  }

  // ------------------------------------------------------------------
  // World: a set of items sharing a canvas, palette and pen.
  // ------------------------------------------------------------------
  class World {
    constructor(p, o) {
      o = o || {};
      this.p = p && p.drawingContext !== undefined ? p
        : (typeof p5 !== 'undefined' && p5.instance) || p;
      if (!this.p) throw new Error('Emberley: pass your p5 sketch to createWorld()');
      this.setPalette(o.palette || 'makeaworld');
      this.penWidth = o.penWidth || 2.6;
      this.wobble = o.wobble != null ? o.wobble : 0.9;
      this.boil = o.boil !== false;
      this.boilRate = o.boilRate || 5;
      this.inkSpeed = o.inkSpeed || 200;
      this.showPen = o.showPen !== false;
      this.paper = o.paper !== false;
      this.wrap = o.wrap !== false;
      this.sizes = o.sizes !== false;
      this.sizeExponent = o.sizeExponent != null ? o.sizeExponent : 0.45;
      this.items = [];
      this.rnd = rng32(o.seed != null ? o.seed : (Math.random() * 1e9) | 0);
      this.time = 0;
      this._paper = null;
      this.pen = makePen(this);
    }

    setPalette(p) {
      this.pal = typeof p === 'string'
        ? Object.assign({}, palettes[p] || palettes.makeaworld)
        : Object.assign({}, palettes.makeaworld, p);
      this._paper = null;
      return this;
    }

    add(name, opts) {
      const it = new Item(this, name, opts || {});
      this.items.push(it);
      return it;
    }
    remove(it) {
      const i = this.items.indexOf(it);
      if (i >= 0) this.items.splice(i, 1);
      return this;
    }
    clear() { this.items.length = 0; return this; }

    // Re-run the drawing animation for every item.
    redraw(stagger) {
      this.items.forEach((it, i) => it.redraw((stagger || 0) * i));
      return this;
    }

    // Relative sizes.  Each item definition gives `real`, its height in
    // metres, and items are scaled so a 1.75 m person is 100 units tall.
    // True scale would make a castle ten people tall and a ladybug
    // invisible, so sizes are compressed like a picture book's:
    // size = 100 * (metres / 1.75) ^ sizeExponent.  sizeExponent 1 is
    // true scale; 0 draws everything the same height.  Returns the
    // factor applied on top of an item's own `scale` option.
    naturalScale(def) {
      if (typeof def === 'string') def = registry[def];
      if (!this.sizes || !def || !def.real) return 1;
      const target = Math.max(MIN_SIZE,
        PERSON_UNITS * Math.pow(def.real / PERSON_M, this.sizeExponent));
      return target / drawnHeight(def);
    }

    // The book's step-by-step strip: one panel per step, each panel
    // adding a step to the one before.  Returns the panel items.
    strip(name, x, y, o) {
      o = o || {};
      const scale = o.scale || 1;
      const seed = o.seed != null ? o.seed : (this.rnd() * 1e9) | 0;
      const probe = new Item(this, name, Object.assign({}, o, { seed, instant: true }));
      const n = probe.nSteps;
      const cell = (o.cell || probe.size[0] + 24) * probe.scale;
      let delay = o.delay || 0;
      const out = [];
      for (let i = 0; i < n; i++) {
        const last = i === n - 1;
        const it = this.add(name, Object.assign({}, o, {
          x: x + i * cell, y, scale, seed, steps: i + 1, from: i,
          motion: 'still', animate: last && !!o.alive, delay
        }));
        delay += it.drawTime + (o.pause != null ? o.pause : 0.35);
        out.push(it);
      }
      return out;
    }

    update(dt) {
      if (dt == null) dt = Math.min(0.05, (this.p.deltaTime || 16) / 1000);
      this.time += dt;
      for (const it of this.items) it.update(dt);
      return this;
    }

    drawPaper() {
      const p = this.p, ctx = p.drawingContext;
      const pd = p.pixelDensity ? p.pixelDensity() : 1;
      const W = Math.ceil(p.width * pd), H = Math.ceil(p.height * pd);
      if (!this._paper || this._paper.width !== W || this._paper.height !== H) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        g.fillStyle = this.pal.paper;
        g.fillRect(0, 0, W, H);
        const r = rng32(7);
        for (let i = 0; i < W * H / 260; i++) {
          g.globalAlpha = 0.035 + r() * 0.05;
          g.fillStyle = r() < 0.5 ? '#000' : '#fff';
          g.fillRect(r() * W, r() * H, 1 + r() * 1.5 * pd, 1 + r() * 1.5 * pd);
        }
        g.globalAlpha = 0.05;
        g.strokeStyle = '#7a6a50';
        for (let i = 0; i < W * H / 9000; i++) {
          const x = r() * W, y = r() * H, a = r() * TAU, l = (4 + r() * 10) * pd;
          g.beginPath();
          g.moveTo(x, y);
          g.quadraticCurveTo(x + Math.cos(a + 1) * l / 2, y + Math.sin(a + 1) * l / 2,
                             x + Math.cos(a) * l, y + Math.sin(a) * l);
          g.stroke();
        }
        this._paper = c;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this._paper, 0, 0);
      ctx.restore();
      return this;
    }

    drawItems() {
      const p = this.p, ctx = p.drawingContext;
      const pd = p.pixelDensity ? p.pixelDensity() : 1;
      const order = this.items.slice().sort((a, b) =>
        (a.layer - b.layer) || (a.z - b.z) || (a.y - b.y));
      const tips = [];
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const it of order) it.draw(ctx, this.time, tips);
      ctx.restore();
      if (this.showPen) for (const t of tips) drawMarker(ctx, t.m, t.tip, pd);
      return this;
    }

    draw() {
      if (this.paper) this.drawPaper();
      return this.drawItems();
    }

    // update + draw: call once from your p5 draw().
    frame() { return this.update().draw(); }

    // The topmost item under a screen point (rough, by bounding box).
    itemAt(x, y) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i], s = it.scale;
        const sky = it.def.origin === 'center';
        const hw = it.size[0] / 2 * s, h = it.size[1] * s;
        const top = sky ? it.y - h / 2 : it.y - h, bot = sky ? it.y + h / 2 : it.y;
        if (x > it.x - hw && x < it.x + hw && y > top && y < bot) return it;
      }
      return null;
    }
  }

  // Immediate-mode felt pen: world.pen.circle(x, y, r, { fill: 'red' })
  // draws straight away at the current p5 transform.  Shapes are cached
  // by their arguments so they keep their hand-drawn wobble.
  function makePen(world) {
    const cache = new Map();
    const api = {};
    ['circle', 'ellipse', 'rect', 'poly', 'tri', 'line', 'path', 'curve',
     'blob', 'arc', 'dot', 'zigzag', 'spiral'].forEach((kind) => {
      api[kind] = function () {
        const args = Array.prototype.slice.call(arguments);
        const key = kind + JSON.stringify(args);
        let e = cache.get(key);
        if (!e) {
          if (cache.size > 2000) cache.clear();
          const b = new Builder(rng32(hash(key)));
          b[kind].apply(b, args);
          e = b.prims[0];
          e.idx = 0;
          cache.set(key, e);
        }
        const ctx = world.p.drawingContext;
        const vi = world.boil ? Math.floor(world.time * world.boilRate) % VARIANTS : 0;
        if (!e.variants[vi]) e.variants[vi] = makeVariant(e, hash(key, vi), 1, world);
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        renderPrim(ctx, e, e.variants[vi], world.pal, world.penWidth,
                   world.penWidth * 1.9, 1, 1, null, 1);
        ctx.restore();
        return api;
      };
    });
    return api;
  }

  // Height of an item's drawing in local units, at its defaults.
  function drawnHeight(def) {
    if (!def._h) {
      const b = new Builder(rng32(1));
      def.build(b, Object.assign({}, def.defaults));
      let lo = Infinity, hi = -Infinity;
      for (const pr of b.prims) {
        for (let i = 1; i < pr.outline.length; i += 2) {
          if (pr.outline[i] < lo) lo = pr.outline[i];
          if (pr.outline[i] > hi) hi = pr.outline[i];
        }
      }
      def._h = Math.max(1, hi - lo);
    }
    return def._h;
  }

  // ------------------------------------------------------------------
  // Item registry
  // ------------------------------------------------------------------
  const registry = {};

  // define(name, { build(d, o), defaults, size:[w,h], real, motion,
  //   speed, layer, origin:'ground'|'center', stride, tags })
  // real: the thing's height in metres (sets its natural size); leave
  // it out for scenery such as ground, hills and the sun.
  function define(name, def) {
    registry[name] = Object.assign({ defaults: {}, size: [80, 100], origin: 'ground' }, def);
    return registry[name];
  }

  const A = anim;

  // ---- shared bits -------------------------------------------------
  function wheel(d, x, y, r, name, hub) {
    d.part(name, A.roll(r, x, y));
    d.circle(x, y, r, { fill: 'black' });
    d.in(name, () => {
      d.circle(x, y, r * 0.55, { fill: hub || 'yellow' });
      for (let k = 0; k < 3; k++) {
        const a = k * Math.PI / 3, c = Math.cos(a) * r * 0.5, s = Math.sin(a) * r * 0.5;
        d.line(x - c, y - s, x + c, y + s, { w: 0.6 });
      }
    });
  }

  function face(d, x, y, r, o) {
    o = o || {};
    d.dot(x - r * 0.35, y - r * 0.12);
    d.dot(x + r * 0.35, y - r * 0.12);
    if (o.nose) d.dot(x, y + r * 0.2, { r: 1.6, ink: o.nose });
    d.arc(x, y + r * 0.1, r * 0.48, 0.2 * Math.PI, 0.8 * Math.PI, { w: 0.8 });
  }

  function arms(d, shY, shX, len, o) {
    o = o || {};
    d.part('armL', A.gait(o.amp || 0.5, 34, -shX, shY, Math.PI));
    d.part('armR', A.gait(o.amp || 0.5, 34, shX, shY));
    d.line(-shX, shY, -shX - 7, shY + len, { part: 'armL', w: 1.1 });
    d.dot(-shX - 7, shY + len, { part: 'armL', r: 2 });
    d.line(shX, shY, shX + 7, shY + len, { part: 'armR', w: 1.1 });
    d.dot(shX + 7, shY + len, { part: 'armR', r: 2 });
  }

  function legs(d, hipY, spread, o) {
    o = o || {};
    const amp = o.amp == null ? 0.42 : o.amp;
    d.part('legL', A.gait(amp, 34, -spread, hipY));
    d.part('legR', A.gait(amp, 34, spread, hipY, Math.PI));
    const lo = { part: 'legL', w: 1.3, ink: o.ink };
    d.path([-spread, hipY, -spread, -1, -spread + 6, -1], lo);
    d.path([spread, hipY, spread, -1, spread + 6, -1],
           Object.assign({}, lo, { part: 'legR' }));
  }

  function cren(x0, x1, ytop, ybot, ch, n) {
    const w = (x1 - x0) / (2 * n - 1);
    const pts = [x0, ybot, x0, ytop - ch];
    for (let i = 0; i < 2 * n - 1; i++) {
      const xb = x0 + (i + 1) * w;
      if (i % 2 === 0) {
        pts.push(xb, ytop - ch);
        if (i < 2 * n - 2) pts.push(xb, ytop);
      } else {
        pts.push(xb, ytop, xb, ytop - ch);
      }
    }
    pts.push(x1, ybot);
    return pts;
  }

  function smoke(d, x, y, n, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      d.part('smoke' + i, A.puff(o.period || 3, o.rise || 34, o.drift == null ? -10 : o.drift, i / n, x, y));
      d.circle(x, y - 2, o.r || 4.5, { part: 'smoke' + i, fill: o.ink || 'black',
        ink: 'none', fillAlpha: 0.22, knock: false });
    }
  }

  // ---- people ------------------------------------------------------
  define('person', {
    real: 1.75,
    tags: ['people'], size: [40, 100], motion: 'walk', speed: 26,
    defaults: { color: 'blue', legs: 'black', hair: 'brown' },
    build(d, o) {
      d.step(); d.circle(0, -84, 9, { fill: o.skin || 'orange' });
      d.step(); face(d, 0, -84, 9);
      d.arc(0, -84, 9.5, 1.1 * Math.PI, 1.9 * Math.PI, { ink: o.hair, w: 2.4 });
      d.step(); d.rect(-9, -73, 18, 32, { fill: o.color });
      d.step(); arms(d, -70, 9, 20);
      d.step(); legs(d, -41, 5, { ink: o.legs });
    }
  });

  define('girl', {
    real: 1.3,
    tags: ['people'], size: [44, 100], motion: 'walk', speed: 24,
    defaults: { color: 'red', hair: 'yellow' },
    build(d, o) {
      d.step(); d.circle(0, -84, 9, { fill: o.skin || 'orange' });
      d.step(); face(d, 0, -84, 9);
      d.step();
      d.arc(0, -84, 10, 1.05 * Math.PI, 1.95 * Math.PI, { ink: o.hair, w: 2.6 });
      d.circle(-12, -84, 4, { fill: o.hair });
      d.circle(12, -84, 4, { fill: o.hair });
      d.step(); d.tri(0, -74, -15, -38, 15, -38, { fill: o.color });
      d.step(); arms(d, -68, 5, 20);
      d.step(); legs(d, -38, 5);
    }
  });

  define('king', {
    real: 1.9,
    tags: ['people'], size: [44, 110], motion: 'walk', speed: 16,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.circle(0, -84, 9, { fill: o.skin || 'orange' });
      d.step(); face(d, 0, -84, 9);
      d.step(); d.poly([-8, -90, -9, -101, -4.5, -95, 0, -103, 4.5, -95, 9, -101, 8, -90],
                       { fill: 'yellow' });
      d.dot(0, -96, { ink: 'red', r: 1.6 });
      d.step(); d.tri(0, -75, -17, -36, 17, -36, { fill: o.color });
      d.zigzag(-16, -37, 16, -37, 6, 3, { w: 0.8 });
      d.step(); arms(d, -68, 6, 18, { amp: 0.25 });
      d.line(13, -50, 15, -74, { part: 'armR' });
      d.circle(15, -77, 3, { fill: 'yellow', part: 'armR' });
      d.step(); legs(d, -36, 5, { amp: 0.3 });
    }
  });

  define('knight', {
    real: 1.95,
    tags: ['people'], size: [50, 110], motion: 'walk', speed: 20,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.rect(-9, -95, 18, 21, { fill: 'black' });
      d.line(-6, -86, 6, -86, { ink: 'yellow', w: 1.4 });
      d.step(); d.curve([0, -95, -3, -104, -10, -108, -16, -104], { ink: o.color, w: 2.4 });
      d.step(); d.rect(-9, -73, 18, 32, { fill: 'blue' });
      d.line(-9, -46, 9, -46);
      d.step(); arms(d, -70, 9, 20, { amp: 0.25 });
      d.in('armR', () => {
        d.line(16, -51, 16, -88, { w: 1.2 });
        d.line(11, -55, 21, -55, { w: 1.4 });
      });
      d.in('armL', () => {
        d.poly([-24, -66, -8, -66, -8, -54, -16, -44, -24, -54], { fill: o.color });
        d.line(-16, -64, -16, -48, { ink: 'yellow', w: 1.4 });
        d.line(-22, -58, -10, -58, { ink: 'yellow', w: 1.4 });
      });
      d.step(); legs(d, -41, 5);
    }
  });

  define('soldier', {
    real: 2.0,
    tags: ['people'], size: [40, 110], motion: 'walk', speed: 22,
    defaults: { color: 'red', legs: 'blue' },
    build(d, o) {
      d.step(); d.rect(-7, -106, 14, 18, { fill: 'black' });
      d.step(); d.circle(0, -80, 8, { fill: o.skin || 'orange' });
      d.dot(-2.8, -81); d.dot(2.8, -81);
      d.dot(-5, -77, { ink: 'red', r: 1.5 }); d.dot(5, -77, { ink: 'red', r: 1.5 });
      d.step(); d.rect(-9, -71, 18, 30, { fill: o.color });
      d.line(-9, -71, 9, -46, { ink: 'yellow', w: 0.9 });
      d.line(9, -71, -9, -46, { ink: 'yellow', w: 0.9 });
      d.step(); arms(d, -68, 9, 20, { amp: 0.6 });
      d.line(-17, -46, -19, -92, { part: 'armL', w: 1.2 });
      d.step(); legs(d, -41, 5, { ink: o.legs, amp: 0.55 });
    }
  });

  define('cowboy', {
    real: 1.9,
    tags: ['people'], size: [44, 105], motion: 'walk', speed: 24,
    defaults: { color: 'orange', hat: 'brown' },
    build(d, o) {
      d.step(); d.circle(0, -82, 9, { fill: o.skin || 'orange' });
      d.step(); face(d, 0, -82, 9);
      d.step(); d.line(-16, -90, 16, -90, { w: 2, ink: o.hat });
      d.poly([-8, -90, -7, -101, 7, -101, 8, -90], { fill: o.hat });
      d.step(); d.tri(-7, -73, 7, -73, 0, -66, { fill: 'red' });
      d.rect(-9, -72, 18, 31, { fill: o.color });
      d.line(0, -66, 0, -42, { w: 0.8 });
      d.step(); arms(d, -69, 9, 20);
      d.step(); legs(d, -41, 5, { ink: 'blue' });
      d.dot(-3, -2, { r: 2.4, part: 'legL' }); d.dot(7, -2, { r: 2.4, part: 'legR' });
    }
  });

  define('clown', {
    real: 2.0,
    tags: ['people'], size: [50, 115], motion: 'walk', speed: 18,
    defaults: { color: 'yellow' },
    build(d, o) {
      d.step(); d.circle(0, -80, 9, { fill: o.skin || 'orange' });
      d.step(); face(d, 0, -80, 9, { nose: 'red' });
      d.step(); d.tri(-8, -87, 8, -87, 0, -110, { fill: 'blue' });
      d.circle(0, -111, 2.5, { fill: 'red' });
      d.step(); d.zigzag(-12, -69, 12, -69, 5, 4, { w: 1.2 });
      d.rect(-10, -69, 20, 30, { fill: o.color });
      d.dot(0, -60, { ink: 'red', r: 2.2 }); d.dot(0, -50, { ink: 'red', r: 2.2 });
      d.step(); arms(d, -66, 10, 18);
      d.step(); legs(d, -39, 5);
      d.ellipse(-2, -2, 7, 3, { fill: 'red', part: 'legL' });
      d.ellipse(8, -2, 7, 3, { fill: 'red', part: 'legR' });
    }
  });

  // ---- buildings & landmarks ----------------------------------------
  define('house', {
    real: 8,
    tags: ['buildings'], size: [80, 100], layer: 1,
    defaults: { color: 'yellow', roof: 'red' },
    build(d, o) {
      d.step(); d.rect(-30, -50, 60, 50, { fill: o.color });
      d.step(); d.tri(-37, -50, 0, -84, 37, -50, { fill: o.roof });
      d.step(); d.rect(-7, -27, 14, 27, { fill: 'brown', knock: true });
      d.dot(4, -13);
      d.step();
      [-24, 12].forEach((x) => {
        d.rect(x, -43, 12, 12, { fill: 'blue', knock: true });
        d.line(x + 6, -43, x + 6, -31, { w: 0.8 });
        d.line(x, -37, x + 12, -37, { w: 0.8 });
      });
      d.step(); d.rect(14, -80, 8, 18, { fill: o.roof });
      d.step(); smoke(d, 18, -84, 3);
    }
  });

  define('castle', {
    real: 18,
    tags: ['buildings'], size: [130, 120], layer: 1,
    defaults: { color: 'orange', flag: 'red' },
    build(d, o) {
      d.step(); d.poly(cren(-36, 36, -50, 0, 7, 5), { fill: o.color });
      d.step();
      d.rect(-58, -78, 22, 78, { fill: o.color });
      d.rect(36, -78, 22, 78, { fill: o.color });
      d.step();
      d.tri(-61, -78, -47, -104, -33, -78, { fill: 'blue' });
      d.tri(33, -78, 47, -104, 61, -78, { fill: 'blue' });
      d.step();
      const gate = [-11, 0, -11, -20].concat(ellipsePts(0, -20, 11, 11, Math.PI, Math.PI, 3), [11, 0]);
      d.poly(gate, { fill: 'brown', knock: true });
      d.line(-6, -26, -6, 0, { w: 0.7 }); d.line(0, -31, 0, 0, { w: 0.7 });
      d.line(6, -26, 6, 0, { w: 0.7 });
      d.step();
      d.rect(-50, -62, 6, 12, { fill: 'black' });
      d.rect(44, -62, 6, 12, { fill: 'black' });
      d.rect(-26, -38, 6, 10, { fill: 'black' });
      d.rect(20, -38, 6, 10, { fill: 'black' });
      d.step(); d.line(0, -57, 0, -96, { w: 1.1 });
      d.part('flag', A.wave(2.4, 15, 5, 0, -96));
      d.rect(0, -96, 22, 13, { fill: o.flag, part: 'flag' });
    }
  });

  define('windmill', {
    real: 15,
    tags: ['buildings'], size: [90, 110], layer: 1,
    defaults: { color: 'red', sails: 'yellow' },
    build(d, o) {
      d.step(); d.poly([-15, 0, -9, -62, 9, -62, 15, 0], { fill: o.color });
      d.step(); d.tri(-12, -62, 0, -76, 12, -62, { fill: 'brown' });
      d.step(); d.poly([-5, 0, -5, -10].concat(ellipsePts(0, -10, 5, 5, Math.PI, Math.PI, 2), [5, 0]),
                       { fill: 'brown', knock: true });
      d.circle(0, -38, 4, { fill: 'blue', knock: true });
      d.step();
      d.part('sails', A.spin(1.2, 0, -66));
      d.in('sails', () => {
        for (let k = 0; k < 4; k++) {
          const blade = rotPts([4, -69, 40, -73, 40, -61, 4, -63], k * Math.PI / 2 + 0.3, 0, -66);
          d.poly(blade, { fill: o.sails, knock: true });
        }
        d.circle(0, -66, 3, { fill: 'black' });
      });
    }
  });

  define('lighthouse', {
    real: 25,
    tags: ['buildings'], size: [60, 110], layer: 1,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.poly([-13, 0, -8, -72, 8, -72, 13, 0], { fill: 'yellow' });
      d.step();
      d.poly([-12.1, -16, -11.2, -30, 11.2, -30, 12.1, -16], { fill: o.color, ink: 'none' });
      d.poly([-10.3, -44, -9.4, -58, 9.4, -58, 10.3, -44], { fill: o.color, ink: 'none' });
      d.step(); d.rect(-9, -84, 18, 12, { fill: 'orange' });
      d.line(-12, -72, 12, -72, { w: 1.5 });
      d.step(); d.tri(-12, -84, 0, -96, 12, -84, { fill: o.color });
      d.step();
      d.part('beam', { pivot: [0, -78], sx: (t) => Math.cos(t * 1.4) });
      d.tri(4, -78, 70, -90, 70, -66, { fill: 'yellow', ink: 'none', part: 'beam', fillAlpha: 0.45, knock: false });
    }
  });

  define('tent', {
    real: 2.5,
    tags: ['buildings'], size: [70, 70], layer: 1,
    defaults: { color: 'orange', flag: 'red' },
    build(d, o) {
      d.step(); d.tri(-32, 0, 0, -52, 32, 0, { fill: o.color });
      d.step(); d.tri(-10, 0, 0, -26, 10, 0, { fill: 'black' });
      d.step(); d.line(0, -52, 0, -64);
      d.part('flag', A.wave(1.6, 8, 6, 0, -64));
      d.tri(0, -64, 13, -60, 0, -56, { fill: o.flag, part: 'flag' });
    }
  });

  // ---- nature --------------------------------------------------------
  define('tree', {
    real: 7,
    tags: ['nature'], size: [60, 90], motion: 'sway', layer: 1,
    defaults: { color: 'green', fruit: 'red' },
    build(d, o) {
      d.step(); d.rect(-5, -42, 10, 42, { fill: 'brown' });
      d.step(); d.circle(0, -62, 25, { fill: o.color });
      if (o.fruit) {
        d.step();
        [[-10, -66], [9, -72], [-2, -52], [12, -56], [-12, -78]].forEach((p) =>
          d.dot(p[0], p[1], { ink: o.fruit, r: 2.6, knock: true }));
      }
    }
  });

  define('pine', {
    real: 10,
    tags: ['nature'], size: [50, 90], motion: 'sway', layer: 1,
    defaults: { color: 'green' },
    build(d, o) {
      d.step(); d.rect(-4, -14, 8, 14, { fill: 'brown' });
      d.step(); d.tri(-23, -14, 0, -48, 23, -14, { fill: o.color });
      d.step(); d.tri(-18, -34, 0, -64, 18, -34, { fill: o.color });
      d.step(); d.tri(-13, -52, 0, -82, 13, -52, { fill: o.color });
    }
  });

  define('flower', {
    real: 0.5,
    tags: ['nature'], size: [30, 60], motion: 'sway', layer: 2,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.curve([0, 0, 2, -20, 0, -40], { ink: 'green', w: 1.3 });
      d.blob([1, -16, 9, -24, 14, -22, 8, -16], { fill: 'green', w: 0.8 });
      d.step();
      d.part('head', A.swing(0.12, 0.4, 0, -40));
      d.in('head', () => {
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * TAU;
          d.circle(Math.cos(a) * 7, -46 + Math.sin(a) * 7, 4.5, { fill: o.color, w: 0.8 });
        }
        d.circle(0, -46, 4, { fill: 'yellow', w: 0.8, knock: true });
      });
    }
  });

  define('mushroom', {
    real: 0.12,
    tags: ['nature'], size: [36, 36], layer: 2,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.rect(-5, -14, 10, 14, { fill: 'yellow' });
      d.step(); d.poly([-16, -14].concat(ellipsePts(0, -14, 16, 14, Math.PI, Math.PI, 2)), { fill: o.color });
      d.step();
      d.dot(-7, -20, { ink: 'yellow', r: 2.5, knock: true }); d.dot(4, -24, { ink: 'yellow', r: 2.5, knock: true });
      d.dot(9, -17, { ink: 'yellow', r: 2, knock: true });
    }
  });

  define('grass', {
    real: 0.15,
    tags: ['nature'], size: [30, 14], layer: 2,
    build(d) {
      d.step();
      d.path([-12, 0, -9, -10, -6, 0, -2, -13, 2, 0, 6, -11, 9, 0, 12, -8], { ink: 'green', w: 1.1 });
    }
  });

  define('mountain', {
    tags: ['nature'], size: [160, 100], layer: 0,
    defaults: { color: 'brown' },
    build(d, o) {
      d.step(); d.tri(-80, 0, 0, -96, 80, 0, { fill: o.color });
      d.step(); d.poly([-21, -71, 0, -96, 21, -71, 12, -64, 4, -72, -5, -63, -13, -70], { fill: 'blue', knock: true });
    }
  });

  define('hill', {
    tags: ['nature'], size: [200, 60], layer: 0,
    defaults: { color: 'green' },
    build(d, o) {
      d.step();
      d.poly([-100, 0].concat(ellipsePts(0, 0, 100, 55, Math.PI, Math.PI, 3)), { fill: o.color });
    }
  });

  define('sun', {
    tags: ['sky'], size: [80, 80], origin: 'center', layer: 0,
    build(d) {
      d.step(); d.circle(0, 0, 17, { fill: 'yellow' });
      d.step(); face(d, 0, 0, 17);
      d.step();
      d.part('rays', A.spin(0.25));
      d.in('rays', () => {
        for (let k = 0; k < 10; k++) {
          const a = k / 10 * TAU;
          d.line(Math.cos(a) * 23, Math.sin(a) * 23, Math.cos(a) * 33, Math.sin(a) * 33,
                 { ink: 'orange', w: 1.4 });
        }
      });
    }
  });

  define('moon', {
    tags: ['sky'], size: [50, 50], origin: 'center', layer: 0,
    build(d) {
      d.step();
      const pts = ellipsePts(0, 0, 20, 20, -Math.PI / 2, Math.PI, 2)
        .concat(ellipsePts(-8, 0, 17, 20, Math.PI / 2, -Math.PI, 2));
      d.poly(pts, { fill: 'yellow' });
      d.step(); d.dot(9, -4);
    }
  });

  define('star', {
    tags: ['sky'], size: [24, 24], origin: 'center', layer: 0,
    build(d, o) {
      d.step();
      const pts = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 4.5 : 11, a = -Math.PI / 2 + k / 10 * TAU;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      d.part('twinkle', A.flicker(0.12, 0.8));
      d.poly(pts, { fill: o.color || 'yellow', part: 'twinkle' });
    }
  });

  define('cloud', {
    tags: ['sky'], size: [80, 36], origin: 'center', motion: 'drift', speed: 6, layer: 0,
    build(d) {
      d.step();
      const pts = [];
      const n = 7;
      for (let i = 0; i < 160; i++) {
        const a = i / 160 * TAU;
        const bottom = Math.sin(a) > 0.2;
        const sc = bottom ? 0.95 : 0.86 + 0.2 * Math.abs(Math.sin(a * n / 2));
        pts.push(Math.cos(a) * 34 * sc, Math.sin(a) * (bottom ? 12 : 16) * sc);
      }
      d.poly(pts, { fill: 'blue', fillAlpha: 0.3, knock: false, ink: 'none', hatch: 0.1 });
    }
  });

  // ---- vehicles --------------------------------------------------------
  define('car', {
    real: 1.5,
    tags: ['vehicles'], size: [80, 40], motion: 'drive', speed: 60, layer: 3,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.poly([-38, -10, -38, -21, -33, -24, 31, -24, 38, -19, 38, -10], { fill: o.color });
      d.step(); d.poly([-22, -24, -14, -38, 14, -38, 22, -24], { fill: o.color });
      d.step();
      d.poly([-17, -26, -11.5, -35, -1.5, -35, -1.5, -26], { fill: 'blue', knock: true });
      d.poly([1.5, -26, 1.5, -35, 11.5, -35, 17, -26], { fill: 'blue', knock: true });
      d.step(); wheel(d, -22, -9, 9, 'w1'); wheel(d, 22, -9, 9, 'w2');
      d.step(); d.circle(35, -18, 2.4, { fill: 'yellow', knock: true });
      d.line(-40, -12, -34, -12, { w: 1.6 });
    }
  });

  define('truck', {
    real: 3.8,
    tags: ['vehicles'], size: [100, 56], motion: 'drive', speed: 45, layer: 3,
    defaults: { color: 'yellow', cab: 'red' },
    build(d, o) {
      d.step(); d.rect(-48, -52, 62, 40, { fill: o.color });
      d.step(); d.poly([16, -12, 16, -46, 32, -46, 44, -28, 44, -12], { fill: o.cab });
      d.poly([20, -42, 30.5, -42, 39, -29, 20, -29], { fill: 'blue', knock: true });
      d.step(); d.line(-50, -12, 46, -12, { w: 1.5 });
      d.step(); wheel(d, -34, -9, 9, 'w1'); wheel(d, -14, -9, 9, 'w2');
      wheel(d, 30, -9, 9, 'w3');
    }
  });

  define('bus', {
    real: 3.2,
    tags: ['vehicles'], size: [110, 50], motion: 'drive', speed: 40, layer: 3,
    defaults: { color: 'yellow' },
    build(d, o) {
      d.step(); d.poly([-52, -10, -52, -46, 46, -46, 52, -36, 52, -10], { fill: o.color });
      d.step();
      for (let i = 0; i < 6; i++) d.rect(-46 + i * 14, -41, 10, 11, { fill: 'blue', knock: true });
      d.poly([40, -41, 45, -41, 49, -33, 40, -33], { fill: 'blue', knock: true });
      d.step(); d.line(-52, -24, 52, -24, { ink: 'red', w: 1.6 });
      d.step(); wheel(d, -32, -9, 9, 'w1'); wheel(d, 32, -9, 9, 'w2');
      d.circle(49, -17, 2.4, { fill: 'red', knock: true });
    }
  });

  define('engine', {
    real: 4.6,
    tags: ['vehicles'], size: [90, 80], motion: 'drive', speed: 50, layer: 3,
    defaults: { color: 'red', boiler: 'blue' },
    build(d, o) {
      d.step(); d.rect(-42, -64, 26, 46, { fill: o.color });
      d.line(-46, -66, -12, -66, { w: 2 });
      d.rect(-36, -58, 14, 12, { fill: 'yellow', knock: true });
      d.step(); d.rect(-16, -46, 46, 28, { fill: o.boiler });
      d.step(); d.poly([10, -46, 7, -62, 23, -62, 20, -46], { fill: 'black' });
      d.circle(30, -40, 3, { fill: 'yellow', knock: true });
      d.step(); d.rect(-44, -18, 78, 6, { fill: 'black' });
      d.poly([30, -20, 44, -2, 30, -2], { fill: o.color });
      d.step(); wheel(d, -28, -11, 11, 'w1', 'red'); wheel(d, -4, -11, 11, 'w2', 'red');
      wheel(d, 18, -7, 7, 'w3', 'red');
      d.step(); smoke(d, 15, -66, 4, { r: 5.5, rise: 40, drift: -26, period: 2.4 });
    }
  });

  define('coach', {
    real: 4,
    tags: ['vehicles'], size: [80, 60], motion: 'drive', speed: 50, layer: 3,
    defaults: { color: 'green' },
    build(d, o) {
      d.step(); d.rect(-36, -50, 72, 36, { fill: o.color });
      d.line(-40, -52, 40, -52, { w: 2 });
      d.step(); for (let i = 0; i < 3; i++) d.rect(-28 + i * 20, -44, 14, 12, { fill: 'yellow', knock: true });
      d.step(); d.line(-42, -18, 42, -18, { w: 1.5 });
      wheel(d, -22, -7, 7, 'w1', 'red'); wheel(d, 22, -7, 7, 'w2', 'red');
    }
  });

  define('caboose', {
    real: 4.4,
    tags: ['vehicles'], size: [80, 70], motion: 'drive', speed: 50, layer: 3,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.rect(-30, -46, 60, 32, { fill: o.color });
      d.rect(-34, -50, 68, 4, { fill: 'black' });
      d.step(); d.rect(-10, -62, 20, 12, { fill: o.color });
      d.rect(-13, -65, 26, 3, { fill: 'black' });
      d.rect(-6, -59, 5, 6, { fill: 'yellow' });
      d.rect(1, -59, 5, 6, { fill: 'yellow' });
      d.step();
      d.rect(-24, -40, 9, 9, { fill: 'yellow' });
      d.rect(15, -40, 9, 9, { fill: 'yellow' });
      d.rect(-5, -40, 10, 26, { fill: 'black' });
      d.step();
      // end platforms with railings
      d.line(-40, -14, 40, -14, { w: 1.5 });
      [[-30, -38], [30, 38]].forEach(([a, b]) => {
        d.line(b, -14, b, -30, { w: 0.9 });
        d.line(a, -30, b, -30, { w: 0.9 });
        d.line((a + b) / 2, -14, (a + b) / 2, -30, { w: 0.9 });
      });
      d.dot(-36, -34, { ink: 'red', r: 2.2 });
      d.step(); wheel(d, -18, -7, 7, 'w1', 'red'); wheel(d, 18, -7, 7, 'w2', 'red');
    }
  });

  define('train', {
    real: 4.6,
    tags: ['vehicles'], size: [360, 80], motion: 'drive', speed: 50, layer: 3,
    defaults: { cars: 2, caboose: true },
    build(d, o) {
      const colors = ['green', 'yellow', 'orange', 'blue'];
      // engine right edge is at x = 134; centre the whole train
      const left = -o.cars * 88 - (o.caboose ? 40 : -44);
      d.at(-(left + 134) / 2, 0, () => {
        d.use('engine', 90, 0, {});
        for (let i = 0; i < o.cars; i++) d.step().use('coach', -i * 88, 0, { color: colors[i % 4] });
        if (o.caboose) d.step().use('caboose', -o.cars * 88, 0, { color: o.cabooseColor || 'red' });
      });
    }
  });

  define('sailboat', {
    real: 9,
    tags: ['boats'], size: [60, 80], motion: 'sail', speed: 14, layer: 4,
    defaults: { color: 'red', sail: 'yellow' },
    build(d, o) {
      d.step(); d.poly([-28, -14, 28, -14, 20, 0, -20, 0], { fill: o.color });
      d.step(); d.line(0, -14, 0, -72, { w: 1.2 });
      d.step(); d.tri(-3, -70, -3, -18, -26, -18, { fill: o.sail });
      d.tri(3, -62, 3, -18, 20, -18, { fill: 'orange' });
      d.step();
      d.part('pennant', A.wave(1.5, 8, 7, 0, -72));
      d.tri(0, -72, -12, -69, 0, -66, { fill: 'red', part: 'pennant' });
    }
  });

  define('ship', {
    real: 22,
    tags: ['boats'], size: [120, 70], motion: 'sail', speed: 10, layer: 4,
    defaults: { color: 'blue' },
    build(d, o) {
      d.step(); d.poly([-56, -22, 58, -22, 48, 0, -48, 0], { fill: o.color });
      d.step(); for (let i = 0; i < 5; i++) d.circle(-34 + i * 16, -12, 3, { fill: 'yellow', w: 0.8, knock: true });
      d.step(); d.rect(-32, -36, 54, 14, { fill: 'yellow' });
      d.step(); d.rect(-18, -56, 10, 20, { fill: 'red' });
      d.rect(2, -56, 10, 20, { fill: 'red' });
      d.line(-18, -51, -8, -51, { w: 2 }); d.line(2, -51, 12, -51, { w: 2 });
      d.step(); smoke(d, -13, -58, 3, { drift: -22 }); smoke(d, 7, -58, 3, { drift: -22 });
    }
  });

  define('airplane', {
    real: 2.7,
    tags: ['sky', 'vehicles'], size: [90, 40], origin: 'center', motion: 'fly', speed: 55, layer: 5,
    defaults: { color: 'red', wings: 'yellow' },
    build(d, o) {
      d.step(); d.ellipse(0, 0, 36, 8, { fill: o.color });
      d.step(); d.poly([-32, -2, -42, -20, -32, -20, -24, -4], { fill: o.wings });
      d.step(); d.poly([-6, 2, 10, 2, 2, 17, -14, 17], { fill: o.wings });
      d.step(); d.blob([10, -6, 16, -12, 24, -7], { fill: 'blue', w: 0.9, knock: true });
      for (let i = 0; i < 3; i++) d.dot(-16 + i * 9, -1, { r: 1.6 });
      d.step(); d.dot(37, 0, { r: 2.4 });
      d.part('prop', A.flap(4, 37, 0, 'y'));
      d.line(37, -13, 37, 13, { part: 'prop', w: 1.6 });
    }
  });

  define('helicopter', {
    real: 3.5,
    tags: ['sky', 'vehicles'], size: [90, 50], origin: 'center', motion: 'hover', speed: 18, layer: 5,
    defaults: { color: 'yellow' },
    build(d, o) {
      d.step(); d.ellipse(0, 0, 19, 14, { fill: o.color });
      d.step(); d.poly([-17, -4, -52, -2, -52, 3, -16, 6], { fill: o.color });
      d.step(); d.blob([4, -12, 16, -8, 18, 2, 6, 0], { fill: 'blue', w: 0.9, knock: true });
      d.step(); d.line(-10, 19, 14, 19, { w: 1.5 });
      d.line(-6, 13, -6, 19); d.line(8, 13, 8, 19);
      d.step(); d.line(0, -14, 0, -20, { w: 1.5 });
      d.part('rotor', A.flap(3, 0, -20, 'x'));
      d.line(-36, -20, 36, -20, { part: 'rotor', w: 1.6 });
      d.part('tail', A.spin(14, -52, 0));
      d.line(-59, 0, -45, 0, { part: 'tail', w: 1.1 });
      d.line(-52, -7, -52, 7, { part: 'tail', w: 1.1 });
    }
  });

  define('rocket', {
    real: 25,
    tags: ['sky', 'vehicles'], size: [44, 100], motion: 'launch', layer: 5,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.rect(-10, -62, 20, 50, { fill: o.body || 'blue' });
      d.step(); d.tri(-10, -62, 0, -86, 10, -62, { fill: o.color });
      d.step(); d.circle(0, -46, 5, { fill: 'yellow' });
      d.step(); d.tri(-10, -30, -21, -8, -10, -14, { fill: o.color });
      d.tri(10, -30, 21, -8, 10, -14, { fill: o.color });
      d.step();
      d.part('flame', { pivot: [0, -12],
        sy: (t, it) => (it.launching ? 1.6 : 0.6) * (1 + 0.25 * Math.sin(t * 31) + 0.15 * Math.sin(t * 13)) });
      d.tri(-7, -12, 0, 6, 7, -12, { fill: 'orange', part: 'flame' });
      d.tri(-3, -12, 0, -2, 3, -12, { fill: 'yellow', ink: 'none', part: 'flame' });
    }
  });

  define('balloon', {
    real: 22,
    tags: ['sky', 'vehicles'], size: [56, 90], motion: 'float', speed: 8, layer: 5,
    defaults: { color: 'red', stripe: 'yellow' },
    build(d, o) {
      d.step();
      const env = ellipsePts(0, -60, 25, 25, Math.PI * 0.8, Math.PI * 1.4, 2).concat([8, -24, -8, -24]);
      d.poly(env, { fill: o.color });
      d.step();
      d.ellipse(0, -60, 9, 24.5, { fill: o.stripe, ink: 'none', knock: true });
      d.curve([0, -85, -9, -60, 0, -24], { w: 0.8 });
      d.curve([0, -85, 9, -60, 0, -24], { w: 0.8 });
      d.step(); d.line(-8, -24, -6, -11, { w: 0.8 }); d.line(8, -24, 6, -11, { w: 0.8 });
      d.rect(-7, -11, 14, 11, { fill: 'brown' });
    }
  });

  // ---- animals -----------------------------------------------------
  define('bird', {
    real: 0.15,
    tags: ['animals', 'sky'], size: [40, 30], origin: 'center', motion: 'fly', speed: 40, layer: 5,
    defaults: { color: 'blue' },
    build(d, o) {
      d.step(); d.ellipse(0, 0, 11, 7, { fill: o.color });
      d.step(); d.circle(10, -6, 5.5, { fill: o.color });
      d.tri(14.5, -7.5, 21, -5, 14.5, -3.5, { fill: 'orange' });
      d.dot(11, -7.5, { r: 1.3 });
      d.step(); d.tri(-10, -1, -19, -7, -18, 3, { fill: o.color });
      d.step();
      d.part('wing', A.flap(2.6, 0, -2));
      d.tri(-6, -2, 5, -2, -3, -16, { fill: o.color, part: 'wing' });
    }
  });

  define('butterfly', {
    real: 0.06,
    tags: ['animals', 'sky'], size: [40, 34], origin: 'center', motion: 'flutter', speed: 22, layer: 5,
    defaults: { color: 'orange', color2: 'yellow' },
    build(d, o) {
      d.step(); d.ellipse(0, 0, 2.5, 11, { fill: 'black' });
      d.curve([0, -10, -3, -16, -7, -19], { w: 0.8 });
      d.curve([0, -10, 3, -16, 7, -19], { w: 0.8 });
      d.step();
      d.part('wings', A.flap(3.2, 0, 0, 'x', 0.15));
      d.in('wings', () => {
        d.blob([-1, -2, -8, -14, -18, -13, -17, -2], { fill: o.color });
        d.blob([1, -2, 8, -14, 18, -13, 17, -2], { fill: o.color });
        d.blob([-1, 1, -12, 3, -12, 11, -4, 10], { fill: o.color2 });
        d.blob([1, 1, 12, 3, 12, 11, 4, 10], { fill: o.color2 });
        d.dot(-10, -8, { r: 2 }); d.dot(10, -8, { r: 2 });
      });
    }
  });

  define('fish', {
    real: 0.12,
    tags: ['animals', 'water'], size: [50, 26], origin: 'center', motion: 'swim', speed: 18, layer: 6,
    defaults: { color: 'orange' },
    build(d, o) {
      d.step(); d.ellipse(0, 0, 18, 10, { fill: o.color });
      d.step(); d.part('tail', A.swing(0.35, 1.6, -16, 0));
      d.tri(-16, 0, -28, -9, -28, 9, { fill: o.color, part: 'tail' });
      d.step(); d.circle(9, -3, 3, { fill: 'yellow' }); d.dot(9.6, -3, { r: 1.3 });
      d.arc(4, 0, 6, -0.7, 0.7, { w: 0.8 });
      d.tri(-4, -9, 4, -9, -8, -15, { fill: 'yellow' });
      d.step();
      for (let i = 0; i < 2; i++) {
        d.part('bubble' + i, A.puff(2.6, 26, 4, i / 2, 19, -2));
        d.circle(19, -4, 2.2, { part: 'bubble' + i, w: 0.7, ink: 'blue' });
      }
    }
  });

  define('shark', {
    real: 4.5,
    tags: ['animals', 'water'], size: [110, 60], origin: 'center', motion: 'swim', speed: 22, layer: 6,
    defaults: { color: 'grey' },
    build(d, o) {
      // body: a triangle snout, a trapezoid middle, a tapering trapezoid
      d.step();
      d.tri(30, -13, 51, 1, 30, 10, { fill: o.color });
      d.poly([-20, -10, 30, -13, 30, 10, -20, 6], { fill: o.color });
      d.poly([-42, -3, -20, -10, -20, 6, -42, 3], { fill: o.color });
      d.step();
      // the great white's white belly
      d.poly([46, 2, 30, 8.5, -20, 4.8, -38, 2, -20, 1, 30, 1], { fill: 'paper' });
      d.step();
      d.poly([-6, -13, 2, -34, 7, -33, 14, -12], { fill: o.color });
      d.part('tail', A.swing(0.22, 1.3, -40, 0));
      d.poly([-38, -3, -56, -27, -50, -1, -54, 15, -38, 3], { fill: o.color, part: 'tail' });
      d.step();
      d.tri(16, 5, 2, 22, 24, 7, { fill: o.color });
      d.step();
      d.dot(34, -5, { r: 1.8 });
      [18, 22, 26].forEach((x) => d.curve([x, -7, x - 1.5, -2, x, 3], { w: 0.8 }));
      // a toothy grin
      d.poly([48, 3, 40, 6.5, 29, 6, 31, 4, 40, 4.5], { fill: 'black' });
      for (let x = 32; x < 46; x += 3) d.tri(x, 4.6, x + 1.5, 6.4, x + 3, 4.4, { fill: 'paper' });
    }
  });

  define('submarine', {
    real: 9,
    tags: ['boats', 'water'], size: [110, 56], origin: 'center', motion: 'swim', speed: 14, layer: 6,
    defaults: { color: 'yellow' },
    build(d, o) {
      d.step(); d.ellipse(0, 0, 44, 13, { fill: o.color });
      d.step();
      // periscope: rises and sinks, and swivels to look around; drawn
      // before the tower so the tower hides its lower end
      d.part('periscope', {
        pivot: [2, -30],
        dy: (t) => 4 - 4 * Math.cos(t * 0.7),
        sx: (t) => (Math.sin(t * 0.45) > 0 ? 1 : -1)
      });
      d.path([2, -22, 2, -38, 9, -38], { w: 1.8, part: 'periscope' });
      d.poly([-13, -11, -10, -25, 10, -25, 14, -11], { fill: o.color });
      d.step();
      [-22, -6, 10, 26].forEach((x) => d.circle(x, 1, 3.4, { fill: 'blue' }));
      d.step();
      d.tri(-34, -8, -46, -16, -43, -3, { fill: o.color });
      d.tri(-34, 8, -46, 16, -43, 3, { fill: o.color });
      d.line(-44, 0, -50, 0, { w: 1.4 });
      d.step();
      d.part('prop', A.flap(4, -50, 0, 'y'));
      d.line(-50, -9, -50, 9, { w: 2, part: 'prop' });
      d.dot(-50, 0, { r: 2 });
      for (let i = 0; i < 3; i++) {
        d.part('bubble' + i, A.puff(2.2, 16, -14, i / 3, -54, 0));
        d.circle(-54, -2, 2.4, { part: 'bubble' + i, w: 0.7, ink: 'blue' });
      }
    }
  });

  define('cat', {
    real: 0.45,
    tags: ['animals'], size: [44, 70], layer: 2,
    defaults: { color: 'orange' },
    build(d, o) {
      d.step(); d.ellipse(0, -18, 14, 18, { fill: o.color });
      d.step(); d.circle(0, -46, 12, { fill: o.color });
      d.tri(-11, -51, -9, -64, -3, -57, { fill: o.color });
      d.tri(11, -51, 9, -64, 3, -57, { fill: o.color });
      d.step(); d.dot(-4.5, -48); d.dot(4.5, -48);
      d.tri(-1.6, -44, 1.6, -44, 0, -42, { fill: 'red', w: 0.8 });
      [[-1], [1]].forEach((s) => {
        d.line(s * 4, -42, s * 17, -45, { w: 0.6 });
        d.line(s * 4, -41, s * 17, -40, { w: 0.6 });
      });
      d.step();
      d.part('tail', A.swing(0.25, 0.5, 12, -6));
      d.curve([12, -6, 24, -8, 28, -20, 24, -30], { w: 2, part: 'tail' });
    }
  });

  define('blackcat', {
    real: 0.35,
    tags: ['animals'], size: [64, 50], motion: 'walk', speed: 20, layer: 2, stride: 26,
    defaults: { color: 'black', eyes: 'yellow' },
    build(d, o) {
      d.step(); d.ellipse(0, -22, 18, 8.5, { fill: o.color });
      d.step(); d.circle(19, -30, 8.5, { fill: o.color });
      d.tri(12.5, -34, 14, -45, 19.5, -37.5, { fill: o.color });
      d.tri(19.5, -37.5, 25, -45, 26, -33, { fill: o.color });
      d.step();
      // blinks for a moment every few seconds
      const blink = (t) => ((t + 0.4) % 3.3 < 0.16 ? 0.1 : 1);
      d.part('eyes', { pivot: [20, -31], sy: blink });
      d.in('eyes', () => {
        d.ellipse(16.5, -31, 2.4, 2.6, { fill: o.eyes });
        d.ellipse(23, -31, 2.4, 2.6, { fill: o.eyes });
        d.line(16.5, -32.6, 16.5, -29.4, { w: 0.5 });
        d.line(23, -32.6, 23, -29.4, { w: 0.5 });
      });
      d.line(25, -27, 33, -28.5, { w: 0.45 });
      d.line(25, -26, 33, -24, { w: 0.45 });
      d.step();
      [[-12, 0], [-6, Math.PI], [7, Math.PI], [12, 0]].forEach((l, i) => {
        d.part('leg' + i, A.gait(0.38, 26, l[0], -18, l[1]));
        d.line(l[0], -18, l[0], -1, { part: 'leg' + i, w: 1.9, ink: o.color });
      });
      d.step();
      d.part('tail', A.swing(0.28, 0.7, -16, -25));
      d.curve([-16, -25, -25, -30, -28, -41, -23, -48, -18, -46],
              { part: 'tail', w: 2.4, ink: o.color });
    }
  });

  define('elephant', {
    real: 3.2,
    tags: ['animals'], size: [100, 75], motion: 'walk', speed: 14, layer: 2, stride: 40,
    defaults: { color: 'grey' },
    build(d, o) {
      d.step();
      d.blob([-36, -26, -36, -46, -24, -60, -2, -64, 18, -58, 26, -44, 24, -26, -6, -22],
             { fill: o.color });
      d.step();
      [[-28, 0], [-18, Math.PI], [6, Math.PI], [15, 0]].forEach((l, i) => {
        d.part('leg' + i, A.gait(0.22, 40, l[0] + 4, -28, l[1]));
        d.rect(l[0], -30, 9, 30, { fill: o.color, part: 'leg' + i });
      });
      d.step(); d.circle(28, -48, 14, { fill: o.color });
      d.part('trunk', A.swing(0.18, 0.45, 38, -44));
      d.curve([38, -46, 44, -32, 45, -18, 51, -12, 55, -14], { ink: o.color, w: 3.4, part: 'trunk' });
      d.step();
      d.curve([20, -58, 10, -54, 9, -40, 16, -32, 26, -36], { w: 0.9 });
      d.dot(33, -53, { r: 1.6 });
      d.step();
      d.part('tail', A.swing(0.3, 0.9, -36, -42));
      d.line(-36, -42, -43, -28, { part: 'tail', w: 0.9 });
      d.dot(-43, -27, { part: 'tail', r: 1.8 });
    }
  });

  define('trex', {
    real: 5.5,
    tags: ['animals'], size: [100, 90], motion: 'walk', speed: 16, layer: 2, stride: 32,
    defaults: { color: 'blue' },
    build(d, o) {
      d.step();
      d.blob([-12, -30, -6, -54, 8, -64, 18, -54, 14, -32, 2, -24], { fill: o.color });
      d.step();
      d.part('tail', A.swing(0.08, 0.6, -6, -32));
      d.poly([-10, -40, -52, -8, -48, -4, -2, -26], { fill: o.color, part: 'tail' });
      d.step();
      // the jaw snaps open now and then
      const snap = (t) => -0.45 * Math.pow(Math.max(0, Math.sin(t * 1.4)), 6);
      d.part('jaw', { pivot: [10, -64], rot: (t) => -snap(t) });
      d.in('jaw', () => {
        d.poly([10, -66, 40, -66, 37, -58, 14, -56], { fill: o.color });
        for (let x = 18; x < 37; x += 5) d.tri(x, -65, x + 2.5, -69, x + 5, -65, { fill: 'paper' });
      });
      d.poly([4, -64, 8, -83, 36, -84, 44, -76, 44, -67, 10, -63], { fill: o.color });
      for (let x = 16; x < 37; x += 5) d.tri(x, -67, x + 2.5, -62.5, x + 5, -67, { fill: 'paper' });
      // outline just the slanted sides of the top teeth, as one zigzag
      const zig = [16, -67];
      for (let x = 16; x < 37; x += 5) zig.push(x + 2.5, -62.5, x + 5, -67);
      d.path(zig, { w: 0.5 });
      d.dot(19, -76, { r: 1.8 });
      d.line(15, -80, 23, -79, { w: 0.9 });
      d.step();
      d.part('arm', A.swing(0.25, 1.1, 14, -48));
      d.path([14, -48, 21, -42, 24, -45], { ink: o.color, w: 1.4, part: 'arm' });
      d.step();
      [[-6, 0], [4, Math.PI]].forEach((l, i) => {
        d.part('leg' + i, A.gait(0.35, 32, l[0] + 3, -34, l[1]));
        d.in('leg' + i, () => {
          // one shape: thigh, shin and a forward-pointing foot
          const x = l[0];
          d.poly([x - 3, -38, x + 9, -38, x + 6, -14, x + 8, -6, x + 16, -1, x + 15, 0,
                  x, 0, x - 1, -14], { fill: o.color });
        });
      });
    }
  });

  define('dog', {
    real: 0.6,
    tags: ['animals'], size: [60, 56], motion: 'walk', speed: 26, layer: 2, stride: 30,
    defaults: { color: 'brown' },
    build(d, o) {
      d.step(); d.rect(-20, -34, 36, 16, { fill: o.color });
      d.step(); d.circle(22, -40, 10, { fill: o.color });
      d.ellipse(28, -36, 7, 4.5, { fill: o.color });
      d.dot(34, -37, { r: 2 }); d.dot(23, -43);
      d.ellipse(16, -38, 4, 8, { fill: 'black' });
      d.step();
      [[-15, 0], [-8, Math.PI], [7, Math.PI], [13, 0]].forEach((l, i) => {
        d.part('leg' + i, A.gait(0.4, 30, l[0], -20, l[1]));
        d.path([l[0], -20, l[0], -1, l[0] + 4, -1], { part: 'leg' + i, w: 1.3 });
      });
      d.step();
      d.part('tail', A.swing(0.45, 3, -20, -32));
      d.line(-20, -32, -30, -46, { w: 1.6, part: 'tail' });
    }
  });

  define('horse', {
    real: 2.4,
    tags: ['animals'], size: [90, 90], motion: 'walk', speed: 30, layer: 2, stride: 40,
    defaults: { color: 'brown', mane: 'black' },
    build(d, o) {
      d.step(); d.ellipse(0, -44, 27, 12, { fill: o.color });
      d.step(); d.poly([14, -50, 20, -72, 27, -79, 41, -65, 38, -59, 29, -63, 27, -44], { fill: o.color });
      d.tri(22, -76, 22, -86, 28, -79, { fill: o.color });
      d.dot(29, -71); d.dot(38, -62, { r: 1.2 });
      d.step(); d.zigzag(14, -52, 22, -77, 5, 3.5, { ink: o.mane, w: 1.4 });
      d.step();
      [[-18, 0], [-11, Math.PI], [12, Math.PI], [19, 0]].forEach((l, i) => {
        d.part('leg' + i, A.gait(0.35, 40, l[0], -36, l[1]));
        d.line(l[0], -36, l[0], -2, { part: 'leg' + i, w: 1.4 });
        d.rect(l[0] - 2.5, -4, 5, 4, { fill: 'black', part: 'leg' + i });
      });
      d.step();
      d.part('tail', A.swing(0.2, 1.2, -26, -48));
      d.curve([-26, -48, -36, -42, -38, -24], { ink: o.mane, w: 2.6, part: 'tail' });
    }
  });

  define('cow', {
    real: 1.6,
    tags: ['animals'], size: [80, 70], layer: 2,
    defaults: { color: 'brown', spots: 'black' },
    build(d, o) {
      d.step(); d.rect(-26, -50, 46, 24, { fill: o.color });
      d.step(); d.blob([-18, -48, -8, -46, -10, -38, -20, -40], { fill: o.spots, ink: 'none' });
      d.blob([2, -44, 12, -46, 14, -36, 4, -34], { fill: o.spots, ink: 'none' });
      d.step();
      d.part('head', A.swing(0.08, 0.35, 20, -46));
      d.in('head', () => {
        d.rect(18, -60, 16, 18, { fill: o.color });
        d.ellipse(30, -42, 8, 5, { fill: 'orange' });
        d.dot(23, -54); d.dot(30, -54);
        d.curve([20, -60, 17, -66, 14, -67], { w: 1.4 });
        d.curve([32, -60, 35, -66, 38, -67], { w: 1.4 });
      });
      d.step();
      [-22, -14, 8, 16].forEach((x) => d.line(x, -26, x, -1, { w: 1.4 }));
      d.ellipse(-4, -25, 5, 3, { fill: 'orange' });
      d.step();
      d.part('tail', A.swing(0.35, 0.8, -26, -48));
      d.curve([-26, -48, -32, -40, -32, -28], { part: 'tail' });
      d.dot(-32, -27, { r: 2.2, part: 'tail' });
    }
  });

  define('pig', {
    real: 0.8,
    tags: ['animals'], size: [60, 44], layer: 2, motion: 'walk', speed: 12, stride: 24,
    defaults: { color: 'red' },
    build(d, o) {
      d.step(); d.ellipse(0, -20, 22, 13, { fill: o.color });
      d.step(); d.circle(20, -26, 9, { fill: o.color });
      d.ellipse(28, -24, 3, 4, { fill: 'orange' });
      d.dot(27.5, -25.5, { r: 0.8 }); d.dot(28.5, -22.5, { r: 0.8 });
      d.tri(15, -33, 18, -40, 22, -34, { fill: o.color });
      d.dot(22, -29);
      d.step();
      [[-12, 0], [-5, Math.PI], [7, Math.PI], [13, 0]].forEach((l, i) => {
        d.part('leg' + i, A.gait(0.3, 24, l[0], -9, l[1]));
        d.line(l[0], -9, l[0], -1, { part: 'leg' + i, w: 1.6 });
      });
      d.step(); d.spiral(-24, -24, 4, 1.4, { w: 0.9 });
    }
  });

  define('duck', {
    real: 0.3,
    tags: ['animals', 'water'], size: [40, 34], layer: 4, motion: 'sail', speed: 9,
    defaults: { color: 'yellow' },
    build(d, o) {
      d.step(); d.poly(ellipsePts(0, -12, 16, 10, 0, Math.PI, 2), { fill: o.color });
      d.blob([-16, -12, -20, -20, -12, -16], { fill: o.color });
      d.step(); d.circle(10, -21, 7, { fill: o.color });
      d.tri(16, -22, 23, -19, 16, -17, { fill: 'orange' });
      d.dot(11, -23, { r: 1.3 });
      d.step(); d.arc(-1, -12, 8, 0.2, Math.PI - 0.2, { w: 0.9 });
    }
  });

  define('snail', {
    real: 0.06,
    tags: ['animals'], size: [56, 36], motion: 'crawl', speed: 4, layer: 2,
    defaults: { color: 'orange' },
    build(d, o) {
      d.step(); d.poly([-20, 0, 24, 0, 30, -4, 28, -14, 22, -14, 18, -5, -20, -3], { fill: 'yellow' });
      d.step(); d.circle(0, -16, 15, { fill: o.color });
      d.spiral(0, -16, 12, 2.2, { w: 0.9 });
      d.step();
      d.part('eyes', A.swing(0.15, 0.7, 24, -14));
      d.in('eyes', () => {
        d.line(24, -14, 22, -26); d.dot(22, -27, { r: 2 });
        d.line(27, -14, 30, -25); d.dot(30, -26, { r: 2 });
      });
    }
  });

  define('turtle', {
    real: 0.15,
    tags: ['animals'], size: [60, 30], motion: 'crawl', speed: 5, layer: 2,
    defaults: { color: 'green' },
    build(d, o) {
      d.step(); d.poly([-22, -6].concat(ellipsePts(0, -6, 22, 20, Math.PI, Math.PI, 2)), { fill: o.color });
      d.step(); d.poly([-8, -10, -4, -18, 4, -18, 8, -10, 4, -6, -4, -6], { w: 0.8 });
      d.line(-8, -10, -16, -9, { w: 0.8 }); d.line(8, -10, 16, -9, { w: 0.8 });
      d.line(-4, -18, -8, -23, { w: 0.8 }); d.line(4, -18, 8, -23, { w: 0.8 });
      d.step();
      d.part('head', A.swing(0.1, 0.4, 22, -8));
      d.circle(29, -10, 6.5, { fill: 'yellow', part: 'head' });
      d.dot(31, -12, { r: 1.2, part: 'head' });
      [[-14, 0], [12, Math.PI]].forEach((l, i) => {
        d.part('leg' + i, A.gait(0.25, 16, l[0], -6, l[1]));
        d.rect(l[0] - 3, -6, 6, 6, { fill: 'yellow', part: 'leg' + i });
      });
      d.tri(-22, -6, -28, -3, -22, -2, { fill: 'yellow' });
    }
  });

  define('ladybug', {
    real: 0.01,
    tags: ['animals'], size: [30, 22], motion: 'crawl', speed: 6, layer: 2,
    build(d) {
      d.step(); d.circle(11, -8, 4.5, { fill: 'black' });
      d.step(); d.poly([-12, -2].concat(ellipsePts(0, -2, 12, 11, Math.PI, Math.PI, 2)), { fill: 'red' });
      d.line(0, -13, 0, -2, { w: 0.8 });
      d.step(); d.dot(-6, -7, { r: 2 }); d.dot(5, -6, { r: 2 }); d.dot(-3, -10, { r: 1.5 });
      d.step();
      [-8, 0, 8].forEach((x, i) => {
        d.part('leg' + i, A.gait(0.4, 10, x, -2, i * 2));
        d.line(x, -2, x - 3, 0, { part: 'leg' + i, w: 0.8 });
      });
    }
  });

  // ---- scenery helpers -------------------------------------------------
  define('flag', {
    real: 8,
    tags: ['buildings'], size: [44, 90], layer: 1,
    defaults: { color: 'red', stripe: 'yellow' },
    build(d, o) {
      d.step(); d.line(0, 0, 0, -84, { w: 1.3 });
      d.circle(0, -86, 2.5, { fill: 'yellow' });
      d.step();
      d.part('flag', A.wave(3, 18, 5, 0, -82));
      d.in('flag', () => {
        d.rect(0, -82, 38, 24, { fill: o.color });
        d.rect(0, -74, 38, 8, { fill: o.stripe, ink: 'none', knock: true });
      });
    }
  });

  define('ground', {
    tags: ['scenery'], size: [1000, 20], layer: 0,
    defaults: { width: 1000, depth: 0, color: 'green' },
    build(d, o) {
      const w = o.width / 2;
      d.step();
      if (o.depth) d.rect(-w, 0, w * 2, o.depth, { fill: o.color, ink: 'none', hatch: -0.35, knock: false });
      d.line(-w, 0, w, 0, { ink: o.ink || o.color, w: 1.2 });
    }
  });

  define('road', {
    tags: ['scenery'], size: [1000, 40], layer: 0,
    defaults: { width: 1000, depth: 34 },
    build(d, o) {
      const w = o.width / 2;
      d.step(); d.line(-w, 0, w, 0, { w: 1.2 });
      d.line(-w, o.depth, w, o.depth, { w: 1.2 });
      d.step();
      for (let x = -w + 10; x < w; x += 44) d.line(x, o.depth / 2, x + 20, o.depth / 2, { ink: 'yellow', w: 1.6 });
    }
  });

  define('track', {
    tags: ['scenery'], size: [1000, 10], layer: 0,
    defaults: { width: 1000 },
    build(d, o) {
      const w = o.width / 2;
      d.step(); d.line(-w, 0, w, 0, { w: 1.2 });
      d.step(); for (let x = -w; x < w; x += 12) d.line(x, 0, x - 3, 6, { ink: 'brown', w: 1.4 });
    }
  });

  define('water', {
    tags: ['scenery', 'water'], size: [1000, 60], layer: 3.5,
    defaults: { width: 1000, depth: 80, color: 'blue' },
    build(d, o) {
      const w = o.width / 2;
      d.step();
      d.part('waves', { deform: (x, y, t) => [x, y + (y < 2 ? 2.2 * Math.sin(x / 14 + t * 2) : 0)] });
      const top = [];
      for (let x = -w; x <= w; x += 4) top.push(x, 0);
      d.poly(top.concat([w, o.depth, -w, o.depth]), { fill: o.color, ink: 'none', part: 'waves', hatch: -0.2, fillAlpha: 0.32, density: 0.6, knock: false });
      d.path(top, { ink: o.color, w: 1.2, part: 'waves' });
    }
  });

  // ------------------------------------------------------------------
  function createWorld(p, opts) { return new World(p, opts); }
  function list(tag) {
    return Object.keys(registry).filter((k) => !tag || (registry[k].tags || []).includes(tag));
  }

  return {
    version: '1.0.0',
    createWorld, World, Item, Builder,
    define, list, registry,
    anim, motions, palettes,
    util: { rng32, hash, resample, ellipsePts, catmull, rotPts, mirrorX, cren }
  };
}));
