// Run: node src/lib/variables.test.ts (Node >=22)
import assert from 'node:assert';
import type { EnvironmentsFile, TesApiRequest } from '../types/index.ts';
import { requestVariableNames, requestVariables, resolveVarStatus, splitVarSpans } from './variables.ts';

const environment = (activeEnvironmentId: string | null, enabled = true, value = 'https://example.com'): EnvironmentsFile => ({
  schemaVersion: 1,
  activeEnvironmentId,
  environments: [{
    id: 'env',
    name: 'Local',
    variables: [{ id: 'row', key: 'base_url', value, enabled }],
  }],
});

assert.deepEqual(splitVarSpans('plain text'), [{ text: 'plain text', start: 0, end: 10 }]);
assert.deepEqual(splitVarSpans('A {{ base_url }} B {{token}}').map((span) => 'varName' in span ? span.varName : span.text), ['A ', 'base_url', ' B ', 'token']);
assert.equal(resolveVarStatus('base_url', environment(null)).reason, 'no-environment');
assert.equal(resolveVarStatus('missing', environment('env')).reason, 'missing');
assert.equal(resolveVarStatus('base_url', environment('env', false)).reason, 'disabled');
assert.deepEqual(resolveVarStatus('base_url', environment('env', true, '')), { name: 'base_url', state: 'resolved', value: '', envName: 'Local' });

const request: TesApiRequest = {
  id: 'request',
  method: 'POST',
  url: '{{base_url}}/{{base_url}}',
  params: [{ id: 'param', key: '{{param_key}}', value: '{{param_value}}', enabled: true }],
  pathVariables: [{ id: 'path', key: 'id', value: '{{path_value}}', enabled: true }],
  headers: [{ id: 'header', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
  body: {
    type: 'form-data',
    raw: '{"raw":"{{raw_value}}"}',
    formData: [{ id: 'form', key: '{{form_key}}', value: '{{form_value}}', enabled: true }],
  },
  auth: { type: 'basic', username: '{{username}}', password: '{{password}}' },
};
assert.deepEqual(requestVariableNames(request), ['base_url', 'param_key', 'param_value', 'path_value', 'token', 'form_key', 'form_value', 'raw_value', 'username', 'password']);
assert.equal(requestVariables(request, environment('env')).filter((status) => status.state === 'resolved').length, 1);

const fiftyTokens = Array.from({ length: 50 }, (_, index) => `{{var_${index}}}`).join(' ');
const started = performance.now();
assert.equal(splitVarSpans(fiftyTokens).filter((span) => 'varName' in span).length, 50);
assert.ok(performance.now() - started < 50);

console.log('variables.test.ts: all assertions passed');
