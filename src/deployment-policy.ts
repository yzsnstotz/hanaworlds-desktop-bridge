/** Verified installed deployment configuration; no values are inferred from model input. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { validateType, type Catalogue, type SafetyProfile } from 'hanaworlds-contracts'

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const deploymentSchema = z.object({
  schemaVersion: z.literal(1), expectedEngineProfile: z.string(), safetyProfile: z.unknown(),
  safetySource: z.string(), compilerPackage: z.string(), backendPackage: z.string(),
  packages: z.array(z.object({ name: z.string(), version: z.string(), sourceRevision: z.string(),
    tarSha256: z.string(), files: z.record(z.string(), z.string()) })),
}).strict()
/** Read fixed package bytes once at Host startup; changed installations cannot supply compiler settings. */
export class DesktopDeploymentPolicy {
  private constructor(private readonly deployment: z.infer<typeof deploymentSchema>,
    private readonly safetyProfile: SafetyProfile, private readonly catalogue: (worldRef: string) => Promise<unknown>) {}
  /** Verify the fresh profile's deployment file and every declared installed package file. */
  static async open(profileDirectory: string, catalogue: (worldRef: string) => Promise<unknown>): Promise<DesktopDeploymentPolicy> {
    const deployment = deploymentSchema.parse(JSON.parse(await readFile(join(profileDirectory, 'hanaworlds-deployment.json'), 'utf8')))
    for (const pkg of deployment.packages) {
      if (!/^hanaworlds-[a-z-]+$/.test(pkg.name) || !/^[a-f0-9]{64}$/.test(pkg.tarSha256)
        || !/^[a-f0-9]{40}$/.test(pkg.sourceRevision) || Object.keys(pkg.files).length === 0) throw new Error('DEPLOYMENT_INVALID')
      const root = join(profileDirectory, 'node_modules', pkg.name)
      for (const [file, expected] of Object.entries(pkg.files)) {
        if (file.startsWith('/') || file.split('/').some(part => !part || part === '..')
          || sha(await readFile(join(root, file))) !== expected) throw new Error('DEPLOYMENT_BYTES_CHANGED')
      }
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string }
      if (manifest.name !== pkg.name || manifest.version !== pkg.version) throw new Error('DEPLOYMENT_BYTES_CHANGED')
    }
    if (!deployment.packages.some(p => p.name === deployment.compilerPackage)
      || !deployment.packages.some(p => p.name === deployment.backendPackage)) throw new Error('DEPLOYMENT_INVALID')
    return new DesktopDeploymentPolicy(deployment, validateType('SafetyProfile', deployment.safetyProfile), catalogue)
  }
  private async current(worldRef: string): Promise<Catalogue> {
    const catalogue = validateType('Catalogue', await this.catalogue(worldRef))
    if (catalogue.engineProfile !== this.deployment.expectedEngineProfile) throw new Error('DEPLOYMENT_ENGINE_MISMATCH')
    return catalogue
  }
  /** Return the configured geometric envelope only after checking the actual current world. */
  async safety(worldRef: string): Promise<SafetyProfile> {
    await this.current(worldRef)
    return structuredClone(this.safetyProfile)
  }
  /** Bind pure compilation to installed Brush/backend and the loaded WorldEdit registry fingerprint. */
  async compiler(worldRef: string) {
    const catalogue = await this.current(worldRef), worldeditRevision = catalogue.modRevisions.worldedit
    if (!worldeditRevision) throw new Error('WORLDEDIT_IDENTITY_UNAVAILABLE')
    const compiler = this.deployment.packages.find(p => p.name === this.deployment.compilerPackage)
    const backend = this.deployment.packages.find(p => p.name === this.deployment.backendPackage)
    if (!compiler || !backend) throw new Error('DEPLOYMENT_INVALID')
    return { compilerRevision: `${compiler.name}@${compiler.version}:${compiler.sourceRevision}:${compiler.tarSha256}`,
      compilationConfig: validateType('CompilationConfig', { profileVersion: 'compilation-config/v2',
        backendProfileId: `${backend.name}@${backend.version}:${backend.tarSha256}`,
        worldeditRevision, nodeWriteSemantics: 'explicit-nodeName-param2-static-v2', overlapRule: 'last-writer-wins',
        effectOrder: 'numeric-x-y-z', compressionRule: 'exact-final-effects-only' }) }
  }
  /** Public management projection labels configuration separately from live native measurements. */
  describe() {
    return { kind: 'DEPLOYMENT_CONFIGURATION', safetyProfile: structuredClone(this.safetyProfile),
      defaults: structuredClone(this.safetyProfile), source: this.deployment.safetySource,
      expectedEngineProfile: this.deployment.expectedEngineProfile,
      packages: this.deployment.packages.map(({ files: _files, ...identity }) => identity) }
  }
}
