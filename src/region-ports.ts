/** K3 Host assembly: public Painter/Brush entries as Workshop's region ports, and protocol major+capability status. */
import { ContractError, checkProtocolCompatibility, protocolRequirement, regionCapabilities, regionInvariants } from 'hanaworlds-contracts'
import { serviceIdentity } from './image-media.ts'

/** Workshop region port shape (contract operation names, ProtocolHandshake property). */
export interface RegionPort {
  readonly protocolHandshake: unknown
  call(operation: string, request: unknown): Promise<unknown>
}
/** Painter 0.4.0 public service: same `call` entry for painter/v4 and painter-region/v1. */
export interface PainterRegionEntry {
  protocolHandshake?(): unknown
  call?(operation: string, request: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
}
/** Brush 0.5.0 public BrushV3: pure compileRegion and its ProtocolHandshake. */
export interface BrushRegionEntry {
  protocolHandshake?(): unknown
  compileRegion?(request: unknown): unknown
}
export interface RegionPortServices {
  painter(): PainterRegionEntry | undefined
  brush(): BrushRegionEntry | undefined
  canvasRegion(): RegionPort | undefined
  adapterRegion(): RegionPort | undefined
}
const capabilities = (wire: string) => regionCapabilities.map(c => c.id).filter(id => id.startsWith(`${wire}:`)).sort()
/** Every region seam the K3 write path crosses, in path order. */
export const REGION_SEAMS = Object.freeze([
  { seam: 'painter', label: 'Painter', service: 'hanaworldsPainterV2PictureBlocks → hanaworldsPainterRegionV1', wire: 'painter-region/v3' },
  { seam: 'brush', label: 'Brush', service: 'hanaworldsBrushV3 → hanaworldsBrushRegionV1', wire: 'region-build/v2' },
  { seam: 'canvas', label: 'Canvas', service: 'hanaworldsCanvasRegionV1', wire: 'canvas-region/v3' },
  { seam: 'adapter', label: 'Adapter', service: 'hanaworldsWorldAdapterRegionV1', wire: 'world-adapter-region/v3' },
] as const)
export type RegionSeam = typeof REGION_SEAMS[number]['seam']
export interface RegionSeamStatus {
  seam: RegionSeam
  label: string
  service: string
  wire: string
  requiredCapabilities: string[]
  compatible: boolean
  /** Advertised component, protocol and package identity; recorded only, never compared. */
  matched: unknown
  unmet: { code: string; need: string; remedy: string } | null
}

function deny(code: string): never { throw new Error(code) }

/** Compatibility of one advertised handshake with its wire's major and owned capabilities. */
function check(seam: typeof REGION_SEAMS[number], present: boolean, handshake: unknown): RegionSeamStatus {
  const requiredCapabilities = capabilities(seam.wire)
  const base = { seam: seam.seam, label: seam.label, service: seam.service, wire: seam.wire, requiredCapabilities }
  if (!present) return { ...base, compatible: false, matched: null, unmet: { code: 'PEER_UNAVAILABLE',
    need: `${seam.label} service ${seam.service} (${seam.wire})`, remedy: `Install/enable a ${seam.label} plugin providing ${seam.wire}.` } }
  try {
    const matched = checkProtocolCompatibility(handshake ?? null, [protocolRequirement(seam.wire, requiredCapabilities)])
    return { ...base, compatible: true, matched: structuredClone(matched), unmet: null }
  } catch (error) {
    if (!(error instanceof ContractError)) throw error
    return { ...base, compatible: false, matched: null, unmet: { code: error.code,
      need: `${seam.label} ProtocolHandshake with ${seam.wire} (same major) and ${requiredCapabilities.join(', ')}`,
      remedy: `Install a ${seam.label} build advertising that protocol major and capabilities.` } }
  }
}

/**
 * Map only methods the installed peers actually publish; a missing method or handshake leaves the
 * port absent so Workshop reports PEER_UNAVAILABLE instead of a renamed service hiding the gap.
 */
export class DesktopRegionPorts {
  constructor(private readonly services: RegionPortServices) {}
  /** Painter's ValidateRegionProposal through its own public `call`, bound to the captured service object. */
  painterPort(): RegionPort | undefined {
    const painter = this.services.painter()
    if (typeof painter?.call !== 'function' || typeof painter.protocolHandshake !== 'function') return undefined
    const services = this.services
    return {
      get protocolHandshake() { return painter.protocolHandshake?.() },
      async call(operation, request) {
        if (operation !== 'ValidateRegionProposal') deny('UNSUPPORTED_OPERATION')
        if (serviceIdentity(services.painter()) !== serviceIdentity(painter)) deny('REGION_PEER_REPLACED')
        const result = await painter.call?.(operation, request)
        if (serviceIdentity(services.painter()) !== serviceIdentity(painter)) deny('REGION_PEER_REPLACED')
        return result
      },
    }
  }
  /** Brush's pure compileRegion as the region-build/v1 CompileRegionBuild operation. */
  brushPort(): RegionPort | undefined {
    const brush = this.services.brush()
    if (typeof brush?.compileRegion !== 'function' || typeof brush.protocolHandshake !== 'function') return undefined
    const services = this.services
    return {
      get protocolHandshake() { return brush.protocolHandshake?.() },
      async call(operation, request) {
        if (operation !== 'CompileRegionBuild') deny('UNSUPPORTED_OPERATION')
        if (serviceIdentity(services.brush()) !== serviceIdentity(brush)) deny('REGION_PEER_REPLACED')
        const result = await brush.compileRegion?.(request)
        if (serviceIdentity(services.brush()) !== serviceIdentity(brush)) deny('REGION_PEER_REPLACED')
        return result
      },
    }
  }
  /** Current major+capability status of all four region seams (the Adapter seam is Canvas's own consumer check too). */
  status(): RegionSeamStatus[] {
    const painter = this.painterPort(), brush = this.brushPort()
    const canvas = this.services.canvasRegion(), adapter = this.services.adapterRegion()
    const ports = { painter, brush, canvas, adapter }
    return REGION_SEAMS.map((seam) => {
      const port = ports[seam.seam]
      return check(seam, port !== undefined && typeof port.call === 'function', port?.protocolHandshake)
    })
  }
}

/** Contract invariants for the management view: listed and explained, never switchable. */
export function regionInvariantRows() {
  return regionInvariants.map(row => ({ ...row }))
}

/** Require the Adapter's declared callback-free write/restore path before a skill dispatch.
 * @param method - Write method chosen by the skill or recorded on the current build.
 * @param handshake - The current Adapter service's public ProtocolHandshake.
 * @returns The admitted protocol and component identity; package hashes are only recorded.
 */
export function requireAdapterWritePath(method: 'PER_CELL' | 'REGION', handshake: unknown) {
  const wire = method === 'PER_CELL' ? 'world-adapter/v8' : 'world-adapter-region/v3'
  const required = method === 'PER_CELL'
    ? ['world-adapter/v8:callback-free-write', 'world-adapter/v8:write-path-state-facts']
    : capabilities(wire)
  return checkProtocolCompatibility(handshake ?? null, [protocolRequirement(wire, required)])
}
