/**
 * End-to-end check that the scene tools let a model answer structural
 * questions correctly and cheaply.
 *
 * A real model gets the real `scene_*` + `structure_*` tools through the same
 * dispatch the MCP server uses, one structure with known ground truth per
 * task, and a question. Each answer is graded against that ground truth and
 * the number of tool calls is recorded: the header work is meant to make the
 * first `scene_grid` call sufficient for most questions.
 *
 *   pnpm eval:scene-grid              # all tasks
 *   pnpm eval:scene-grid slab liquid  # a subset
 *   EVAL_MODEL=anthropic/claude-opus-4.8 pnpm eval:scene-grid
 *
 * Authentication is the AI Gateway's (OIDC on Vercel, AI_GATEWAY_API_KEY
 * elsewhere); nothing is read here.
 */
import { ToolLoopAgent, type ToolSet, jsonSchema, stepCountIs, tool } from 'ai'

import type { ZatomStructure } from '../src/agent/contracts'
import { zatomToolDomain } from '../src/agent/domains'
import { callZatomMcpTool, listZatomMcpTools } from '../src/agent/mcp-adapter'
import { createInMemoryToolContext } from '../src/testing/in-memory-tool-context'

const MODEL = process.env.EVAL_MODEL ?? 'anthropic/claude-sonnet-4.6'
const MAX_STEPS = 8

// ---------------------------------------------------------------------------
// Fixtures with ground truth
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number]
const A_CU = 3.615
const FCC_BASIS: Vec3[] = [
  [0, 0, 0],
  [0.5, 0.5, 0],
  [0.5, 0, 0.5],
  [0, 0.5, 0.5],
]

const structure = (
  id: string,
  atoms: { id: string; element: string; position: Vec3 }[],
  vectors: Vec3[],
  periodic: [boolean, boolean, boolean],
): ZatomStructure =>
  ({
    schemaVersion: 'zatom.structure/v1',
    label: id,
    atoms,
    lattice: { vectors, periodic },
  }) as unknown as ZatomStructure

/** 3x3 in-plane, four (001) layers of fcc Cu, 12 A vacuum, one O on top of a surface atom at 1.90 A. */
const slabWithAdatom = () => {
  const atoms: { id: string; element: string; position: Vec3 }[] = []
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 2; k++)
        for (const [u, v, w] of FCC_BASIS)
          atoms.push({
            id: `Cu${atoms.length}`,
            element: 'Cu',
            position: [(i + u) * A_CU, (j + v) * A_CU, (k + w) * A_CU],
          })
  const zTop = Math.max(...atoms.map((a) => a.position[2]))
  const anchor = atoms.find((a) => Math.abs(a.position[2] - zTop) < 1e-6)!
  atoms.push({ id: 'O1', element: 'O', position: [anchor.position[0], anchor.position[1], zTop + 1.9] })
  return {
    structure: structure(
      'cu001-slab-o',
      atoms,
      [
        [3 * A_CU, 0, 0],
        [0, 3 * A_CU, 0],
        [0, 0, 2 * A_CU + 12],
      ],
      [true, true, false],
    ),
    anchorId: anchor.id,
  }
}

/** Rutile TiO2. */
const rutile = () => {
  const a = 4.594
  const c = 2.959
  const u = 0.305
  const rows: [string, number, number, number][] = [
    ['Ti', 0, 0, 0],
    ['Ti', 0.5, 0.5, 0.5],
    ['O', u, u, 0],
    ['O', 1 - u, 1 - u, 0],
    ['O', 0.5 + u, 0.5 - u, 0.5],
    ['O', 0.5 - u, 0.5 + u, 0.5],
  ]
  return structure(
    'rutile',
    rows.map(([el, x, y, z], i) => ({ id: `${el}${i}`, element: el, position: [x * a, y * a, z * c] })),
    [
      [a, 0, 0],
      [0, a, 0],
      [0, 0, c],
    ],
    [true, true, true],
  )
}

/** Deterministic liquid Ar: 400 atoms, min separation 3.2 A, 30 A box. */
const liquidAr = () => {
  let seed = 7
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const L = 30
  const positions: Vec3[] = []
  let guard = 0
  while (positions.length < 400 && guard++ < 200000) {
    const p: Vec3 = [rand() * L, rand() * L, rand() * L]
    const ok = positions.every((q) => {
      let d2 = 0
      for (let i = 0; i < 3; i++) {
        let x = p[i] - q[i]
        x -= L * Math.round(x / L)
        d2 += x * x
      }
      return d2 > 3.2 * 3.2
    })
    if (ok) positions.push(p)
  }
  return structure(
    'liquid-ar',
    positions.map((position, i) => ({ id: `Ar${i}`, element: 'Ar', position })),
    [
      [L, 0, 0],
      [0, L, 0],
      [0, 0, L],
    ],
    [true, true, true],
  )
}

/** 27 waters on a 3.3 A grid in a 10 A box. */
const waterBox = () => {
  const atoms: { id: string; element: string; position: Vec3 }[] = []
  let n = 0
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) {
        const o: Vec3 = [1 + i * 3.3, 1 + j * 3.3, 1 + k * 3.3]
        atoms.push(
          { id: `O${n}`, element: 'O', position: o },
          { id: `Ha${n}`, element: 'H', position: [o[0] + 0.96, o[1], o[2]] },
          { id: `Hb${n}`, element: 'H', position: [o[0] - 0.24, o[1] + 0.93, o[2]] },
        )
        n++
      }
  return structure(
    'water-box',
    atoms,
    [
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ],
    [true, true, true],
  )
}

