import { describe, expect, it } from 'vitest';
import { kdsUrl, mayOpen, normalizeServerUrl, parseConfig } from './config.js';

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
    expect(parseConfig(null)).toEqual({ serverUrl: null, autoStart: true });
    expect(parseConfig('not json')).toEqual({ serverUrl: null, autoStart: true });
    expect(parseConfig('{"serverUrl":"192.168.1.4","autoStart":false}')).toEqual({ serverUrl: 'http://192.168.1.4:7420', autoStart: false });
  });
});
