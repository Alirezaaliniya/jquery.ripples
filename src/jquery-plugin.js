/**
 * jQuery adapter for the Ripples core.
 *
 * Keeps the original `$(el).ripples(...)` API working while the actual work is
 * done by the dependency-free class in ./ripples.js.
 */

import { Ripples, readDataOptions } from './ripples.js'

export function registerJQueryPlugin ($) {
  if (!$ || !$.fn) return

  const previous = $.fn.ripples

  $.fn.ripples = function (option, ...args) {
    if (!Ripples.supported) {
      throw new Error(
        'Your browser does not support WebGL, the OES_texture_float extension or rendering to floating point textures.'
      )
    }

    return this.each(function () {
      const instance = Ripples.get(this)

      if (!instance) {
        // Methods on an uninitialised element are a no-op, as before.
        if (typeof option === 'string') return

        // Precedence: plain data-* attributes (legacy) < data-ripples-* < explicit options.
        const options = $.extend(
          {},
          $(this).data(),
          readDataOptions(this),
          typeof option === 'object' ? option : null
        )
        // `.data()` also hands back the raw `ripples*` keys that readDataOptions
        // already normalised, so drop them.
        for (const key of Object.keys(options)) {
          if (key.startsWith('ripples')) delete options[key]
        }

        new Ripples(this, options) // eslint-disable-line no-new
        return
      }

      if (typeof option === 'string') {
        const method = instance[option]
        if (typeof method === 'function' && option.charAt(0) !== '_') {
          method.apply(instance, args)
        }
      }
    })
  }

  $.fn.ripples.Constructor = Ripples
  $.fn.ripples.DEFAULTS = Ripples.DEFAULTS

  $.fn.ripples.noConflict = function () {
    $.fn.ripples = previous
    return this
  }
}
