/*!
 * jQuery Ripples plugin v0.7.0 / https://github.com/sirxemic/jquery.ripples
 * MIT License
 * @author sirxemic / https://sirxemic.com/
 */
/**
 * Ripples — WebGL water ripple effect.
 *
 * Dependency-free core. Works on:
 *   - CSS background images (the classic behaviour)
 *   - <img>, <video> and <canvas> elements already present inside the target
 *   - any image/video URL passed through options
 *
 * See ./jquery-plugin.js for the (optional) jQuery adapter.
 */

const CANVAS_CLASS = 'ripples-canvas';
const INTERNAL_ATTR = 'data-ripples-internal';
const HOST_CLASS = 'jquery-ripples'; // kept for backwards compatibility
const STYLE_ID = 'ripples-style';

const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|ogv|mov)(\?|#|$)/i;
const URL_LIKE = /^(https?:)?\/\/|^data:|^blob:|^\/|^\.{0,2}\//i;

const DEFAULTS = {
  /**
   * Where the pixels come from. Accepts:
   *   null              → auto-detect (child <video>/<img>/<canvas>, else CSS background-image)
   *   'path/to.mp4'     → URL of an image or a video
   *   '#some-video'     → CSS selector, looked up inside the element first, then the document
   *   HTMLElement       → an existing <img>, <video> or <canvas>
   */
  source: null,
  /** Force the interpretation of a `source` string: 'auto' | 'image' | 'video'. */
  sourceType: 'auto',
  /** Legacy alias for `source`, kept so old code keeps working. */
  imageUrl: null,

  /**
   * How the source is laid out over the element:
   * 'auto' | 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'.
   *
   * 'auto' copies whatever the page already does:
   *   - a CSS background  → its background-size / -position / -attachment
   *   - an existing media element → its object-fit / object-position
   *   - a source we created ourselves → 'cover'
   */
  fit: 'auto',
  /** Only used when `fit` is not 'auto'. Same syntax as CSS `object-position`. */
  position: '50% 50%',

  /** Simulation grid size. Bigger = smoother and slower-propagating ripples. */
  resolution: 256,
  /** Radius (in CSS pixels) of a pointer-generated drop. */
  dropRadius: 20,
  /** Amount of refraction. 0 disables it. */
  perturbance: 0.03,
  /** How quickly the ripples die out. Closer to 1 = longer-lived. */
  damping: 0.995,
  /** Whether pointer movement/clicks create drops. */
  interactive: true,
  /** crossOrigin attribute used for images/videos loaded by URL. */
  crossOrigin: '',

  /** Device-pixel-ratio handling. A number, or 'auto' (clamped to `maxPixelRatio`). */
  pixelRatio: 'auto',
  maxPixelRatio: 1.5,

  /** Stop simulating while the element is scrolled out of view (IntersectionObserver). */
  pauseWhenOffscreen: true,
  /** Stop simulating while the tab is in the background. */
  pauseWhenHidden: true,
  /** Do nothing at all when the user asked for reduced motion. */
  respectReducedMotion: true,

  /** For sources we create ourselves. */
  autoplay: true,
  loop: true,
  muted: true,

  /** Hide the original source (CSS background / media element) once we take over. */
  hideSource: true,

  /** Called with an Error when initialisation or loading fails. */
  onError: null
};

// ---------------------------------------------------------------------------
// Capability detection (lazy — nothing touches the GPU until the first instance)
// ---------------------------------------------------------------------------

let capabilities;
let capabilitiesLoaded = false;

function getCapabilities () {
  if (!capabilitiesLoaded) {
    capabilitiesLoaded = true;
    try {
      capabilities = detectCapabilities();
    } catch (e) {
      capabilities = null;
    }
  }
  return capabilities
}

/**
 * Find a texture configuration the current browser can both filter and render to.
 * WebGL 2 is preferred (much wider float-texture support, no extensions needed for
 * half-float linear filtering); WebGL 1 keeps the original OES_texture_float path.
 */
function detectCapabilities () {
  const canvas = document.createElement('canvas');
  const attrs = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true };

  let gl = canvas.getContext('webgl2', attrs);
  let version = 2;

  if (!gl) {
    version = 1;
    gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  }
  if (!gl) return null

  const candidates = [];

  if (version === 2) {
    const colorFloat = gl.getExtension('EXT_color_buffer_float');
    const colorHalfFloat = gl.getExtension('EXT_color_buffer_half_float');
    const floatLinear = !!gl.getExtension('OES_texture_float_linear');

    // Half-float is both faster and always linearly filterable in WebGL 2, so try it first.
    if (colorFloat || colorHalfFloat) {
      candidates.push({ version, internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT, linear: true, extensions: [] });
    }
    if (colorFloat) {
      candidates.push({
        version,
        internalFormat: gl.RGBA32F,
        type: gl.FLOAT,
        linear: floatLinear,
        extensions: floatLinear ? ['OES_texture_float_linear'] : []
      });
    }
  } else {
    const extensions = {};
    for (const name of [
      'OES_texture_float',
      'OES_texture_half_float',
      'OES_texture_float_linear',
      'OES_texture_half_float_linear'
    ]) {
      if (gl.getExtension(name)) extensions[name] = true;
    }

    if (!extensions.OES_texture_float) return null

    const build = (kind, type) => {
      const name = 'OES_texture_' + kind;
      const linear = !!extensions[name + '_linear'];
      return {
        version,
        internalFormat: gl.RGBA,
        type,
        linear,
        extensions: linear ? [name, name + '_linear'] : [name]
      }
    };

    candidates.push(build('float', gl.FLOAT));
    if (extensions.OES_texture_half_float) {
      const halfFloat = gl.getExtension('OES_texture_half_float');
      candidates.push(build('half_float', halfFloat.HALF_FLOAT_OES));
    }
  }

  // Rendering *to* a float texture is a separate capability from sampling one, so probe it.
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let config = null;
  for (const candidate of candidates) {
    gl.texImage2D(gl.TEXTURE_2D, 0, candidate.internalFormat, 32, 32, 0, gl.RGBA, candidate.type, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      config = candidate;
      break
    }
  }

  // Release the probe context immediately; browsers only allow a handful of live contexts.
  const loseContext = gl.getExtension('WEBGL_lose_context');
  if (loseContext) loseContext.loseContext();

  return config
}

