import { assertEqual, assertTrue } from '../testing/assert'
import {
  buildSpeciesColorTable, writeSpeciesColors, buildInstanceColors, buildElementTables,
  type CompactStructure,
} from '../lib/render/compact-structure'

function testSpeciesColorTablePaletteWins() {
  const palette = new Float32Array([1, 0, 0, 0, 0, 1]) // species0 red, species1 blue
  const table = buildSpeciesColorTable(['Si', 'Ge'], palette)
  assertEqual(table[0], 1, 's0 r'); assertEqual(table[1], 0, 's0 g'); assertEqual(table[2], 0, 's0 b')
  assertEqual(table[3], 0, 's1 r'); assertEqual(table[4], 0, 's1 g'); assertEqual(table[5], 1, 's1 b')
}

function testSpeciesColorTableFallsBackToElements() {
  const table = buildSpeciesColorTable(['Si', 'Ge'])
  const elem = buildElementTables(['Si', 'Ge']).colors
  assertEqual(table.length, 6, 'len')
  for (let i = 0; i < 6; i++) assertEqual(table[i], elem[i], `elem color ${i}`)
}

function testWriteSpeciesColors() {
  const table = new Float32Array([1, 0, 0, 0, 0, 1])
  const species = new Uint8Array([0, 1, 1])
  const out = new Float32Array(9)
  writeSpeciesColors(species, table, out)
  assertEqual(out[0], 1, 'a0 r'); assertEqual(out[5], 1, 'a1 b'); assertEqual(out[8], 1, 'a2 b')
}

function testBuildInstanceColorsUsesPalette() {
  const compact: CompactStructure = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0]),
    elementIndex: new Uint8Array([0, 1]),
    elements: ['Si', 'Ge'],
    count: 2,
    bbox: { min: [0, 0, 0], max: [1, 0, 0] },
    palette: new Float32Array([1, 1, 1, 0, 0, 0]), // species0 white, species1 black
  }
  const tables = buildElementTables(compact.elements)
  const colors = buildInstanceColors(compact, tables, false)
  assertEqual(colors[0], 1, 'atom0 white r'); assertEqual(colors[1], 1, 'atom0 white g'); assertEqual(colors[2], 1, 'atom0 white b')
  assertEqual(colors[3], 0, 'atom1 black r'); assertEqual(colors[4], 0, 'atom1 black g'); assertEqual(colors[5], 0, 'atom1 black b')
}

function run() {
  testSpeciesColorTablePaletteWins()
  testSpeciesColorTableFallsBackToElements()
  testWriteSpeciesColors()
  testBuildInstanceColorsUsesPalette()
  assertTrue(true, 'reached end')
  console.log('species-colors tests passed')
}

run()
