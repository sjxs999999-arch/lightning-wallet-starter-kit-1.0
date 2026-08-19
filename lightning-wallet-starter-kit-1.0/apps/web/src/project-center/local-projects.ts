import type { LaunchDraft } from '../launchpad/types';
import type { ProjectDetails, ProjectStatus } from './types';
import type { ProjectDeployment } from './types';

const KEY = 'lightning-client-projects-v1';
const MAX_ITEMS = 100;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isLocalProject(value: unknown): value is ProjectDetails {
  if (!isRecord(value) || !isText(value.id) || !value.id.startsWith('local-') || !isText(value.name)) return false;
  if (!['EVM', 'SOL', 'TRON'].includes(String(value.chain)) || !['draft', 'review', 'approved', 'deployed', 'archived'].includes(String(value.status))) return false;
  if (!Number.isInteger(value.version) || !isText(value.created_at) || !isRecord(value.metadata)) return false;
  return Array.isArray(value.versions) && Array.isArray(value.deployments);
}

export function loadLocalProjects(storage: Pick<Storage, 'getItem'> = localStorage): ProjectDetails[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isLocalProject).slice(0, MAX_ITEMS) : [];
  } catch { return []; }
}

export function localProjectFromDraft(draft: LaunchDraft, planId: string): ProjectDetails {
  const createdAt = new Date().toISOString();
  const status: ProjectStatus = draft.dryRun ? 'draft' : 'review';
  const metadata = {
    symbol: draft.symbol,
    description: draft.description,
    ...(draft.website ? { website: draft.website } : {}),
    socials: Object.fromEntries(Object.entries(draft.socials).filter((entry): entry is [string, string] => Boolean(entry[1]))),
    tokenStandard: { EVM: 'ERC-20', SOL: 'SPL Token', TRON: 'TRC-20' }[draft.chain],
    decimals: draft.decimals,
    supply: draft.supply,
  };
  return { id: `local-${planId}`, name: draft.name, chain: draft.chain, status, version: 1, metadata, created_at: createdAt, versions: [{ version: 1, status, metadata, created_at: createdAt }], deployments: [] };
}

export function saveLocalProject(project: ProjectDetails, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): ProjectDetails[] {
  const projects = [project, ...loadLocalProjects(storage).filter(item => item.id !== project.id)].slice(0, MAX_ITEMS);
  storage.setItem(KEY, JSON.stringify(projects));
  return projects;
}

export function recordLocalDeployment(projectId: string, deployment: ProjectDeployment, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): ProjectDetails | null {
  const projects = loadLocalProjects(storage);
  const target = projects.find(project => project.id === projectId);
  if (!target) return null;
  const updated: ProjectDetails = { ...target, status: 'deployed', deployments: [deployment, ...target.deployments.filter(item => item.id !== deployment.id)] };
  storage.setItem(KEY, JSON.stringify(projects.map(project => project.id === projectId ? updated : project).slice(0, MAX_ITEMS)));
  return updated;
}

export function filterLocalProjects(projects: ProjectDetails[], search: string, chain: string, status: string): ProjectDetails[] {
  const query = search.trim().toLowerCase();
  return projects.filter(project => (!query || project.name.toLowerCase().includes(query) || (project.metadata.symbol ?? '').toLowerCase().includes(query))
    && (!chain || project.chain === chain) && (!status || project.status === status));
}
