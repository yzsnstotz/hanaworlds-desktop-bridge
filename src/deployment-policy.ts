/** Deployment facts are the world source's and Canvas's own; the bridge relays them unchanged. */
import { configEngineFacts, safetyProfileFromConfirmedIntent, validateType, type SafetyProfile } from 'hanaworlds-contracts'

/** Canvas `hanaworldsCompilerConfig`: assembled from the world source's declared writeBackend (contracts 2.0.0). */
export interface CompilerConfigPort { read(worldRef: string): Promise<unknown> }
interface Services { compiler(): CompilerConfigPort | undefined }

/**
 * contracts 2.0.0 moved every deployment value out of the Host: the world source declares the write backend,
 * Canvas assembles CompilationConfig from it, and SafetyProfile comes only from the player-confirmed intent.
 * This class holds no table, default or engine literal; a missing supplier is reported by name.
 */
export class DesktopDeploymentPolicy {
  constructor(private readonly services: Services) {}
  /** The SafetyProfile of a confirmed intent projection; there is no world- or Host-level SafetyProfile. */
  safety(intent: unknown): SafetyProfile {
    return safetyProfileFromConfirmedIntent(validateType('IntentProjection', intent))
  }
  /** Canvas's own compiler configuration for this world, returned exactly as Canvas produced it. */
  async compiler(worldRef: string): Promise<unknown> {
    const port = this.services.compiler()
    if (!port) throw new Error('COMPILER_CONFIG_UNAVAILABLE: needs hanaworldsCompilerConfig from hanaworlds-canvas (contracts 2.0.0 config supply)')
    return port.read(worldRef)
  }
  /** Management projection: the relayed facts plus the rules nobody can switch, each with its reason. */
  async describe(worldRef: string | null) {
    const read = async () => {
      if (worldRef === null) return { value: null, error: 'WORLD_NOT_BOUND: this page has no bound session world yet' }
      try { return { value: await this.compiler(worldRef), error: null } }
      catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) } }
    }
    return {
      kind: 'DEPLOYMENT_FACTS', worldRef, compilerConfig: await read(),
      source: { compilerConfig: 'hanaworlds-canvas hanaworldsCompilerConfig (world-source writeBackend)',
        safetyProfile: 'safetyProfileFromConfirmedIntent(ConfirmedIntent) — skill proposes, player confirms' },
      fixed: [
        { rule: 'avatarEnvelope', value: configEngineFacts.avatarDimensions.record, switchable: false,
          why: configEngineFacts.avatarDimensions.rule },
        { rule: 'requireBodyClearance', value: true, switchable: false, why: configEngineFacts.notDecidedHere },
      ],
    }
  }
}
