/** C-world-facts consumer: deployment declarations belong entirely to the world source. */
import { randomUUID } from 'node:crypto'
import { requireWriteProfileConfig, safetyProfileFromConfirmedIntent, validateType, type SafetyProfile, type WriteProfile, type CompilationConfig } from 'hanaworlds-contracts'
import { callLocal, type DomainPort } from './local-protocol.ts'
import { serviceIdentity } from './image-media.ts'

/** The bridge projects the complete source configuration; it never compiles one itself. */
export interface CompilerConfigPort { read(worldRef: string): Promise<{ compilationConfig: CompilationConfig; compilerRevision: string }> }
export type WriteProfilePort = Pick<DomainPort, 'contractHandshake' | 'protocolHandshake' | 'call'>
interface Services { facts(): Partial<WriteProfilePort> | undefined; supply?(): unknown }

/**
 * ReadWriteProfile supplies backend, compilation config, write methods and body envelope as one snapshot.
 * SafetyProfile comes only from the player-confirmed intent.
 * This class holds no table, default or engine literal; a missing supplier is reported by name.
 */
export class DesktopDeploymentPolicy {
  constructor(private readonly services: Services) {}
  /** The SafetyProfile of a confirmed intent projection; there is no world- or Host-level SafetyProfile. */
  safety(intent: unknown): SafetyProfile {
    return safetyProfileFromConfirmedIntent(validateType('IntentProjection', intent))
  }
  async writeProfile(worldRef: string): Promise<WriteProfile> {
    const port = this.services.facts()
    if (!port) throw new Error('ADAPTER_UNAVAILABLE: needs hanaworldsWorldFacts (C-world-facts ReadWriteProfile)')
    if (typeof port.call !== 'function') throw new Error('CAPABILITY_UNAVAILABLE: world source lacks C-world-facts ReadWriteProfile')
    const profile = await callLocal(port as DomainPort, 'world-facts/v1', 'ReadWriteProfile', {
      contractVersion: 'world-facts/v1', requestId: randomUUID(), worldRef,
    })
    if (serviceIdentity(this.services.facts()) !== serviceIdentity(port)) throw new Error('ADAPTER_UNAVAILABLE: world facts supplier replaced during ReadWriteProfile')
    return profile
  }
  /** Select the source's complete config using the SDK's named refusal for an undeclared backend. */
  async compiler(worldRef: string): Promise<CompilationConfig> {
    return requireWriteProfileConfig(await this.writeProfile(worldRef))
  }
  /** Management projection: the relayed facts plus the rules nobody can switch, each with its reason. */
  async describe(worldRef: string | null) {
    const read = async () => {
      if (worldRef === null) return { value: null, error: 'WORLD_NOT_BOUND: this page has no bound session world yet' }
      try { return { value: await this.writeProfile(worldRef), error: null } }
      catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) } }
    }
    const writeProfile = await read(), profile = writeProfile.value
    return {
      kind: 'DEPLOYMENT_FACTS', worldRef, writeProfile,
      ...(this.services.supply ? { sourceSupply: this.services.supply() } : {}),
      compilerConfig: { value: profile?.compilationConfig ?? null, error: writeProfile.error },
      writeMethods: { value: profile?.writeMethods ?? null, error: writeProfile.error },
      source: { writeProfile: 'hanaworldsWorldFacts C-world-facts ReadWriteProfile',
        compilerConfig: 'C-world-facts ReadWriteProfile.compilationConfig',
        safetyProfile: 'safetyProfileFromConfirmedIntent(ConfirmedIntent) — skill proposes, player confirms' },
      fixed: [
        { rule: 'avatarEnvelope', value: profile?.avatarEnvelope ?? null, error: writeProfile.error, switchable: false,
          why: 'Body envelope is declared by the world source in ReadWriteProfile; the bridge adds no dimensions.' },
        { rule: 'requireBodyClearance', value: true, switchable: false, why: 'SafetyProfile comes from the player-confirmed intent, not deployment settings.' },
      ],
    }
  }
}
