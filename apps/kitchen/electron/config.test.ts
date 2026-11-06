import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CAPTURE_SCRIPT, forServer, kdsUrl, mayOpen, normalizeServerUrl, parseCaptured, parseConfig, seedScript, type KitchenConfig } from './config.js';

describe('kitchen config', () => {
  it('reads the server address however it is typed', () => {
    expect(normalizeServerUrl('192.168.1.4')).toBe('http://192.168.1.4:7420');
    expect(normalizeServerUrl(' 192.168.1.4:7420 ')).toBe('http://192.168.1.4:7420');
    expect(normalizeServerUrl('http://192.168.1.4:7420/kds?station=x')).toBe('http://192.168.1.4:7420');
    expect(normalizeServerUrl('pos-master:8000')).toBe('http://pos-master:8000');
    expect(normalizeServerUrl('https://pos.example.in')).toBe('https://pos.example.in');
    expect(normalizeServerUrl('http://pos.example.in:80')).toBe('http://pos.example.in');
  });

  it('refuses what is not a server address', () => {
    for (const bad of ['', 'file:///C:/Windows', 'javascript:alert(1)', 'http://user:pw@192.168.1.4', 'http://']) expect(normalizeServerUrl(bad)).toBeNull();
  });

  it('opens only the server’s own pages', () => {
    const s = 'http://192.168.1.4:7420';
    expect(kdsUrl(s)).toBe('http://192.168.1.4:7420/kds');
    expect(mayOpen('http://192.168.1.4:7420/kds?station=1', s)).toBe(true);
    expect(mayOpen('http://192.168.1.4:7421/kds', s)).toBe(false);
    expect(mayOpen('https://example.com/', s)).toBe(false);
    expect(mayOpen('file:///C:/', s)).toBe(false);
    expect(mayOpen('http://192.168.1.4:7420/kds', null)).toBe(false);
  });

  it('reads a saved config, falling back to defaults', () => {
    const none = { serverId: null, deviceToken: null, station: null };
    expect(parseConfig(null)).toEqual({ serverUrl: null, autoStart: true, ...none });
    expect(parseConfig('not json')).toEqual({ serverUrl: null, autoStart: true, ...none });
    expect(parseConfig('{"serverUrl":"192.168.1.4","autoStart":false}')).toEqual({ serverUrl: 'http://192.168.1.4:7420', autoStart: false, ...none });
    expect(parseConfig('{"serverUrl":"192.168.1.4","serverId":"01JCSERVER","deviceToken":"dvt_abc","station":"01JCSTATION"}')).toEqual({
      serverUrl: 'http://192.168.1.4:7420',
      autoStart: true,
      serverId: '01JCSERVER',
      deviceToken: 'dvt_abc',
      station: '01JCSTATION',
    });
    expect(parseConfig('{"deviceToken":"has space","station":42}')).toMatchObject(none);
  });
});

describe('kitchen: keeping the pairing when the server moves (P2-15)', () => {
  const paired: KitchenConfig = { serverUrl: 'http://192.168.1.4:7420', autoStart: true, serverId: '01JCOURS', deviceToken: 'dvt_abc', station: '01JCSTATION' };

  it('keeps the pairing for the same server at a new address', () => {
    expect(forServer(paired, 'http://192.168.1.7:7420', '01JCOURS')).toEqual({ ...paired, serverUrl: 'http://192.168.1.7:7420' });
  });

  it('starts again with a different outlet', () => {
    expect(forServer(paired, 'http://192.168.1.9:7420', '01JCOTHER')).toEqual({ ...paired, serverUrl: 'http://192.168.1.9:7420', serverId: '01JCOTHER', deviceToken: null, station: null });
  });

  it('learns the server id of a server set up before P2-15', () => {
    const old: KitchenConfig = { ...paired, serverId: null };
    expect(forServer(old, old.serverUrl!, '01JCOURS')).toEqual({ ...old, serverId: '01JCOURS' });
  });

  it('reads what the display keeps and puts it back on the new address', () => {
    expect(CAPTURE_SCRIPT).toContain('dinepos.kds.device');
    expect(parseCaptured('["dvt_abc","01JCSTATION"]')).toEqual({ deviceToken: 'dvt_abc', station: '01JCSTATION' });
    expect(parseCaptured('[null,null]')).toEqual({ deviceToken: null, station: null });
    expect(parseCaptured('nope')).toBeNull();
    expect(parseCaptured(42)).toBeNull();
    const stored = new Map<string, string>();
    stored.set('dinepos.kds.station', 'NEWER');
    const localStorage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
    expect(runInNewContext(seedScript({ deviceToken: 'dvt_"abc', station: 'OLDER' }), { localStorage })).toBe(true);
    expect(Object.fromEntries(stored)).toEqual({ 'dinepos.kds.station': 'NEWER', 'dinepos.kds.device': 'dvt_"abc' });
  });
});
