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

export interface GetmanRequest {
  id: string;
  name?: string;
  method: Method;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
  auth: Auth;
}

export interface GetmanResponse {
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
