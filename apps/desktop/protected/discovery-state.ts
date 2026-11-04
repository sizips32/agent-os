import { validFollowup, type Followup } from './discovery-ai'
export type DiscoveryDomain = 'work' | 'thought'
export type DiscoveryTopic = 'daily' | 'faith' | 'invest'
export type DiscoveryReview = { situation: string; problem: string; outcome: string; action: string; basis: string; interpretation: string }
export type DiscoverySnapshot = {
  id: string; domain: DiscoveryDomain; topic: DiscoveryTopic; step: number
  screen: 'questions' | 'review' | 'ready' | 'none'; answers: string[]
  review: DiscoveryReview; confirmed: boolean; applied: boolean; ai?: Followup; includeAi?: boolean
}
export type SavedDiscovery = { snapshot: DiscoverySnapshot; savedAt: string }
export type DiscoveryStoreView = {
  revision: number; records: Partial<Record<DiscoveryDomain, SavedDiscovery>>
  trash: Partial<Record<DiscoveryDomain, SavedDiscovery>>; applied: string[]
  requests?: Record<string, { requestId: string; workId?: string }>
}
export type DiscoveryCommand = { action: 'load' } | { action: 'save'; revision: number; snapshot: DiscoverySnapshot }
  | { action: 'delete' | 'undo'; revision: number; domain: DiscoveryDomain; id: string }
  | { action: 'claim'; revision: number; id: string }
  | { action: 'ai-reserve'; revision: number; id: string; requestId: string }
  | { action: 'ai-bind'; revision: number; id: string; requestId: string; workId: string }
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v,k))
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const discoveryId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)
export const discoveryDomain = (v: unknown): v is DiscoveryDomain => v === 'work' || v === 'thought'
const text = (v: unknown) => typeof v === 'string' && v.length <= 2000 && !v.includes('\0')
export function validDiscovery(v: unknown): v is DiscoverySnapshot {
  if (!object(v) || !(keys(v,['id','domain','topic','step','screen','answers','review','confirmed','applied']) || (keys(v,['id','domain','topic','step','screen','answers','review','confirmed','applied','ai','includeAi']) && validFollowup(v.ai) && typeof v.includeAi==='boolean'))) return false
  if (!discoveryId(v.id) || !discoveryDomain(v.domain) || !['daily','faith','invest'].includes(v.topic as string) || (v.domain==='work' && v.topic!=='daily')) return false
  if (!Number.isInteger(v.step) || (v.step as number)<0 || (v.step as number)>3 || !['questions','review','ready','none'].includes(v.screen as string)) return false
  if (!Array.isArray(v.answers) || v.answers.length!==4 || !v.answers.every(text) || !object(v.review) || !keys(v.review,['situation','problem','outcome','action','basis','interpretation']) || !Object.values(v.review).every(text)) return false
  return typeof v.confirmed==='boolean' && typeof v.applied==='boolean' && (v.screen!=='ready' || (v.confirmed && Object.values(v.review).some(t=>typeof t==='string' && t.trim() && t.trim()!=='기억나지 않음')))
}
export function validDiscoveryView(v: unknown): v is DiscoveryStoreView {
  if (!object(v) || !(keys(v,['revision','records','trash','applied']) || keys(v,['revision','records','trash','applied','requests'])) || !Number.isSafeInteger(v.revision) || (v.revision as number)<0 || !object(v.records) || !object(v.trash)) return false
  for (const group of [v.records,v.trash]) for (const [domain,entry] of Object.entries(group)) {
    if (!discoveryDomain(domain) || !object(entry) || !keys(entry,['snapshot','savedAt']) || !validDiscovery(entry.snapshot) || entry.snapshot.domain!==domain || typeof entry.savedAt!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.savedAt) || !Number.isFinite(Date.parse(entry.savedAt))) return false
  }
  if(v.requests!==undefined && (!object(v.requests)||Object.keys(v.requests).length>1000||!Object.entries(v.requests).every(([id,r])=>discoveryId(id)&&object(r)&&(keys(r,['requestId'])||keys(r,['requestId','workId']))&&discoveryId(r.requestId)&&(r.workId===undefined || (typeof r.workId==='string'&&/^work_[a-f0-9]{32}$/.test(r.workId))))))return false
  return Array.isArray(v.applied) && v.applied.length<=1000 && v.applied.every(discoveryId) && new Set(v.applied).size===v.applied.length
}
export function validDiscoveryCommand(v: unknown): v is DiscoveryCommand {
  if (!object(v)) return false
  if (v.action==='load') return keys(v,['action'])
  if (!Number.isSafeInteger(v.revision) || (v.revision as number)<0) return false
  if (v.action==='save') return keys(v,['action','revision','snapshot']) && validDiscovery(v.snapshot)
  if(v.action==='ai-reserve')return keys(v,['action','revision','id','requestId']) && discoveryId(v.id)&&discoveryId(v.requestId)
  if(v.action==='ai-bind')return keys(v,['action','revision','id','requestId','workId'])&&discoveryId(v.id)&&discoveryId(v.requestId)&&typeof v.workId==='string'&&/^work_[a-f0-9]{32}$/.test(v.workId)
  if (v.action==='claim') return keys(v,['action','revision','id']) && discoveryId(v.id)
  return (v.action==='delete'||v.action==='undo') && keys(v,['action','revision','domain','id']) && discoveryDomain(v.domain) && discoveryId(v.id)
}