interface Task {
  name: string
  structure: ZatomStructure
  question: string
  /** Each check returns a failure message or null. */
  checks: ((answer: string) => string | null)[]
}

const mustMatch = (label: string, re: RegExp) => (answer: string) => (re.test(answer) ? null : `missing ${label}`)
const mustNotMatch = (label: string, re: RegExp) => (answer: string) =>
  re.test(answer) ? `wrongly claims ${label}` : null

const buildTasks = (): Task[] => {
  const slab = slabWithAdatom()
  return [
    {
      name: 'slab',
      structure: slab.structure,
      question:
        'Describe this structure: what kind of system is it, how many atomic layers does the slab have, ' +
        'what adsorbate is present, which atom id is it bonded to, and at what distance? Give atom ids.',
      checks: [
        mustMatch('4 Cu layers', /\b(4|four)\b[^.]*\blayers?\b|\blayers?\b[^.]*\b(4|four)\b/i),
        mustMatch('oxygen adsorbate', /\boxygen\b|\bO\b(?!\w)/),
        mustMatch(`anchor id ${slab.anchorId}`, new RegExp(`\\b${slab.anchorId}\\b`)),
        mustMatch('Cu-O 1.90 A', /1\.9\d?\s*(Å|A\b|angstrom)/i),
        mustNotMatch('more than one adatom', /\b(two|three|several|multiple)\s+(O|oxygen)\s+(atoms|adatoms|adsorbates)/i),
      ],
    },
    {
      name: 'rutile',
      structure: rutile(),
      question:
        'What is the coordination number of Ti and of O in this crystal? Answer with two integers and one sentence.',
      checks: [
        mustMatch('Ti CN 6', /Ti[^.\n]*\b6\b|\b6\b[^.\n]*Ti/),
        mustMatch('O CN 3', /\bO\b[^.\n]*\b3\b|\b3\b[^.\n]*\bO\b/),
      ],
    },
    {
      name: 'liquid',
      structure: liquidAr(),
      question:
        'Is this a crystal, a surface slab, or a disordered system? Are there any surface atoms or adatoms? ' +
        'Answer in two sentences.',
      checks: [
        mustMatch('disordered/liquid', /disordered|liquid|amorphous|no long-range order/i),
        mustNotMatch('surface atoms or adatoms present', /\b(there are|has|contains|with)\b[^.]*\b\d+\s+(surface atoms|adatoms)/i),
      ],
    },
    {
      name: 'water',
      structure: waterBox(),
      question: 'What does this periodic cell contain? How many molecules, and of what?',
      checks: [
        mustMatch('27 molecules', /\b27\b/),
        mustMatch('water', /water|H2O|H₂O/i),
        mustNotMatch('lattice/surface language', /\b(surface|bulk|adatom|lattice site)s?\b/i),
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// Agent over the real tool dispatch
// ---------------------------------------------------------------------------

const EXPOSED_DOMAINS = new Set(['viewport', 'edit'])

const runTask = async (task: Task) => {
  const context = createInMemoryToolContext()
  context.writeStructure!(task.structure)

  const calls: string[] = []
  const tools: ToolSet = {}
  for (const def of listZatomMcpTools()) {
    if (!EXPOSED_DOMAINS.has(zatomToolDomain(def.name) ?? '')) continue
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema<Record<string, unknown>>(def.inputSchema as Record<string, unknown>),
      execute: async (input) => {
        calls.push(def.name)
        const result = await callZatomMcpTool(def.name, input, context)
        return result.content.map((c) => ('text' in c ? c.text : '')).join('\n')
      },
    })
  }

  const agent = new ToolLoopAgent({
    model: MODEL,
    instructions:
      'You are a materials scientist. A structure is loaded in the workspace. Use the tools to inspect it, ' +
      'then answer precisely. Prefer the fewest tool calls that give a confident answer. ' +
      'Never guess atom ids or distances: only report ones you saw in tool output.',
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  })

  const started = performance.now()
  const result = await agent.generate({ prompt: task.question })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  const failures = task.checks.map((check) => check(result.text)).filter((f): f is string => f !== null)
  return { calls, failures, seconds, answer: result.text }
}

const main = async () => {
  const only = new Set(process.argv.slice(2))
  const tasks = buildTasks().filter((t) => only.size === 0 || only.has(t.name))
  console.log(`model=${MODEL} tasks=${tasks.map((t) => t.name).join(',')}\n`)

  let failed = 0
  for (const task of tasks) {
    const { calls, failures, seconds, answer } = await runTask(task)
    const status = failures.length === 0 ? 'PASS' : 'FAIL'
    if (failures.length > 0) failed++
    console.log(`[${status}] ${task.name}  tools=${calls.length} (${calls.join(' > ')})  ${seconds}s`)
    for (const f of failures) console.log(`       - ${f}`)
    console.log(
      answer
        .trim()
        .split('\n')
        .map((l) => `       | ${l}`)
        .join('\n'),
    )
    console.log()
  }
  console.log(`${tasks.length - failed}/${tasks.length} passed`)
  process.exitCode = failed > 0 ? 1 : 0
}

await main()
