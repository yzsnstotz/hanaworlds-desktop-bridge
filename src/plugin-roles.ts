/** C-world-inspection ReadPluginRoles provider: role → plugins, read from what the running host registered. */
import { FiberState, type Context } from '@deepseek-ai/cordis'
import { derivePluginRoles, pluginRoles, pluginRolesResponse, pluginRolesUnavailable, validateRequest,
  type ReadPluginRolesResponse, type RegisteredPluginService, type RegisteredPluginSkill } from 'hanaworlds-contracts'

/** The loader sets `fiber.entry` on every fiber it mounts; `options.name` is the module specifier. */
interface EntryFiber { state: FiberState; entry?: { options: { name: string } }; parent: { fiber: EntryFiber } }
interface ServiceImpl { name: string; fiber: EntryFiber }
/** A read that cannot be completed; the message names which fact was missing. */
export class PluginRolesReadError extends Error { override name = 'PluginRolesReadError' }

const evidenceNames = (kind: 'service' | 'skill') =>
  new Set(Object.values(pluginRoles.evidence).flat().filter(e => e.kind === kind).map(e => e.name))

/** Nearest loader module specifier from the providing fiber upward; never a plugin's own `name` export. */
function moduleOf(fiber: EntryFiber, service: string): string {
  for (let current = fiber; ; current = current.parent.fiber) {
    if (current.entry) return current.entry.options.name
    if (current.parent.fiber === current) throw new PluginRolesReadError(`service ${service} has no loader entry`)
  }
}

export class DesktopPluginRoles {
  private readonly services = evidenceNames('service')
  private readonly skills = evidenceNames('skill')
  constructor(private readonly ctx: Context) {}

  /** Active registered services named by the published evidence table, with their providing module. */
  registeredServices(): RegisteredPluginService[] {
    const store = (this.ctx.root as unknown as { reflect?: { store?: Record<symbol, ServiceImpl> } }).reflect?.store
    if (!store || typeof store !== 'object') throw new PluginRolesReadError('Cordis service store unreadable')
    return Object.getOwnPropertySymbols(store).map(key => store[key]!)
      .filter(impl => this.services.has(impl.name) && impl.fiber.state === FiberState.ACTIVE)
      .map(impl => ({ name: impl.name, moduleName: moduleOf(impl.fiber, impl.name) }))
  }

  /** Live skill catalog entries named by the evidence table; an incomplete catalog is not an answer. */
  async registeredSkills(): Promise<RegisteredPluginSkill[]> {
    const registry = this.ctx.get('skills')
    if (!registry) throw new PluginRolesReadError('skills registry unavailable')
    const snapshot = await registry.snapshot()
    if (!snapshot.complete) throw new PluginRolesReadError('skills catalog incomplete')
    return snapshot.skills.filter(skill => this.skills.has(skill.name)).map(skill => ({ name: skill.name, provider: skill.provider }))
  }

  async ReadPluginRoles(raw: unknown): Promise<ReadPluginRolesResponse> {
    const request = validateRequest('world-inspection/v1', 'ReadPluginRoles', raw)
    let host: { services: RegisteredPluginService[]; skills: RegisteredPluginSkill[] }
    try {
      host = { services: this.registeredServices(), skills: await this.registeredSkills() }
    } catch (error) {
      this.ctx.logger('hanaworlds-plugin-roles').error(`ReadPluginRoles unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return pluginRolesUnavailable(request)
    }
    return pluginRolesResponse(request, derivePluginRoles(host))
  }
}
