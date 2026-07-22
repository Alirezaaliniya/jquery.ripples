Ripples
=======

By the powers of WebGL, add a layer of water to your HTML elements which will ripple by cursor interaction.

Works with **CSS background images**, **`<img>` elements**, **`<video>` elements** and **`<canvas>` elements** — including videos that are already in your markup.

Requirements: WebGL 2, or WebGL 1 with the `OES_texture_float` extension and support for rendering to float textures. Cross-origin media needs proper CORS headers (see [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)).

Installation
------------

```
npm install jquery.ripples
```

Or drop one of the builds in `dist/` on your page:

| File | Use it when |
|------|-------------|
| `dist/ripples.js` | You don't use jQuery. Exposes the global `Ripples`. |
| `dist/ripples-min.js` | Same, minified. |
| `dist/jquery.ripples.js` | You want the `$(el).ripples()` plugin. Load after jQuery. |
| `dist/jquery.ripples-min.js` | Same, minified. |
| `dist/ripples.esm.js` | ES module, for bundlers. |

Quick start
-----------

### The zero-JavaScript way

Add `data-ripples` to any region. It is initialised automatically on page load.

```html
<div class="hero" data-ripples data-ripples-perturbance="0.04">
  <video src="clip.mp4" autoplay muted loop playsinline></video>
</div>
```

Every option has a `data-ripples-*` equivalent, in kebab-case: `data-ripples-drop-radius="14"`, `data-ripples-fit="contain"`, and so on.

### With JavaScript

```js
// Every element matching the selector.
Ripples.attach('.hero');

// A single element, with options.
const ripples = new Ripples(document.querySelector('.hero'), {
  resolution: 512,
  perturbance: 0.04
});
```

### With jQuery

```js
$('.hero').ripples({ resolution: 512, perturbance: 0.04 });
```

Choosing the source
-------------------

By default the plugin works out what to ripple, in this order:

1. An `<img>`, `<video>` or `<canvas>` that is a **direct child** of the element.
2. The element's CSS `background-image`.

Deeper descendants are ignored on purpose, so a wrapper like `<body>` doesn't grab the first video it happens to contain. For anything nested, name it explicitly:

```js
// An element you already have
new Ripples(el, { source: document.querySelector('#my-video') });

// A CSS selector (searched inside the element first, then the document)
new Ripples(el, { source: '#my-video' });

// A URL — the plugin creates a hidden <img> or <video> for you
new Ripples(el, { source: 'clips/waves.mp4' });
new Ripples(el, { source: 'images/photo.jpg' });
```

Videos are detected by file extension. If your URL has no extension (a CDN or blob URL, say), be explicit with `sourceType: 'video'`.

Once a source is taken over, the original is hidden: a CSS background is set to `none`, and a media element gets `opacity: 0` — it stays in the layout and keeps decoding, but you see the rippled version on the canvas.

### Fitting the source to the element

With the default `fit: 'auto'`, the effect copies however the page already lays the source out:

- a CSS background → its `background-size`, `background-position` and `background-attachment`
- an existing `<img>`/`<video>` → its `object-fit` and `object-position`
- a source the plugin created itself → `cover`

Override it with `fit` (`'cover' | 'contain' | 'fill' | 'none' | 'scale-down'`) and `position`.

