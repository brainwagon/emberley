# emberley.js

Animated, felt-tip drawings in the spirit of Ed Emberley's
*Make a World*, for [p5.js](https://p5js.org).  Each item is built
from the book's alphabet of circles, lines, triangles and dots.  It
draws itself one step at a time with a marker, then comes to life:
wheels roll, legs walk, flags wave, smoke puffs and propellers spin.

One file, no dependencies beyond p5.js (1.x).

**Live demo:** <https://mvandewettering.com/emberley/> (also the
[gallery](https://mvandewettering.com/emberley/gallery.html),
[everything sheet](https://mvandewettering.com/emberley/sheet.html)
and [size line-up](https://mvandewettering.com/emberley/sizes.html)).

An unofficial homage: the drawings are original, made in the style
of Ed Emberley's drawing books, and this project isn't affiliated
with him or his publishers.

## Files

| File           | What it is                                         |
| -------------- | -------------------------------------------------- |
| `emberley.js`  | The library                                        |
| `index.html`   | A whole world that draws itself; click to add more |
| `gallery.html` | The book's step-by-step strips, item by item       |
| `sheet.html`   | Every item at once, animating in place             |
| `sizes.html`   | Every item at its natural size, smallest to largest |
| `about.md`     | Your own story, shown by the main page's About button |
| `about.js`     | Loads `about.md` into that panel (tiny Markdown converter) |

Browsers won't load the scripts from `file://` in every case, so
serve the folder:

    python3 -m http.server 8000    # then open localhost:8000

## About page

Write anything you like in `about.md` (plain Markdown: headings,
paragraphs, *italic*, **bold**, links, pictures, lists, quotes).  The
main page loads it automatically: an **About** button appears in the
toolbar and opens it in a side panel, and `index.html#about` links
straight to it.  While the file has nothing but comments the button
stays hidden.  Pictures can sit next to it, e.g. `![me](images/me.jpg)`.

Browsers won't let a page read `about.md` when it's opened as a
`file://` URL, so the button only shows on the live site or from a
local server (`python3 -m http.server`).

## Quick start

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<script src="emberley.js"></script>
<script>
new p5((p) => {
  let world;
  p.setup = () => {
    p.createCanvas(800, 400);
    world = Emberley.createWorld(p, { palette: 'makeaworld' });
    world.add('house', { x: 200, y: 300 });
    world.add('car', { x: 100, y: 360, color: 'blue', delay: 3 });
    world.add('bird', { x: 500, y: 100, delay: 5 });
  };
  p.draw = () => world.frame();   // update + paper + items
});
</script>
```

In global mode call `Emberley.createWorld()` with no argument
inside `setup()`.

## Items

`Emberley.list()` returns every name; `Emberley.list('animals')`
filters by tag.

- **people:** person, girl, king, knight, soldier, cowboy, clown
- **buildings:** house, castle, windmill, lighthouse, tent, flag
- **nature:** tree, pine, flower, mushroom, grass, mountain, hill
- **sky:** sun, moon, star, cloud, airplane, helicopter, rocket,
  balloon
- **vehicles:** car, truck, bus, engine, coach, caboose, train
  (`cars: 2`, `caboose: true`)
- **boats:** sailboat, ship, submarine (under water)
- **animals:** bird, butterfly, fish, shark, cat, blackcat, elephant,
  trex, dog, horse, cow, pig, duck, snail, turtle, ladybug
- **scenery:** ground, road, track, water (take `width`, `depth`)

Ground items stand with their feet on `y`; sky items (birds,
planes, sun) are centred on `y`.

## Relative sizes

Each item knows its real height in metres (`real` in its
definition), and is drawn at a natural size relative to a person,
who is 100 px tall at scale 1.  True scale would make a castle ten
people tall and a ladybug invisible, so sizes are compressed the way
a picture book's are:

    size = 100 * (metres / 1.75) ^ sizeExponent     (default 0.45)

So a cat is about 45 px, a car 95, an elephant 130, a house 200
and a castle 290.  `scale` multiplies that, so one `scale` for
everything keeps them in proportion; use a smaller `scale` for
things further away.  `sizeExponent: 1` gives true scale, `0`
makes everything the same height, and `sizes: false` (or
`natural: false` on one item) turns natural sizing off.
`sizes.html` has a slider to compare.

## `world.add(name, options)`

| Option      | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `x`, `y`    | Position in canvas pixels                            |
| `scale`     | Multiplies the natural size (a person = 100 px)      |
| `natural`   | `false`: ignore the natural size for this item       |
| `color`     | Main colour (palette name); some items take more,    |
|             | e.g. `roof`, `sail`, `wings`, `hair`, `stripe`       |
| `facing`    | `1` / `'right'` or `-1` / `'left'`                   |
| `motion`    | `still sway drive walk crawl fly flutter hover swim` |
|             | `sail float drift launch`, or a function `(it, dt)`  |
| `speed`     | Travel speed in px/second                            |
| `delay`     | Seconds before the pen starts                        |
| `drawTime`  | Seconds to draw it (default: from pen speed)         |
| `instant`   | Skip the drawing animation                           |
| `steps`     | Only draw the first N book steps                     |
| `animate`   | `false` freezes it once drawn                        |
| `layer`,`z` | Draw order (then by `y`)                             |
| `seed`      | Fixes the hand-drawn wobble                          |
| `onDrawn`   | Callback when the drawing is finished                |

It returns the item, whose fields (`x`, `y`, `speed`, `facing`,
`motion`, `scale`...) can be changed at any time.
`item.redraw(delay)` starts the drawing again.

## World

```js
Emberley.createWorld(p, {
  palette: 'makeaworld', // or 'classic', 'retro', 'riso',
                         // 'duotone', or an object
  penWidth: 2.6,       // marker width in px
  wobble: 0.9,         // hand wobble in px
  inkSpeed: 200,       // pen speed in px/second
  boil: true,          // hand-drawn "boiling" lines
  boilRate: 5,         // boil frames per second
  showPen: true,       // draw the marker while drawing
  paper: true,         // paper background with fibres
  wrap: true,          // travellers wrap around the canvas
  sizes: true,         // natural relative sizes (see above)
  sizeExponent: 0.45,  // 1 = true scale, 0 = all the same height
  seed: 1
});
```

- `world.frame()` - `update()` then `draw()`; call from `p.draw`
- `world.update(dt?)`, `world.draw()`, `world.drawPaper()`,
  `world.drawItems()` - the pieces, if you want to draw your own
  things in between
- `world.strip(name, x, y, opts)` - the book's step-by-step strip;
  `opts.alive` lets the last panel animate
- `world.redraw(stagger)`, `world.remove(item)`, `world.clear()`
- `world.itemAt(x, y)` - rough hit test
- `world.setPalette(nameOrObject)`
- `world.naturalScale(name)` - the size factor an item gets
- `world.pen.circle(x, y, r, { fill: 'red' })` - immediate felt-tip
  shapes (`circle ellipse rect poly tri line path curve blob arc dot
  zigzag spiral`) using the current p5 transform

## Palettes

Items name colours, not hex values, so a palette is just these keys:
`paper black red orange yellow green blue brown grey sage`.

The default, `makeaworld`, is sampled from the book's cover:
red `#e3241b` (a more saturated take on the cover's `#e24a25`),
sky blue `#03ade5`, green `#40ac48` and black `#1f1f1f`, with grey
`#9f9390` and sage `#79b881`, on white, plus an added yellow
`#fcc30b` for suns and the like.  The book has no orange or brown,
so `orange` maps to the red and `brown` to grey.  Pass a partial
object to override some of them:

```js
world.setPalette({ red: '#c0392b', paper: '#fffaf0' });
```

## Drawing your own items

Definitions use the same shapes the book does.  Each `d.step()` is
one panel of the book's strip.

```js
Emberley.define('robot', {
  real: 2,              // metres tall, for its natural size
  size: [50, 90], motion: 'walk', speed: 20, tags: ['people'],
  defaults: { color: 'blue' },
  build(d, o) {
    d.step(); d.rect(-10, -88, 20, 18);                 // head
    d.step(); d.dot(-4, -80); d.dot(4, -80);
    d.step(); d.rect(-14, -68, 28, 34, { fill: o.color });
    d.step();
    d.part('legL', Emberley.anim.gait(0.4, 34, -6, -34));
    d.part('legR', Emberley.anim.gait(0.4, 34, 6, -34, Math.PI));
    d.line(-6, -34, -6, 0, { part: 'legL' });
    d.line(6, -34, 6, 0, { part: 'legR' });
  }
});
```

Shapes: `circle ellipse rect tri poly path line curve blob arc dot
zigzag spiral`, all in local units (y up is negative; ground items
stand on `y = 0`).  Shape options:

- `fill` - palette name or CSS colour.  As in the book, a filled
  shape is solid colour with no outline, and it covers whatever is
  under it.
- `ink` - line colour.  Unfilled shapes and lines default to black
  (arms, legs, eyes, masts); setting it on a filled shape adds an
  outline; `'none'` removes a line.
- `w` - line width multiplier
- `part` - attach to an animated part
- `knock: false` - let a shape or line mix with what's under it,
  like layered marker ink (used for smoke, clouds and water).  By
  default everything is flat colour that covers what it crosses, so
  a grey trunk over a grey head doesn't darken.
- `hatch` - scribble angle; `fillAlpha`, `density` - lighter or
  sparser colouring

Other builder calls:

- `d.in(part, fn)` - put several shapes on one part
- `d.at(dx, dy, fn)` - offset some shapes
- `d.use(name, dx, dy, opts)` - include another item; this is how
  `train` is built from an `engine` and `coach`es

`Emberley.anim` makes part movements:

| Helper                                 | Movement                    |
| -------------------------------------- | --------------------------- |
| `spin(speed, px, py)`                  | Constant rotation           |
| `roll(r, px, py)`                      | Wheel, follows travel       |
| `gait(amp, stride, px, py, phase)`     | Leg swing, follows travel   |
| `swing(amp, freq, px, py, phase)`      | Pendulum                    |
| `bob(amp, freq)`                       | Up and down                 |
| `flap(freq, px, py, axis, min)`        | Wings, propellers           |
| `flicker(amp, freq, px, py)`           | Flames, twinkles            |
| `wave(amp, wavelength, speed, px, py)` | Flags (bends the points)    |
| `puff(period, rise, drift, phase, px, py)` | Smoke and bubbles       |

A part is any object with `pivot` plus functions of `(t, item)` for
`rot dx dy sx sy alpha`, an optional `deform(x, y, t)`, and an
optional `parent` part.

## How the felt-tip look works

- Strokes are resampled and nudged sideways by slow waves, so lines
  wobble like a hand.
- Colours are flat and opaque, as in the book's printing; with
  `knock: false` ink blends like marker instead, darkening where it
  overlaps and pooling where the pen lands and lifts.
- Shapes are solid colour with no outline, filled with one
  continuous marker zigzag clipped to the (slightly wobbly) shape.
- Three versions of every stroke cycle a few times a second (the
  "boil" of hand-drawn animation).  `boil: false` turns this off.
