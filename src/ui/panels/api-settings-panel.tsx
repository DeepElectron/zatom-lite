import { useState } from "react"
import { KeyRound, Lock, ShieldCheck, Server } from "lucide-react"
import { getGlobalBackendClient } from "../../host"
import { isBoltzTestKey } from "../../services/boltz-client"
import { useBoltzApiKeyStore } from "../../orchestration/boltzApiKeyStore"

/**
 * External data sources and credentials. Boltz is the only source that accepts
 * a user-provided key in this page. Materials Project and PubChem use the
 * deployment's BackendService contract, which has no key parameter; RCSB is a
 * public direct download. Read-only rows make those ownership boundaries clear
 * without presenting credential fields that would have no effect.
 */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--panel-text-tertiary)]">
      {children}
    </h3>
  )
}

function BoltzKeyField() {
  const apiKey = useBoltzApiKeyStore((state) => state.apiKey)
  const setApiKey = useBoltzApiKeyStore((state) => state.setApiKey)
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <SectionHeading>Boltz API key</SectionHeading>
      <div className="relative">
        <KeyRound className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--panel-text-tertiary)]" />
        <input
          aria-label="Boltz API key"
          type={revealed ? "text" : "password"}
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          placeholder="sk_bc_..."
          spellCheck={false}
          className="zatom-field w-full rounded-xl py-2.5 pl-9 pr-14 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          className="zatom-pressable absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-1 text-[9px] font-semibold text-[var(--panel-text-secondary)]"
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
      <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
        {apiKey.trim() && isBoltzTestKey(apiKey)
          ? "Test key detected — synthetic results, no GPU cost."
          : "Kept only until this browser tab closes. A key containing _test_ runs free synthetic jobs."}
      </p>
    </div>
  )
}

/** Read-only data source whose endpoint and credential ownership are predefined. */
function ManagedSourceRow({
  name,
  endpoint,
  note,
  icon,
}: {
  name: string
  endpoint: string
  note: string
  icon: React.ReactNode
}) {
  return (
    <li
      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2"
      style={{ backgroundColor: "var(--panel-elevated)" }}
    >
      <span className="mt-0.5 text-[var(--panel-text-tertiary)]" aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold text-[var(--panel-text)]">{name}</span>
          <span className="truncate font-mono text-[9px] text-[var(--panel-text-tertiary)]">{endpoint}</span>
        </div>
        <p className="text-[9px] leading-relaxed text-[var(--panel-text-secondary)]">{note}</p>
      </div>
    </li>
  )
}

export function ApiSettingsPanel() {
  const hasBackend = getGlobalBackendClient() !== null

  return (
    <div className="flex flex-col gap-5">
      <BoltzKeyField />

      <div className="flex flex-col gap-1.5">
        <SectionHeading>Managed data sources</SectionHeading>
        <p className="px-1 text-[9px] leading-relaxed text-[var(--panel-text-tertiary)]">
          {"These need no key from you \u2014 credentials live outside the browser or aren\u2019t required."}
        </p>
        <ul className="flex flex-col gap-1.5">
          <ManagedSourceRow
            name="Materials Project"
            endpoint="via host backend"
            note={
              hasBackend
                ? "Backend connected. Its API key is held by the deployment backend, not the browser."
                : "Backend not connected — crystal search is unavailable until the deployment connects one."
            }
            icon={<Server className="h-3.5 w-3.5" />}
          />
          <ManagedSourceRow
            name="PubChem"
            endpoint="via host backend"
            note={
              hasBackend
                ? "Backend connected. PUG REST needs no key."
                : "Backend not connected — molecule search is unavailable until the deployment connects one."
            }
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
          />
          <ManagedSourceRow
            name="RCSB PDB"
            endpoint="files.rcsb.org"
            note="Fetched directly from the browser. Public downloads, no key needed."
            icon={<Lock className="h-3.5 w-3.5" />}
          />
        </ul>
      </div>
    </div>
  )
}