Options
-------

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `source` | string \| Element \| null | `null` | Element, CSS selector or URL to ripple. `null` auto-detects (see above). |
| `sourceType` | string | `'auto'` | Force a `source` URL to be treated as `'image'` or `'video'`. |
| `imageUrl` | string | `null` | Legacy alias for `source`. |
| `fit` | string | `'auto'` | `auto`, `cover`, `contain`, `fill`, `none` or `scale-down`. |
| `position` | string | `'50% 50%'` | Like CSS `object-position`. Ignored when `fit` is `'auto'`. |
| `resolution` | integer | `256` | Simulation grid size. Larger = smoother, and ripples propagate more slowly. |
| `dropRadius` | float | `20` | Size in CSS pixels of a pointer-generated drop. |
| `perturbance` | float | `0.03` | Amount of refraction. `0` disables it. |
| `damping` | float | `0.995` | How long ripples survive. Closer to `1` = longer. |
| `interactive` | bool | `true` | Whether pointer movement and clicks create drops. |
| `crossOrigin` | string | `''` | `crossOrigin` attribute for media loaded by URL. |
| `pixelRatio` | number \| `'auto'` | `'auto'` | Device-pixel-ratio for the canvas. |
| `maxPixelRatio` | number | `1.5` | Upper clamp for `'auto'`, so 3× phone screens stay fast. |
| `pauseWhenOffscreen` | bool | `true` | Stop simulating while scrolled out of view. |
| `pauseWhenHidden` | bool | `true` | Stop simulating while the tab is in the background. |
| `respectReducedMotion` | bool | `true` | Start paused when the user prefers reduced motion. |
| `autoplay` | bool | `true` | Play videos the plugin creates. Retried on the first user gesture if blocked. |
| `loop` | bool | `true` | Loop videos the plugin creates. |
| `muted` | bool | `true` | Mute videos the plugin creates. Required for autoplay. |
| `hideSource` | bool | `true` | Hide the original background/media once the effect takes over. |
| `onError` | function | `null` | Called with `(error, element)` when loading or initialisation fails. |

Methods
-------

With the class API, call methods on the instance:

```js
const ripples = Ripples.get(element);  // or the value returned by `new Ripples(...)`
ripples.drop(x, y, 20, 0.04);
```

With jQuery, pass the method name as a string, exactly as before:

```js
$('.hero').ripples('drop', x, y, 20, 0.04);
```

| Method | Description |
|--------|-------------|
| `drop(x, y, radius, strength)` | Add a drop at element-relative coordinates. |
| `destroy()` | Remove the effect and free the GPU resources. |
| `show()` / `hide()` | Toggle visibility. Hiding also pauses the simulation. |
| `pause()` / `play()` | Toggle the simulation. |
| `set(name, value)` | Update one option at runtime (see the table above). |
| `setSource(source, options?)` | Swap the source without recreating the instance. |
| `updateSize()` | Recompute the canvas size. Rarely needed — a `ResizeObserver` does this automatically. |

Statics
-------

| Member | Description |
|--------|-------------|
| `Ripples.supported` | `true` when the browser can run the effect. |
| `Ripples.get(el)` | The instance attached to `el`, or `null`. |
| `Ripples.attach(target, options?)` | Attach to a selector, element or list. Skips elements that already have an instance. |
| `Ripples.autoInit(selector?, options?)` | Initialise `[data-ripples]` elements. Runs once automatically on page load. |

Notes on performance
--------------------

- All instances share a single `requestAnimationFrame` loop.
- Instances that are scrolled off-screen, or in a background tab, stop simulating.
- The simulation runs on a fixed 60 Hz timestep, so ripples travel at the same speed on a 60 Hz laptop and a 165 Hz monitor.
- Video frames are uploaded to the GPU only when a new frame is actually decoded (via `requestVideoFrameCallback` where available).
- Layout is read from the DOM only when something changes, not every frame.
- Each instance needs its own WebGL context and browsers cap those at roughly 16, so avoid attaching to dozens of elements at once. `destroy()` releases the context immediately.

Migrating from 0.6.x
--------------------

The jQuery API is unchanged — `$(el).ripples(...)`, all the old methods and the `imageUrl`, `resolution`, `dropRadius`, `perturbance`, `interactive` and `crossOrigin` options still work the same way.

What changed:

- The default export is now the `Ripples` class, and jQuery is optional.
- An `<img>`/`<video>`/`<canvas>` child now takes priority over the CSS background. Set `source` explicitly if you relied on the background of an element that also contains media.
- `destroy()` now also frees the WebGL context and deletes GPU resources.
- The build requires Node 18+ and produces sourcemaps.

Building
--------

```
npm install
npm run build
```

License
-------

MIT
