import { compileSelectionExpression } from '../lib/selection/expression'
import { assertEqual, assertTrue } from '../testing/assert'

const context = { x: 1, y: 0, z: 2, cx: 0, cy: 0, cz: 0, r: Math.sqrt(5), el: 'C' }

assertEqual(compileSelectionExpression('r < 3')(context), true, 'radius comparisons must evaluate')
assertEqual(compileSelectionExpression('sqrt((x-cx)^2 + (y-cy)^2) < 2 && abs(z-cz) < 5')(context), true, 'documented functions and power syntax must evaluate')
assertEqual(compileSelectionExpression('el == "C" && z >= cz')(context), true, 'element and coordinate predicates must compose')
assertEqual(compileSelectionExpression('el != "C" || r > 3')(context), false, 'boolean operators must preserve predicate meaning')

const mustReject = (source: string) => {
  let rejected = false
  try {
    compileSelectionExpression(source)(context)
  } catch {
    rejected = true
  }
  assertTrue(rejected, `unsafe or unsupported expression must be rejected: ${source}`)
}

mustReject('globalThis.process')
mustReject('window.alert(1)')
mustReject('constructor("return 1")()')
mustReject('sqrt(-1)')
mustReject('x = 1')

console.log('selection expression tests passed')
