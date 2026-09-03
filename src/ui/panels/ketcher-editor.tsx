"use client"

/**
 * KetcherEditor —— open-source 2D molecule structure editor (EPAM Ketcher).
 *
 * This is the heavy editor body. It is ONLY imported via React.lazy from
 * fragment-2d-drawer.tsx so it never enters the main bundle. Ketcher is the
 * closest open-source analog to ChemDraw: ring/template library, bond/charge
 * editing, canonical rendering, SMILES / MOLfile I-O.
 *
 * The component mounts <Editor> with the StandaloneStructServiceProvider
 * (Indigo runs fully client-side, no server) and hands the live `Ketcher`
 * instance back to the parent via onInit so the parent can pull MOLfile / SMILES
 * for the "Add to 3D" / "Save as fragment" / export bridges.
 */

import { Editor } from "ketcher-react"
import { StandaloneStructServiceProvider } from "ketcher-standalone"
import type { Ketcher } from "ketcher-core"
import "ketcher-react/dist/index.css"

const structServiceProvider = new StandaloneStructServiceProvider()

export interface KetcherEditorProps {
  /** Called once the Ketcher instance is ready; parent keeps the ref for I/O. */
  onInit: (ketcher: Ketcher) => void
}

export default function KetcherEditor({ onInit }: KetcherEditorProps) {
  return (
    <Editor
      staticResourcesUrl=""
      structServiceProvider={structServiceProvider}
      errorHandler={(message: string) => {
        // Ketcher surfaces parse/render errors here; keep them in console.
        console.warn("[KetcherEditor]", message)
      }}
      onInit={(ketcher: Ketcher) => {
        onInit(ketcher)
      }}
    />
  )
}