// ---------------------------------------------------------------------------
// Shared render loop — one rAF for every instance on the page
// ---------------------------------------------------------------------------

const activeInstances = new Set();
const SIMULATION_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

let frameHandle = null;
let previousTime = 0;

function tick (now) {
  frameHandle = requestAnimationFrame(tick);

  // Clamp so that returning to a backgrounded tab doesn't unleash a burst of steps.
  const delta = Math.min((now - previousTime) / 1000, 0.25);
  previousTime = now;

  for (const instance of activeInstances) {
    instance._frame(delta);
  }
}

function startLoop () {
  if (frameHandle === null) {
    previousTime = performance.now();
    frameHandle = requestAnimationFrame(tick);
  }
}

function stopLoop () {
  if (frameHandle !== null && activeInstances.size === 0) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function injectStyle () {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    `.${HOST_CLASS}{position:relative;z-index:0}` +
    `.${CANVAS_CLASS}{position:absolute;left:0;top:0;right:0;bottom:0;` +
    `width:100%;height:100%;display:block;z-index:-1;pointer-events:none}`;
  document.head.appendChild(style);
}

function compileShader (gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Ripples: shader compile error: ' + log)
  }
  return shader
}

function createProgram (gl, vertexSource, fragmentSource) {
  const id = gl.createProgram();
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  gl.attachShader(id, vertexShader);
  gl.attachShader(id, fragmentShader);
  gl.bindAttribLocation(id, 0, 'vertex');
  gl.linkProgram(id);

  // The shaders are owned by the program from here on.
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(id, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(id);
    gl.deleteProgram(id);
    throw new Error('Ripples: program link error: ' + log)
  }

  const locations = {};
  const regex = /uniform\s+\w+\s+(\w+)/g;
  const shaderCode = vertexSource + fragmentSource;
  let match;
  while ((match = regex.exec(shaderCode)) !== null) {
    locations[match[1]] = gl.getUniformLocation(id, match[1]);
  }

  return { id, locations }
}

function bindTexture (gl, texture, unit) {
  gl.activeTexture(gl.TEXTURE0 + (unit || 0));
  gl.bindTexture(gl.TEXTURE_2D, texture);
}

function isPercentage (value) {
  return typeof value === 'string' && value.charAt(value.length - 1) === '%'
}

function isPowerOfTwo (x) {
  return x > 0 && (x & (x - 1)) === 0
}

function extractUrl (value) {
  const match = /url\(["']?([^"')]*)["']?\)/.exec(value || '');
  return match ? match[1] : null
}

function isDataUri (url) {
  return /^data:/.test(url)
}

/** Turn a CSS background-position/object-position keyword soup into two values. */
function normalizePosition (value) {
  const parts = String(value || '50% 50%').trim().split(/\s+/);
  const map = { center: '50%', top: '0%', left: '0%', right: '100%', bottom: '100%' };

  if (parts.length === 1) {
    const single = parts[0];
    if (single === 'top' || single === 'bottom') return ['50%', map[single]]
    if (single === 'left' || single === 'right') return [map[single], '50%']
    return [map[single] || single, '50%']
  }

  // `top left` and `left top` are both legal; normalise the axis order.
  let x = parts[0];
  let y = parts[1];
  if (x === 'top' || x === 'bottom' || y === 'left' || y === 'right') {
    const swap = x;
    x = y;
    y = swap;
  }
  return [map[x] || x, map[y] || y]
}

/** Resolve a CSS length/percentage against a container size. */
function resolveLength (value, containerSize) {
  if (isPercentage(value)) return containerSize * parseFloat(value) / 100
  return parseFloat(value) || 0
}

function looksLikeVideoUrl (url) {
  return VIDEO_EXTENSIONS.test(url)
}

