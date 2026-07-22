/**
 * Standalone bundle entry point — no jQuery required.
 *
 * If jQuery happens to be on the page, the `$.fn.ripples` plugin is registered
 * too, so this build is a drop-in replacement for the jQuery one.
 */

import Ripples from './ripples.js'
import { registerJQueryPlugin } from './jquery-plugin.js'

if (typeof window !== 'undefined' && window.jQuery) {
  registerJQueryPlugin(window.jQuery)
}

Ripples.registerJQueryPlugin = registerJQueryPlugin

export default Ripples
