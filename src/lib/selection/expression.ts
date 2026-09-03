import jsep from 'jsep'

export interface SelectionExpressionContext {
  x: number
  y: number
  z: number
  cx: number
  cy: number
  cz: number
  r: number
  el: string
}

type Value = number | string | boolean | null

const NUMERIC_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  exp: Math.exp,
  log: Math.log,
}

function numeric(value: Value, operator: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${operator} requires finite numbers`)
  }
  return value
}

function evaluate(node: jsep.Expression, context: SelectionExpressionContext, depth = 0): Value {
  if (depth > 32) throw new Error('Selection expression is too deeply nested')

  switch (node.type) {
    case 'Literal': {
      const value = (node as jsep.Literal).value
      if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) return value
      throw new Error('Only number, string, and boolean literals are allowed')
    }
    case 'Identifier': {
      const name = (node as jsep.Identifier).name
      if (name === 'PI') return Math.PI
      if (name in context) return context[name as keyof SelectionExpressionContext]
      throw new Error(`Unknown selection variable: ${name}`)
    }
    case 'UnaryExpression': {
      const unary = node as jsep.UnaryExpression
      const value = evaluate(unary.argument, context, depth + 1)
      if (unary.operator === '!') return !Boolean(value)
      if (unary.operator === '+') return numeric(value, '+')
      if (unary.operator === '-') return -numeric(value, '-')
      throw new Error(`Unsupported unary operator: ${unary.operator}`)
    }
    case 'BinaryExpression': {
      const binary = node as jsep.BinaryExpression
      if (binary.operator === '&&') {
        return Boolean(evaluate(binary.left, context, depth + 1)) && Boolean(evaluate(binary.right, context, depth + 1))
      }
      if (binary.operator === '||') {
        return Boolean(evaluate(binary.left, context, depth + 1)) || Boolean(evaluate(binary.right, context, depth + 1))
      }
      const left = evaluate(binary.left, context, depth + 1)
      const right = evaluate(binary.right, context, depth + 1)
      switch (binary.operator) {
        case '+': return numeric(left, '+') + numeric(right, '+')
        case '-': return numeric(left, '-') - numeric(right, '-')
        case '*': return numeric(left, '*') * numeric(right, '*')
        case '/': return numeric(left, '/') / numeric(right, '/')
        case '%': return numeric(left, '%') % numeric(right, '%')
        case '**': return numeric(left, '**') ** numeric(right, '**')
        case '<': return numeric(left, '<') < numeric(right, '<')
        case '<=': return numeric(left, '<=') <= numeric(right, '<=')
        case '>': return numeric(left, '>') > numeric(right, '>')
        case '>=': return numeric(left, '>=') >= numeric(right, '>=')
        case '==':
        case '===': return left === right
        case '!=':
        case '!==': return left !== right
        default: throw new Error(`Unsupported binary operator: ${binary.operator}`)
      }
    }
    case 'CallExpression': {
      const call = node as jsep.CallExpression
      if (call.callee.type !== 'Identifier') throw new Error('Only named selection functions are allowed')
      const name = (call.callee as jsep.Identifier).name
      const fn = NUMERIC_FUNCTIONS[name]
      if (!fn) throw new Error(`Unknown selection function: ${name}`)
      const args = call.arguments.map(argument => numeric(evaluate(argument, context, depth + 1), name))
      const result = fn(...args)
      if (!Number.isFinite(result)) throw new Error(`${name} produced a non-finite result`)
      return result
    }
    default:
      throw new Error(`Unsupported selection syntax: ${node.type}`)
  }
}

export function compileSelectionExpression(expression: string): (context: SelectionExpressionContext) => boolean {
  const source = expression.trim()
  if (!source) throw new Error('Enter a selection expression')
  if (source.length > 512) throw new Error('Selection expression is too long')
  const ast = jsep(source.replace(/\^/g, '**'))
  return (context) => Boolean(evaluate(ast, context))
}
