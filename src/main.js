/**
 * jQuery bundle entry point: registers `$.fn.ripples` and exposes the core class.
 *
 * `Ripples.attach`, `Ripples.autoInit`, `Ripples.get` and `Ripples.supported` are
 * available as statics on the default export.
 */

import $ from 'jquery'
import Ripples from './ripples.js'
import { registerJQueryPlugin } from './jquery-plugin.js'

registerJQueryPlugin($)

Ripples.registerJQueryPlugin = registerJQueryPlugin

export default Ripples