function isMediaElement (value) {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement &&
    (value instanceof HTMLImageElement ||
     value instanceof HTMLVideoElement ||
     value instanceof HTMLCanvasElement)
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERTEX_SHADER = `
attribute vec2 vertex;
varying vec2 coord;
void main() {
  coord = vertex * 0.5 + 0.5;
  gl_Position = vec4(vertex, 0.0, 1.0);
}`;

const DROP_SHADER = `
precision highp float;
const float PI = 3.141592653589793;
uniform sampler2D texture;
uniform vec2 center;
uniform float radius;
uniform float strength;
varying vec2 coord;
void main() {
  vec4 info = texture2D(texture, coord);
  float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - coord) / radius);
  drop = 0.5 - cos(drop * PI) * 0.5;
  info.r += drop * strength;
  gl_FragColor = info;
}`;

const UPDATE_SHADER = `
precision highp float;
uniform sampler2D texture;
uniform vec2 delta;
uniform float damping;
varying vec2 coord;
void main() {
  vec4 info = texture2D(texture, coord);
  vec2 dx = vec2(delta.x, 0.0);
  vec2 dy = vec2(0.0, delta.y);
  float average = (
    texture2D(texture, coord - dx).r +
    texture2D(texture, coord - dy).r +
    texture2D(texture, coord + dx).r +
    texture2D(texture, coord + dy).r
  ) * 0.25;
  info.g += (average - info.r) * 2.0;
  info.g *= damping;
  info.r += info.g;
  gl_FragColor = info;
}`;

const RENDER_VERTEX_SHADER = `
precision highp float;
attribute vec2 vertex;
uniform vec2 topLeft;
uniform vec2 bottomRight;
uniform vec2 containerRatio;
varying vec2 ripplesCoord;
varying vec2 backgroundCoord;
void main() {
  backgroundCoord = mix(topLeft, bottomRight, vertex * 0.5 + 0.5);
  backgroundCoord.y = 1.0 - backgroundCoord.y;
  ripplesCoord = vec2(vertex.x, -vertex.y) * containerRatio * 0.5 + 0.5;
  gl_Position = vec4(vertex.x, -vertex.y, 0.0, 1.0);
}`;

const RENDER_FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D samplerBackground;
uniform sampler2D samplerRipples;
uniform vec2 delta;
uniform float perturbance;
varying vec2 ripplesCoord;
varying vec2 backgroundCoord;
void main() {
  float height = texture2D(samplerRipples, ripplesCoord).r;
  float heightX = texture2D(samplerRipples, vec2(ripplesCoord.x + delta.x, ripplesCoord.y)).r;
  float heightY = texture2D(samplerRipples, vec2(ripplesCoord.x, ripplesCoord.y + delta.y)).r;
  vec3 dx = vec3(delta.x, heightX - height, 0.0);
  vec3 dy = vec3(0.0, heightY - height, delta.y);
  vec2 offset = -normalize(cross(dy, dx)).xz;
  float specular = pow(max(0.0, dot(offset, normalize(vec2(-0.6, 1.0)))), 4.0);
  gl_FragColor = texture2D(samplerBackground, backgroundCoord + offset * perturbance) + specular;
}`;

// ---------------------------------------------------------------------------
// Ripples
// ---------------------------------------------------------------------------

const registry = new WeakMap();

class Ripples {
  constructor (el, options = {}) {
    const config = getCapabilities();
    if (!config) {
      throw new Error(
        'Ripples: this browser does not support WebGL float textures ' +
        '(WebGL 2, or WebGL 1 with OES_texture_float and render-to-float support).'
      )
    }

    this.el = el;
    this.config = config;
    this.options = Object.assign({}, DEFAULTS, options);

    this.destroyed = false;
    this.visible = true;
    this.running = true;
    this.onScreen = true;
    this.contextLost = false;

    this.perturbance = this.options.perturbance;
    this.dropRadius = this.options.dropRadius;
    this.damping = this.options.damping;
    this.interactive = this.options.interactive;
    this.crossOrigin = this.options.crossOrigin;
    this.resolution = this.options.resolution;

    // Source state
    this.sourceElement = null;   // <img>/<video>/<canvas> we sample from, if any
    this.ownsSourceElement = false;
    this.sourceKey = null;       // used to skip redundant reloads
    this.sourceIsCssBackground = false;
    this.isDynamicSource = false;
    this.useVideoFrameCallback = false;
    this.sourceWidth = 1;
    this.sourceHeight = 1;
    this.sourceReady = false;
    this.borderLeft = 0;
    this.borderTop = 0;

    // Layout is expensive (it reads computed styles and forces layout), so it is
    // cached and only recomputed when something actually invalidates it.
    this.layoutDirty = true;
    this.usesFixedAttachment = false;
    this.simulationTime = 0;

    // Pointer input is collapsed to at most one drop per frame; a 1000Hz mouse
    // would otherwise issue a thousand render passes per second.
    this.pendingPointer = null;
    this.lastPointer = null;

    injectStyle();
    this._initCanvas();
    this._initGL();
    this._initSource();
    this._initObservers();
    this._initPointerEvents();

    registry.set(el, this);

    if (this.options.respectReducedMotion && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.running = false;
    }

    this._updateActive();
  }

  /** The instance attached to `el`, if any. */
  static get (el) {
    return registry.get(el) || null
  }

  /** True when the browser can run the effect at all. */
  static get supported () {
    return !!getCapabilities()
  }

  /**
   * Attach the effect to every element matching `target`.
   * Per-element options can be supplied through `data-ripples-*` attributes.
   */
  static attach (target, options = {}) {
    const elements = typeof target === 'string'
      ? document.querySelectorAll(target)
      : (target instanceof Element ? [target] : target);

    const created = [];
    for (const el of elements) {
      if (registry.has(el)) {
        created.push(registry.get(el));
        continue
      }
      try {
        created.push(new Ripples(el, Object.assign({}, options, readDataOptions(el))));
      } catch (e) {
        if (options.onError) options.onError(e, el);
        else if (typeof console !== 'undefined') console.warn(e.message);
      }
    }
    return created
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  _initCanvas () {
    const canvas = document.createElement('canvas');
    canvas.className = CANVAS_CLASS;
    this.canvas = canvas;

    this.el.classList.add(HOST_CLASS);
    this.el.appendChild(canvas);

    this._resizeCanvas();
  }

  _pixelRatio () {
    const option = this.options.pixelRatio;
    const ratio = option === 'auto' ? (window.devicePixelRatio || 1) : Number(option) || 1;
    return Math.max(1, Math.min(ratio, this.options.maxPixelRatio))
  }

  _resizeCanvas () {
    // clientWidth/clientHeight give the padding box, which is exactly what the
    // absolutely-positioned canvas is stretched to.
    const width = this.el.clientWidth;
    const height = this.el.clientHeight;
    const ratio = this._pixelRatio();

    const style = getComputedStyle(this.el);
    this.borderLeft = parseFloat(style.borderLeftWidth) || 0;
    this.borderTop = parseFloat(style.borderTopWidth) || 0;

    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));

    this.cssWidth = width;
    this.cssHeight = height;
    this.layoutDirty = true;

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      return true
    }
    return false
  }

  _initGL () {
    const attrs = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    };

    const gl = this.config.version === 2
      ? this.canvas.getContext('webgl2', attrs)
      : (this.canvas.getContext('webgl', attrs) || this.canvas.getContext('experimental-webgl', attrs));

    if (!gl) throw new Error('Ripples: could not create a WebGL context.')
    this.gl = gl;

    for (const name of this.config.extensions) {
      gl.getExtension(name);
    }
    if (this.config.version === 2) {
      gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('EXT_color_buffer_half_float');
      gl.getExtension('OES_texture_float_linear');
    }

    this._onContextLost = (e) => {
      e.preventDefault();
      this.contextLost = true;
      this._updateActive();
    };
    this._onContextRestored = () => {
      this.contextLost = false;
      this._buildGLResources();
      this.sourceKey = null;
      this._initSource();
      this._updateActive();
    };
    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

    this._buildGLResources();
  }

  _buildGLResources () {
    const gl = this.gl;
    const config = this.config;

    this.textureDelta = new Float32Array([1 / this.resolution, 1 / this.resolution]);
    this.textures = [];
    this.framebuffers = [];
    this.bufferWriteIndex = 0;
    this.bufferReadIndex = 1;

    const filter = config.linear ? gl.LINEAR : gl.NEAREST;

    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // A null pixel source is spec-guaranteed to be zero-filled, and avoids the
      // iOS half-float typed-array bug the old implementation worked around.
      gl.texImage2D(gl.TEXTURE_2D, 0, config.internalFormat, this.resolution, this.resolution, 0,
        gl.RGBA, config.type, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      this.textures.push(texture);
      this.framebuffers.push(framebuffer);
    }

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.dropProgram = createProgram(gl, VERTEX_SHADER, DROP_SHADER);
    this.updateProgram = createProgram(gl, VERTEX_SHADER, UPDATE_SHADER);
    this.renderProgram = createProgram(gl, RENDER_VERTEX_SHADER, RENDER_FRAGMENT_SHADER);

    gl.useProgram(this.updateProgram.id);
    gl.uniform2fv(this.updateProgram.locations.delta, this.textureDelta);

    gl.useProgram(this.renderProgram.id);
    gl.uniform2fv(this.renderProgram.locations.delta, this.textureDelta);
    gl.uniform1i(this.renderProgram.locations.samplerBackground, 0);
    gl.uniform1i(this.renderProgram.locations.samplerRipples, 1);

    this.backgroundTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._setTransparentTexture();

    gl.clearColor(0, 0, 0, 0);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.uniforms = {
      topLeft: new Float32Array([0, 0]),
      bottomRight: new Float32Array([1, 1]),
      containerRatio: new Float32Array([1, 1])
    };
    this.layoutDirty = true;
  }

  _initObservers () {
    // ResizeObserver reacts to the *element* resizing, not just the window, and
    // does so without any per-frame layout reads.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this._resizeCanvas();
      });
      this.resizeObserver.observe(this.el);
    } else {
      this._onWindowResize = () => this._resizeCanvas();
      window.addEventListener('resize', this._onWindowResize);
    }

    if (this.options.pauseWhenOffscreen && typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.onScreen = entries[entries.length - 1].isIntersecting;
        this._updateActive();
      }, { rootMargin: '10%' });
      this.intersectionObserver.observe(this.el);
    }

    if (this.options.pauseWhenHidden) {
      this._onVisibilityChange = () => this._updateActive();
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  _initPointerEvents () {
    const onPointerMove = (e) => {
      if (!this._pointerEventsEnabled()) return
      this.pendingPointer = { x: e.clientX, y: e.clientY, big: false };
    };

    const onPointerDown = (e) => {
      if (!this._pointerEventsEnabled()) return
      this.pendingPointer = { x: e.clientX, y: e.clientY, big: true };
    };

    this._onPointerMove = onPointerMove;
    this._onPointerDown = onPointerDown;
    this._onPointerLeave = () => { this.lastPointer = null; };

    const opts = { passive: true };
    this.el.addEventListener('pointermove', onPointerMove, opts);
    this.el.addEventListener('pointerdown', onPointerDown, opts);
    this.el.addEventListener('pointerleave', this._onPointerLeave, opts);
  }

  _pointerEventsEnabled () {
    return this.visible && this.running && this.interactive && !this.destroyed && !this.contextLost
  }

  // -------------------------------------------------------------------------
  // Source handling
  // -------------------------------------------------------------------------

  _initSource () {
    const resolved = this._resolveSource();

    if (!resolved) {
      this.sourceKey = null;
      this._detachSourceElement();
      this._setTransparentTexture();
      return
    }

    if (resolved.key === this.sourceKey) return
    this.sourceKey = resolved.key;

    if (resolved.element) {
      this._useElementSource(resolved.element, false);
    } else if (resolved.type === 'video') {
      this._useVideoUrl(resolved.url);
    } else {
      this._useImageUrl(resolved.url);
    }
  }

  /**
   * Work out what we should be sampling. Returns `{key, element}` or `{key, url, type}`.
   */
  _resolveSource () {
    const option = this.options.source != null ? this.options.source : this.options.imageUrl;

    if (isMediaElement(option)) {
      this.sourceIsCssBackground = false;
      return { key: option, element: option }
    }

    if (typeof option === 'string' && option !== '') {
      // A selector wins over a URL only when it actually matches something and
      // doesn't look like a path — this keeps `source: 'img/bg.jpg'` working.
      if (!URL_LIKE.test(option) && !/\.\w{2,5}(\?|#|$)/.test(option)) {
        const found = this.el.querySelector(option) || document.querySelector(option);
        if (isMediaElement(found)) {
          this.sourceIsCssBackground = false;
          return { key: found, element: found }
        }
      }
      this.sourceIsCssBackground = false;
      const type = this.options.sourceType !== 'auto'
        ? this.options.sourceType
        : (looksLikeVideoUrl(option) ? 'video' : 'image');
      return { key: type + ':' + option, url: option, type }
    }

    // Auto-detect: a media element that is a *direct child* of the target.
    // Deeper descendants are deliberately ignored — otherwise wrapping elements
    // like <body> would steal the first video they happen to contain. Use an
    // explicit `source` (element or selector) for anything nested.
    // Our own canvas and any media we created ourselves are excluded too.
    const media = this.el.querySelector(
      `:scope > video:not([${INTERNAL_ATTR}]), ` +
      `:scope > img:not([${INTERNAL_ATTR}]), ` +
      `:scope > canvas:not(.${CANVAS_CLASS})`
    );
    if (media) {
      this.sourceIsCssBackground = false;
      return { key: media, element: media }
    }

    // Fall back to the CSS background image.
    const url = extractUrl(this.originalCssBackgroundImage) ||
      extractUrl(getComputedStyle(this.el).backgroundImage);
    if (!url) return null

    this.sourceIsCssBackground = true;
    return { key: 'image:' + url, url, type: 'image' }
  }

  _useImageUrl (url) {
    const image = new Image();
    image.onload = () => {
      if (this.destroyed || this.sourceKey !== 'image:' + url) return
      this._useElementSource(image, true);
    };
    image.onerror = () => {
      if (this.destroyed) return
      this._setTransparentTexture();
      this._reportError(new Error('Ripples: failed to load image "' + url + '".'));
    };
    if (!isDataUri(url) && this.crossOrigin) image.crossOrigin = this.crossOrigin;
    image.src = url;
  }

  _useVideoUrl (url) {
    const video = document.createElement('video');
    video.src = url;
    video.loop = this.options.loop;
    video.muted = this.options.muted;
    video.defaultMuted = this.options.muted;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.setAttribute(INTERNAL_ATTR, '');
    if (!isDataUri(url) && this.crossOrigin) video.crossOrigin = this.crossOrigin;

    // Keep it in the document (detached videos are throttled or never decode) but
    // fully out of the way — the canvas is what the user sees.
    Object.assign(video.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-2'
    });
    this.el.appendChild(video);

    video.onerror = () => {
      if (this.destroyed) return
      this._setTransparentTexture();
      this._reportError(new Error('Ripples: failed to load video "' + url + '".'));
    };

    this._useElementSource(video, true);
  }

  _useElementSource (element, owned) {
    this._detachSourceElement();

    this.sourceElement = element;
    this.ownsSourceElement = owned;
    this.isDynamicSource = element instanceof HTMLVideoElement || element instanceof HTMLCanvasElement;
    this.sourceReady = false;
    this.frameDirty = true;

    if (element instanceof HTMLVideoElement) {
      this._setupVideoSource(element);
    } else if (element instanceof HTMLCanvasElement) {
      this.sourceWidth = element.width;
      this.sourceHeight = element.height;
      this.sourceReady = this.sourceWidth > 0 && this.sourceHeight > 0;
      if (this.sourceReady) this._onSourceReady();
    } else {
      if (element.complete && element.naturalWidth > 0) {
        this.sourceWidth = element.naturalWidth;
        this.sourceHeight = element.naturalHeight;
        this.sourceReady = true;
        this._uploadStaticTexture();
        this._onSourceReady();
      } else {
        this._onImageLoad = () => {
          if (this.destroyed || this.sourceElement !== element) return
          this.sourceWidth = element.naturalWidth;
          this.sourceHeight = element.naturalHeight;
          this.sourceReady = true;
          this._uploadStaticTexture();
          this._onSourceReady();
        };
        element.addEventListener('load', this._onImageLoad);
      }
    }
  }

  _setupVideoSource (video) {
    if (this.options.muted) {
      video.muted = true;
      video.defaultMuted = true;
    }
    if (this.options.loop && !video.hasAttribute('loop')) video.loop = true;
    if (!video.hasAttribute('playsinline')) {
      video.playsInline = true;
      video.setAttribute('playsinline', '');
    }

    const onReady = () => {
      if (this.destroyed || this.sourceElement !== video) return
      this.sourceWidth = video.videoWidth;
      this.sourceHeight = video.videoHeight;
      if (this.sourceWidth > 0 && this.sourceHeight > 0 && !this.sourceReady) {
        this.sourceReady = true;
        this._onSourceReady();
      }
      this.frameDirty = true;
    };

    this._onVideoReady = onReady;
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('resize', onReady);
    onReady();

    // requestVideoFrameCallback tells us exactly when a new frame is available,
    // so we can skip the (expensive) texture upload on frames that didn't change.
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.useVideoFrameCallback = true;
      const onVideoFrame = () => {
        if (this.destroyed || this.sourceElement !== video) return
        this.frameDirty = true;
        this.videoFrameHandle = video.requestVideoFrameCallback(onVideoFrame);
      };
      this.videoFrameHandle = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      this.useVideoFrameCallback = false;
      this.lastVideoTime = -1;
    }

    if (this.options.autoplay) {
      const attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          // Autoplay was blocked (usually: not muted). Retry on the next user gesture.
          this._resumeVideoOnGesture = () => {
            video.play().catch(() => {});
            document.removeEventListener('pointerdown', this._resumeVideoOnGesture);
          };
          document.addEventListener('pointerdown', this._resumeVideoOnGesture, { once: true });
        });
      }
    }
  }

  _onSourceReady () {
    this.layoutDirty = true;
    if (this.options.hideSource) this._hideSource();
  }

  _detachSourceElement () {
    const element = this.sourceElement;
    if (!element) return

    if (this._onImageLoad) {
      element.removeEventListener('load', this._onImageLoad);
      this._onImageLoad = null;
    }
    if (this._onVideoReady) {
      element.removeEventListener('loadedmetadata', this._onVideoReady);
      element.removeEventListener('loadeddata', this._onVideoReady);
      element.removeEventListener('resize', this._onVideoReady);
      this._onVideoReady = null;
    }
    if (this.videoFrameHandle != null && typeof element.cancelVideoFrameCallback === 'function') {
      element.cancelVideoFrameCallback(this.videoFrameHandle);
      this.videoFrameHandle = null;
    }
    if (this._resumeVideoOnGesture) {
      document.removeEventListener('pointerdown', this._resumeVideoOnGesture);
      this._resumeVideoOnGesture = null;
    }

    this._restoreSource();

    if (this.ownsSourceElement) {
      if (element instanceof HTMLVideoElement) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
      if (element.parentNode) element.parentNode.removeChild(element);
    }

    this.sourceElement = null;
    this.ownsSourceElement = false;
    this.isDynamicSource = false;
    this.sourceReady = false;
  }

  _uploadStaticTexture () {
    const gl = this.gl;
    const element = this.sourceElement;
    if (!gl || !element) return

    // Only power-of-two textures may repeat; videos and most photos are not.
    const repeat = isPowerOfTwo(this.sourceWidth) && isPowerOfTwo(this.sourceHeight);
    const wrapping = (repeat && this.sourceIsCssBackground) ? gl.REPEAT : gl.CLAMP_TO_EDGE;

    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapping);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapping);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element);
    } catch (e) {
      this._setTransparentTexture();
      this._reportError(new Error(
        'Ripples: could not upload the source to a texture. ' +
        'Cross-origin media needs CORS headers and a matching `crossOrigin` option.'
      ));
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  _uploadDynamicTexture () {
    const element = this.sourceElement;
    if (!element || !this.sourceReady) return

    if (element instanceof HTMLVideoElement) {
      if (element.readyState < 2) return
      if (this.useVideoFrameCallback) {
        if (!this.frameDirty) return
      } else {
        // No requestVideoFrameCallback: fall back to comparing the playback position.
        if (element.currentTime === this.lastVideoTime) return
        this.lastVideoTime = element.currentTime;
      }
    }
    // A <canvas> source gives us no change notification, so it is uploaded every frame.

    this.frameDirty = false;
    this._uploadStaticTexture();
  }

  _hideSource () {
    const element = this.sourceElement;

    if (element && !this.ownsSourceElement) {
      // An <img>/<video> the page already had: keep it in the layout (it defines
      // the element's size) but make it invisible. `opacity` rather than
      // `visibility`, because hidden videos may stop decoding.
      this.originalSourceOpacity = element.style.opacity;
      element.style.opacity = '0';
      return
    }

    if (this.sourceIsCssBackground) {
      const inline = this.el.style.backgroundImage;
      if (inline === 'none') return
      this.originalInlineCss = inline;
      this.originalCssBackgroundImage = getComputedStyle(this.el).backgroundImage;
      this.el.style.backgroundImage = 'none';
    }
  }

  _restoreSource () {
    const element = this.sourceElement;
    if (element && !this.ownsSourceElement && this.originalSourceOpacity !== undefined) {
      element.style.opacity = this.originalSourceOpacity;
      this.originalSourceOpacity = undefined;
    }
    if (this.sourceIsCssBackground && this.originalInlineCss !== undefined) {
      this.el.style.backgroundImage = this.originalInlineCss || '';
    }
  }

  _setTransparentTexture () {
    const gl = this.gl;
    if (!gl) return
    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  }

  _reportError (error) {
    if (typeof this.options.onError === 'function') this.options.onError(error, this.el);
    else if (typeof console !== 'undefined') console.warn(error.message);
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /**
   * Compute which region of the source maps onto the element, expressed in the
   * source's own 0..1 texture space. Only runs when `layoutDirty` is set.
   */
  _refreshLayout () {
    const width = this.cssWidth;
    const height = this.cssHeight;
    if (!width || !height) return

    const sourceWidth = this.sourceWidth || 1;
    const sourceHeight = this.sourceHeight || 1;

    let drawWidth;
    let drawHeight;
    let offsetX;
    let offsetY;

    const useCssBackground = this.options.fit === 'auto' && this.sourceIsCssBackground;

    if (useCssBackground) {
      const layout = this._cssBackgroundLayout(width, height, sourceWidth, sourceHeight);
      drawWidth = layout.drawWidth;
      drawHeight = layout.drawHeight;
      offsetX = layout.offsetX;
      offsetY = layout.offsetY;
    } else {
      let fit = this.options.fit;
      let position = this.options.position;

      if (fit === 'auto') {
        // Mirror however the page is already laying the media out, so the effect
        // lines up with what the user was seeing before we took over.
        if (this.sourceElement && !this.ownsSourceElement) {
          const style = getComputedStyle(this.sourceElement);
          fit = style.objectFit || 'cover';
          position = style.objectPosition || '50% 50%';
        } else {
          fit = 'cover';
        }
      }

      const [posX, posY] = normalizePosition(position);

      if (fit === 'fill') {
        drawWidth = width;
        drawHeight = height;
      } else if (fit === 'none') {
        drawWidth = sourceWidth;
        drawHeight = sourceHeight;
      } else {
        let scale = fit === 'cover'
          ? Math.max(width / sourceWidth, height / sourceHeight)
          : Math.min(width / sourceWidth, height / sourceHeight);
        // `scale-down` is `none` or `contain`, whichever is smaller.
        if (fit === 'scale-down') scale = Math.min(scale, 1);
        drawWidth = sourceWidth * scale;
        drawHeight = sourceHeight * scale;
      }

      offsetX = isPercentage(posX)
        ? (width - drawWidth) * parseFloat(posX) / 100
        : resolveLength(posX, width);
      offsetY = isPercentage(posY)
        ? (height - drawHeight) * parseFloat(posY) / 100
        : resolveLength(posY, height);
    }

    if (!drawWidth || !drawHeight) return

    const topLeft = this.uniforms.topLeft;
    const bottomRight = this.uniforms.bottomRight;
    topLeft[0] = -offsetX / drawWidth;
    topLeft[1] = -offsetY / drawHeight;
    bottomRight[0] = topLeft[0] + width / drawWidth;
    bottomRight[1] = topLeft[1] + height / drawHeight;

    const maxSide = Math.max(this.canvas.width, this.canvas.height);
    this.uniforms.containerRatio[0] = this.canvas.width / maxSide;
    this.uniforms.containerRatio[1] = this.canvas.height / maxSide;

    this.layoutDirty = false;
  }

  /** Mirror the element's CSS background-size / -position / -attachment. */
  _cssBackgroundLayout (width, height, sourceWidth, sourceHeight) {
    const style = getComputedStyle(this.el);
    const attachment = style.backgroundAttachment;
    const [posX, posY] = normalizePosition(style.backgroundPosition);
    let size = style.backgroundSize;

    this.usesFixedAttachment = attachment === 'fixed';

    // The "container" the background is sized against.
    let container;
    if (this.usesFixedAttachment) {
      container = {
        left: window.scrollX,
        top: window.scrollY,
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      };
    } else {
      container = { left: 0, top: 0, width, height };
    }

    let drawWidth;
    let drawHeight;

    if (size === 'cover' || size === 'contain') {
      const ratioX = container.width / sourceWidth;
      const ratioY = container.height / sourceHeight;
      const scale = size === 'cover' ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY);
      drawWidth = sourceWidth * scale;
      drawHeight = sourceHeight * scale;
    } else {
      const parts = size.split(' ');
      let rawWidth = parts[0] || 'auto';
      let rawHeight = parts[1] || 'auto';

      drawWidth = rawWidth === 'auto' ? 'auto' : resolveLength(rawWidth, container.width);
      drawHeight = rawHeight === 'auto' ? 'auto' : resolveLength(rawHeight, container.height);

      if (drawWidth === 'auto' && drawHeight === 'auto') {
        drawWidth = sourceWidth;
        drawHeight = sourceHeight;
      } else if (drawWidth === 'auto') {
        drawWidth = sourceWidth * (drawHeight / sourceHeight);
      } else if (drawHeight === 'auto') {
        drawHeight = sourceHeight * (drawWidth / sourceWidth);
      }
    }

    // Position of the background's top-left corner relative to the container.
    let backgroundX = isPercentage(posX)
      ? (container.width - drawWidth) * parseFloat(posX) / 100
      : resolveLength(posX, container.width);
    let backgroundY = isPercentage(posY)
      ? (container.height - drawHeight) * parseFloat(posY) / 100
      : resolveLength(posY, container.height);

    // For fixed attachment the background is anchored to the viewport, so we need
    // the element's position on the page to know which slice it sees.
    if (this.usesFixedAttachment) {
      const rect = this.el.getBoundingClientRect();
      backgroundX -= rect.left + window.scrollX - container.left;
      backgroundY -= rect.top + window.scrollY - container.top;
    }

    return { drawWidth, drawHeight, offsetX: backgroundX, offsetY: backgroundY }
  }

  // -------------------------------------------------------------------------
  // Simulation & rendering
  // -------------------------------------------------------------------------

  _updateActive () {
    const hidden = this.options.pauseWhenHidden && document.hidden;
    const shouldRun = !this.destroyed && !this.contextLost && this.visible && this.onScreen && !hidden;

    if (shouldRun) {
      if (!activeInstances.has(this)) {
        activeInstances.add(this);
        startLoop();
      }
    } else if (activeInstances.delete(this)) {
      stopLoop();
    }
  }

  /** Called by the shared rAF loop. */
  _frame (delta) {
    if (this.destroyed || this.contextLost) return

    if (this.usesFixedAttachment) this.layoutDirty = true;
    if (this.layoutDirty) this._refreshLayout();

    if (this.pendingPointer) {
      this._applyPendingPointer();
    }

    if (this.isDynamicSource) {
      this._uploadDynamicTexture();
    }

    if (this.running) {
      // A fixed timestep keeps the ripples travelling at the same speed on a
      // 60Hz laptop and a 165Hz monitor.
      this.simulationTime = Math.min(this.simulationTime + delta, SIMULATION_STEP * MAX_STEPS_PER_FRAME);
      while (this.simulationTime >= SIMULATION_STEP) {
        this.simulationTime -= SIMULATION_STEP;
        this._update();
      }
    }

    this._render();
  }

  _applyPendingPointer () {
    const pointer = this.pendingPointer;
    this.pendingPointer = null;

    const rect = this.el.getBoundingClientRect();
    const x = pointer.x - rect.left - this.borderLeft;
    const y = pointer.y - rect.top - this.borderTop;

    const radius = this.dropRadius * (pointer.big ? 1.5 : 1);
    const strength = pointer.big ? 0.14 : 0.01;

    // Interpolate along fast pointer movements so the trail doesn't get dotted.
    const previous = this.lastPointer;
    if (previous && !pointer.big) {
      const dx = x - previous.x;
      const dy = y - previous.y;
      const distance = Math.hypot(dx, dy);
      const steps = Math.min(Math.floor(distance / Math.max(radius, 1)), 8);
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1);
        this.drop(previous.x + dx * t, previous.y + dy * t, radius, strength);
      }
    }

    this.drop(x, y, radius, strength);
    this.lastPointer = { x, y };
  }

  _drawQuad () {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  }

  _update () {
    const gl = this.gl;
    gl.viewport(0, 0, this.resolution, this.resolution);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.bufferWriteIndex]);
    bindTexture(gl, this.textures[this.bufferReadIndex], 0);
    gl.useProgram(this.updateProgram.id);
    gl.uniform1f(this.updateProgram.locations.damping, this.damping);
    this._drawQuad();
    this._swapBuffers();
  }

  _render () {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.renderProgram.id);

    bindTexture(gl, this.backgroundTexture, 0);
    bindTexture(gl, this.textures[0], 1);

    const locations = this.renderProgram.locations;
    gl.uniform1f(locations.perturbance, this.perturbance);
    gl.uniform2fv(locations.topLeft, this.uniforms.topLeft);
    gl.uniform2fv(locations.bottomRight, this.uniforms.bottomRight);
    gl.uniform2fv(locations.containerRatio, this.uniforms.containerRatio);

    this._drawQuad();
    gl.disable(gl.BLEND);
  }

  _swapBuffers () {
    this.bufferWriteIndex = 1 - this.bufferWriteIndex;
    this.bufferReadIndex = 1 - this.bufferReadIndex;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Add a drop at element-relative coordinates (x, y). */
  drop (x, y, radius, strength) {
    if (this.destroyed || this.contextLost) return

    const gl = this.gl;
    const width = this.cssWidth;
    const height = this.cssHeight;
    const longestSide = Math.max(width, height);
    if (!longestSide) return

    const dropRadius = (radius === undefined ? this.dropRadius : radius) / longestSide;
    const dropStrength = strength === undefined ? 0.01 : strength;

    const center = new Float32Array([
      (2 * x - width) / longestSide,
      (height - 2 * y) / longestSide
    ]);

    gl.viewport(0, 0, this.resolution, this.resolution);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.bufferWriteIndex]);
    bindTexture(gl, this.textures[this.bufferReadIndex], 0);

    gl.useProgram(this.dropProgram.id);
    gl.uniform2fv(this.dropProgram.locations.center, center);
    gl.uniform1f(this.dropProgram.locations.radius, dropRadius);
    gl.uniform1f(this.dropProgram.locations.strength, dropStrength);

    this._drawQuad();
    this._swapBuffers();
  }

  /** Recompute the canvas size. Called automatically by the ResizeObserver. */
  updateSize () {
    this._resizeCanvas();
    this.layoutDirty = true;
  }

  show () {
    this.visible = true;
    this.canvas.style.display = '';
    if (this.options.hideSource) this._hideSource();
    this._updateActive();
  }

  hide () {
    this.visible = false;
    this.canvas.style.display = 'none';
    this._restoreSource();
    this._updateActive();
  }

  pause () {
    this.running = false;
  }

  play () {
    this.running = true;
  }

  /** Update a single option at runtime. */
  set (property, value) {
    switch (property) {
      case 'dropRadius':
      case 'perturbance':
      case 'damping':
      case 'interactive':
      case 'crossOrigin':
        this[property] = value;
        this.options[property] = value;
        break

      case 'fit':
      case 'position':
        this.options[property] = value;
        this.layoutDirty = true;
        break

      case 'pixelRatio':
      case 'maxPixelRatio':
        this.options[property] = value;
        this.updateSize();
        break

      case 'imageUrl':
      case 'source':
        this.options.source = value;
        this.options.imageUrl = property === 'imageUrl' ? value : null;
        this.sourceIsCssBackground = false;
        this._initSource();
        break

      case 'resolution':
        this.options.resolution = this.resolution = value;
        this._releaseGLResources();
        this._buildGLResources();
        this.sourceKey = null;
        this._initSource();
        break
    }
  }

  /** Swap the source without recreating the instance. */
  setSource (source, options = {}) {
    Object.assign(this.options, options);
    this.options.source = source;
    this.options.imageUrl = null;
    this.sourceIsCssBackground = false;
    this._initSource();
  }

  _releaseGLResources () {
    const gl = this.gl;
    if (!gl) return

    for (const texture of this.textures || []) gl.deleteTexture(texture);
    for (const framebuffer of this.framebuffers || []) gl.deleteFramebuffer(framebuffer);
    if (this.backgroundTexture) gl.deleteTexture(this.backgroundTexture);
    if (this.quad) gl.deleteBuffer(this.quad);
    for (const program of [this.dropProgram, this.updateProgram, this.renderProgram]) {
      if (program) gl.deleteProgram(program.id);
    }

    this.textures = [];
    this.framebuffers = [];
    this.backgroundTexture = null;
    this.quad = null;
    this.dropProgram = this.updateProgram = this.renderProgram = null;
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true;

    activeInstances.delete(this);
    stopLoop();

    this.el.removeEventListener('pointermove', this._onPointerMove);
    this.el.removeEventListener('pointerdown', this._onPointerDown);
    this.el.removeEventListener('pointerleave', this._onPointerLeave);

    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    if (this._onWindowResize) window.removeEventListener('resize', this._onWindowResize);
    if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange);

    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);

    this._detachSourceElement();
    this._releaseGLResources();

    // Free the GPU context eagerly — browsers cap the number of live contexts.
    const loseContext = this.gl && this.gl.getExtension('WEBGL_lose_context');
    if (loseContext) loseContext.loseContext();
    this.gl = null;

    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.el.classList.remove(HOST_CLASS);

    registry.delete(this.el);
  }
}

Ripples.DEFAULTS = DEFAULTS;

// ---------------------------------------------------------------------------
// data-* driven auto-initialisation
// ---------------------------------------------------------------------------

const BOOLEAN_OPTIONS = new Set([
  'interactive', 'pauseWhenOffscreen', 'pauseWhenHidden', 'respectReducedMotion',
  'autoplay', 'loop', 'muted', 'hideSource'
]);
const NUMBER_OPTIONS = new Set([
  'resolution', 'dropRadius', 'perturbance', 'damping', 'maxPixelRatio'
]);

/** Read `data-ripples-drop-radius="10"` style options off an element. */
function readDataOptions (el) {
  const options = {};
  for (const key in el.dataset) {
    if (!key.startsWith('ripples') || key === 'ripples') continue
    const name = key.charAt(7).toLowerCase() + key.slice(8);
    const raw = el.dataset[key];

    if (BOOLEAN_OPTIONS.has(name)) options[name] = raw !== 'false' && raw !== '0';
    else if (NUMBER_OPTIONS.has(name)) options[name] = parseFloat(raw);
    else if (name === 'pixelRatio') options[name] = raw === 'auto' ? 'auto' : parseFloat(raw);
    else options[name] = raw;
  }
  return options
}

/**
 * Initialise every `[data-ripples]` element on the page. Safe to call repeatedly —
 * elements that already have an instance are skipped.
 */
function autoInit (selector = '[data-ripples]', options = {}) {
  if (!Ripples.supported) return []
  return Ripples.attach(selector, options)
}

Ripples.autoInit = autoInit;
Ripples.readDataOptions = readDataOptions;

if (typeof document !== 'undefined') {
  const run = () => autoInit();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

/**
 * jQuery adapter for the Ripples core.
 *
 * Keeps the original `$(el).ripples(...)` API working while the actual work is
 * done by the dependency-free class in ./ripples.js.
 */


function registerJQueryPlugin ($) {
  if (!$ || !$.fn) return

  const previous = $.fn.ripples;

  $.fn.ripples = function (option, ...args) {
    if (!Ripples.supported) {
      throw new Error(
        'Your browser does not support WebGL, the OES_texture_float extension or rendering to floating point textures.'
      )
    }

    return this.each(function () {
      const instance = Ripples.get(this);

      if (!instance) {
        // Methods on an uninitialised element are a no-op, as before.
        if (typeof option === 'string') return

        // Precedence: plain data-* attributes (legacy) < data-ripples-* < explicit options.
        const options = $.extend(
          {},
          $(this).data(),
          readDataOptions(this),
          typeof option === 'object' ? option : null
        );
        // `.data()` also hands back the raw `ripples*` keys that readDataOptions
        // already normalised, so drop them.
        for (const key of Object.keys(options)) {
          if (key.startsWith('ripples')) delete options[key];
        }

        new Ripples(this, options); // eslint-disable-line no-new
        return
      }

      if (typeof option === 'string') {
        const method = instance[option];
        if (typeof method === 'function' && option.charAt(0) !== '_') {
          method.apply(instance, args);
        }
      }
    })
  };

  $.fn.ripples.Constructor = Ripples;
  $.fn.ripples.DEFAULTS = Ripples.DEFAULTS;

  $.fn.ripples.noConflict = function () {
    $.fn.ripples = previous;
    return this
  };
}

/**
 * Standalone bundle entry point — no jQuery required.
 *
 * If jQuery happens to be on the page, the `$.fn.ripples` plugin is registered
 * too, so this build is a drop-in replacement for the jQuery one.
 */


if (typeof window !== 'undefined' && window.jQuery) {
  registerJQueryPlugin(window.jQuery);
}

Ripples.registerJQueryPlugin = registerJQueryPlugin;

export { Ripples as default };
//# sourceMappingURL=ripples.esm.js.map
