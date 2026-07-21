import { Database, FolderTree, KeyRound } from 'lucide-react';
import type { CollectionOption, EnvironmentOption, McpCapability, McpPolicy } from '../../../lib/mcp/types';
import type { WorkspaceRecord } from '../../../types';

const capabilities: McpCapability[] = ['deny', 'read', 'draft', 'execute'];

interface Props {
  workspace: WorkspaceRecord;
  workspacePolicy?: McpPolicy;
  collections: CollectionOption[];
  environments: EnvironmentOption[];
  policies: McpPolicy[];
  onWorkspaceChange: (capability: McpCapability) => void;
  onCollectionChange: (collectionId: string, capability: McpCapability) => void;
  onEnvironmentChange: (environmentId: string, patch: Partial<McpPolicy>) => void;
}

export function ScopeAccess({ workspace, workspacePolicy, collections, environments, policies, onWorkspaceChange, onCollectionChange, onEnvironmentChange }: Props) {
  const workspaceCapability = workspacePolicy?.capability ?? 'deny';
  return (
    <div className="mcp-scope-panel">
      <section className="mcp-scope-section">
        <header><div className="mcp-scope-icon"><Database size={15} /></div><div><h3>{workspace.name}</h3><p>Workspace access is denied until you explicitly raise it.</p></div><CapabilitySelect value={workspaceCapability} onChange={onWorkspaceChange} /></header>
      </section>
      <section className="mcp-scope-section">
        <div className="mcp-scope-title"><FolderTree size={14} /><div><h3>Collections</h3><p>Collections inherit the workspace ceiling unless reduced here.</p></div></div>
        <div className="mcp-scope-table"><div className="mcp-scope-table-head"><span>Collection</span><span>Requests</span><span>Access</span></div>{collections.map((collection) => {
          const policy = policies.find((item) => item.workspaceId === workspace.id && item.collectionId === collection.id && item.environmentId == null && item.clientId == null);
          return <div className="mcp-scope-row" key={collection.id}><strong>{collection.name}</strong><span>{collection.requestCount}</span><CapabilitySelect value={policy?.capability ?? workspaceCapability} onChange={(capability) => onCollectionChange(collection.id, capability)} disabled={workspaceCapability === 'deny'} /></div>;
        })}{!collections.length ? <div className="mcp-scope-empty">No collections in this workspace.</div> : null}</div>
      </section>
      <section className="mcp-scope-section">
        <div className="mcp-scope-title"><KeyRound size={14} /><div><h3>Environments</h3><p>Values stay private. Clients see names, keys, and resolution state only.</p></div></div>
        <div className="mcp-environment-access">{environments.map((environment) => {
          const policy = policies.find((item) => item.workspaceId === workspace.id && item.environmentId === environment.id && item.collectionId == null && item.clientId == null);
          return <article key={environment.id}><div><strong>{environment.name}</strong><span>{environment.variableCount} variables · {environment.secretCount} secret</span></div><select value={policy?.environmentClass ?? suggestClass(environment.name)} onChange={(event) => onEnvironmentChange(environment.id, { environmentClass: event.target.value })}>{['development','test','staging','production','custom'].map((item) => <option key={item} value={item}>{item}</option>)}</select><label className="mcp-switch-label"><input type="checkbox" checked={policy?.environmentUse === true} onChange={(event) => onEnvironmentChange(environment.id, { environmentUse: event.target.checked })} /><span /> Allow use</label><select value={policy?.approvalMode ?? 'risky'} onChange={(event) => onEnvironmentChange(environment.id, { approvalMode: event.target.value as McpPolicy['approvalMode'] })}><option value="always">Always ask</option><option value="risky">Ask when risky</option><option value="policy">Allow when policy permits</option></select></article>;
        })}{!environments.length ? <div className="mcp-scope-empty">No environments in this workspace.</div> : null}</div>
      </section>
    </div>
  );
}

function CapabilitySelect({ value, onChange, disabled }: { value: McpCapability; onChange: (value: McpCapability) => void; disabled?: boolean }) {
  return <select className={`mcp-capability ${value}`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as McpCapability)}>{capabilities.map((item) => <option key={item} value={item}>{item}</option>)}</select>;
}

const suggestClass = (name: string) => /prod|production|live/i.test(name) ? 'production' : 'development';
