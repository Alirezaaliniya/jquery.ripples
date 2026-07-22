import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import terser from '@rollup/plugin-terser'

const require = createRequire(import.meta.url)
const dirname = path.dirname(fileURLToPath(import.meta.url))
const { version } = require('../package.json')

const banner = `/*!
 * jQuery Ripples plugin v${version} / https://github.com/sirxemic/jquery.ripples
 * MIT License
 * @author sirxemic / https://sirxemic.com/
 */`

const resolve = (...parts) => path.join(dirname, '..', ...parts)

/** One source file → an unminified and a minified UMD bundle. */
function bundle ({ input, file, name, external = [], globals = {} }) {
  return [
    {
      input: resolve(input),
      external,
      output: { file: resolve(file + '.js'), format: 'umd', name, globals, banner, sourcemap: true }
    },
    {
      input: resolve(input),
      external,
      output: { file: resolve(file + '-min.js'), format: 'umd', name, globals, banner, sourcemap: true },
      plugins: [terser({ format: { comments: /^!/ } })]
    }
  ]
}

export default [
  // jQuery build — keeps `$(el).ripples()` working exactly as before.
  ...bundle({
    input: 'src/main.js',
    file: 'dist/jquery.ripples',
    name: 'Ripples',
    external: ['jquery'],
    globals: { jquery: 'jQuery' }
  }),

  // Standalone build — no dependencies at all.
  ...bundle({
    input: 'src/standalone.js',
    file: 'dist/ripples',
    name: 'Ripples'
  }),

  // ES module build, for bundlers.
  {
    input: resolve('src/standalone.js'),
    output: { file: resolve('dist/ripples.esm.js'), format: 'es', banner, sourcemap: true }
  }
]
