import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeviceAccess } from '../bridge/bridge-devices.mjs';
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-pair-')); dirs.push(dir);
  const file = path.join(dir, 'devices');
  let time = 1000;
  return { file, access: createDeviceAccess(file, () => time), expire: () => time += 300001 };
}
const token = 'a'.repeat(64);
it('requires explicit approval, persists hashes and revokes access across restarts', () => {
  const { access, file } = setup();
  const request = access.request({ token, name: 'Phone' }, '1', 'https://nova.test');
  expect(request.status).toBe('pending');
  expect(access.authorize(token)).toBeUndefined();
  expect(access.request({ token }, '1', '').id).toBe(request.id);
  expect(access.status(request.id, 'b'.repeat(64)).status).toBe('expired');
  expect(JSON.stringify(access.list())).not.toContain(token);
  access.decide(request.id, 'approve');
  expect(access.authorize(token)).toBe(request.id);
  expect(fs.readFileSync(file, 'utf8')).not.toContain(token);
  const reopened = createDeviceAccess(file);
  expect(reopened.authorize(token)).toBe(request.id);
  reopened.decide(request.id, 'revoke');
  expect(createDeviceAccess(file).authorize(token)).toBeUndefined();
});
it('rejects expired, denied and malformed requests and limits flooding', () => {
  const { access, expire } = setup();
  expect(() => access.request({ token: 'weak' }, '1', '')).toThrow();
  const request = access.request({ token }, '1', '');
  access.decide(request.id, 'reject');
  expect(access.status(request.id, token).status).toBe('rejected');
  expect(access.authorize(token)).toBeUndefined();
  expect(() => access.decide(request.id, 'approve')).toThrow();
  expire();
  expect(access.status(request.id, token).status).toBe('expired');
  for (let i = 0; i < 5; i++) access.request({ token: i.toString(16).padStart(64, '0') }, '2', '');
  expect(() => access.request({ token: 'f'.repeat(64) }, '2', '')).toThrow(/Too many/);
});
it('does not authorize or revoke if persistence fails', () => {
  const { access, file } = setup();
  const request = access.request({ token }, '1', '');
  fs.mkdirSync(file + '.tmp');
  expect(() => access.decide(request.id, 'approve')).toThrow();
  expect(access.authorize(token)).toBeUndefined();
});
