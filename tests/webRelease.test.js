import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker({ response, cached, navigation, keys = [] } = {}) {
  const handlers = {};
  const deleted = [];
  const requested = [];
  const self = { location: { origin: 'https://nova.test' }, addEventListener: (type, fn) => handlers[type] = fn, clients: { claim: async () => {} } };
  const cache = { match: async key => { requested.push(key); return key === '/index.html' ? navigation : cached; }, addAll: async () => {} };
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8').replace('__ASSETS__', '[]'), {
    self, URL, Response, fetch: async () => { if (!response) throw Error('offline'); return response; },
    caches: { open: async () => cache, keys: async () => keys, delete: async key => deleted.push(key) },
  });
  return { handlers, deleted, requested };
}

describe('web release service worker', () => {
  it('never substitutes HTML for a missing offline script', async () => {
    const { handlers, requested } = worker({ navigation: new Response('<html>') });
    let result;
    handlers.fetch({ request: { method: 'GET', url: 'https://nova.test/missing.js', mode: 'cors' }, respondWith: p => result = p });
    expect((await result).type).toBe('error');
    expect(requested).not.toContain('/index.html');
  });
  it('uses the cached app shell only for offline navigation', async () => {
    const { handlers } = worker({ navigation: new Response('shell') });
    let result;
    handlers.fetch({ request: { method: 'GET', url: 'https://nova.test/', mode: 'navigate' }, respondWith: p => result = p });
    expect(await (await result).text()).toBe('shell');
  });
  it('leaves unrelated origin caches intact', async () => {
    const { handlers, deleted } = worker({ keys: ['other-app', 'nova-v17', 'nova-release-__RELEASE__'] });
    let done;
    handlers.activate({ waitUntil: p => done = p });
    await done;
    expect(deleted).toEqual(['nova-v17']);
  });
});


describe('browser writer ownership', () => {
  const source = readFileSync('src/main.jsx', 'utf8');
  const boot = source.slice(source.indexOf('async function boot()'), source.indexOf('function mount()'));
  it('does not mount without a lock and mounts only after ownership is granted', async () => {
    let acquire;
    let mounted = 0;
    const root = {};
    const context = { window: {}, document: { getElementById: () => root }, navigator: { locks: { request: (_name, fn) => { acquire = fn; return new Promise(() => {}); } } }, mount: () => mounted++ };
    vm.runInNewContext(boot + '\nboot();', context);
    expect(mounted).toBe(0);
    expect(root.textContent).toMatch(/another tab/);
    acquire();
    expect(mounted).toBe(1);
  });
  it('fails closed when locks are unavailable', () => {
    let mounted = false;
    const root = {};
    vm.runInNewContext(boot + '\nboot();', { window: {}, navigator: {}, document: { getElementById: () => root }, mount: () => mounted = true });
    expect(mounted).toBe(false);
    expect(root.textContent).toMatch(/Web Locks/);
  });
});
