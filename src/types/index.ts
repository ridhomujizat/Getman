export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  valueType?: 'text' | 'file';
  files?: UploadFile[];
}

export interface UploadFile {
  name: string;
  mimeType: string;
  sizeBytes: number;
  data: number[];
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type BodyType = 'none' | 'json' | 'text' | 'form-data' | 'x-www-form-urlencoded';

export interface Body {
  type: BodyType;
  raw?: string;
  formData?: KeyValue[];
}

export interface Auth {
  type: 'none' | 'bearer' | 'basic' | 'api-key';
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: 'header' | 'query';
}

export interface TesApiRequest {
  id: string;
  name?: string;
  method: Method;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
  auth: Auth;
}

export interface WorkspaceStorage {
  type: 'local' | 'cloud';
  rootPath?: string;
  git?: { enabled: boolean };
}

export interface WorkspaceDescriptor {
  id: string;
  name: string;
  storage: WorkspaceStorage;
}

export interface WorkspaceMeta {
  schemaVersion: number;
  activeWorkspaceId: string;
  workspaces: WorkspaceDescriptor[];
}

export interface WorkspaceFile {
  schemaVersion: number;
  name: string;
  storage: WorkspaceStorage;
}

export interface CollectionSummary {
  id: string;
  name: string;
  requestCount: number;
  folderCount: number;
}

export type TreeNode =
  | { id: string; type: 'folder'; name: string; children: TreeNode[] }
  | { id: string; type: 'request'; name: string; request: TesApiRequest };

export interface Collection {
  id: string;
  name: string;
  schemaVersion: number;
  root: TreeNode[];
}

export interface HistoryEntry {
  id: string;
  ts: string;
  method: Method;
  url: string;
  status: number;
  durationMs: number;
  sizeBytes: number;
  request: TesApiRequest;
}

export interface HistoryQuery {
  search?: string;
  method?: Method | 'ALL';
  statusClass?: 'ALL' | '2xx' | '3xx' | '4xx' | '5xx' | 'error';
  limit?: number;
}

export interface RequestOrigin {
  collectionId: string;
  nodeId: string;
}

export interface RequestTab {
  id: string;
  draft: TesApiRequest;
  origin: RequestOrigin | null;
  savedSnapshot: string | null;
}

export interface SessionState {
  schemaVersion: number;
  activeTabId: string;
  tabs: RequestTab[];
  expandedIds: string[];
}

export interface EnvironmentSet {
  id: string;
  name: string;
  variables: KeyValue[];
}

export interface EnvironmentsFile {
  schemaVersion: number;
  activeEnvironmentId: string | null;
  environments: EnvironmentSet[];
}

export interface TesApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
  sizeBytes: number;
}

export interface HttpError {
  kind: 'Timeout' | 'DnsFailure' | 'ConnectionRefused' | 'InvalidUrl' | 'TlsError' | 'Unknown';
  message: string;
}
