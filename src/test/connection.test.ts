/**
 * Server-provided real-time endpoints: parsing, validation, order, memory,
 * and the throttle for lifecycle reconnect triggers.
 */
import {
  EndpointMemory,
  ENDPOINTS_STORAGE_KEY,
  MAX_MQTT_ENDPOINTS,
  MqttEndpoint,
  ReconnectThrottle,
  WINNER_STORAGE_KEY,
  networkKey,
  orderEndpoints,
  parseMqttEndpoints,
} from '../connection';

const ep = (host: string, port = 443, secure = true, path = '/mqtt'): MqttEndpoint => ({ host, port, secure, path });

describe('parseMqttEndpoints', () => {
  it('parses host, port, tls and path', () => {
    expect(
      parseMqttEndpoints([
        { host: 'a.example', port: 443, tls: true, path: '/mqtt' },
        { host: 'b.example', port: 8083, tls: false, path: 'ws' },
      ]),
    ).toEqual([ep('a.example'), ep('b.example', 8083, false, '/ws')]);
  });

  it('defaults tls to true and path to the default path', () => {
    expect(parseMqttEndpoints([{ host: 'a.example', port: 443 }])).toEqual([ep('a.example')]);
    expect(parseMqttEndpoints([{ host: 'a.example', port: 443, path: '' }])).toEqual([ep('a.example')]);
    expect(parseMqttEndpoints([{ host: 'a.example', port: 443, tls: null }], '/custom')).toEqual([
      ep('a.example', 443, true, '/custom'),
    ]);
  });

  it('ignores unknown fields', () => {
    expect(parseMqttEndpoints([{ host: 'a.example', port: 443, weight: 5, region: 'eu' }])).toEqual([ep('a.example')]);
  });

  it('skips invalid entries', () => {
    expect(
      parseMqttEndpoints([
        { host: '', port: 443 },
        { host: '   ', port: 443 },
        { host: 'a.example/x', port: 443 },
        { host: 'user@a.example', port: 443 },
        { host: 5, port: 443 },
        { port: 443 },
        { host: 'a.example', port: 0 },
        { host: 'a.example', port: 65536 },
        { host: 'a.example', port: 44.5 },
        { host: 'a.example', port: '443' },
        { host: 'a.example' },
        { host: 'a.example', port: 443, tls: 'yes' },
        { host: 'a.example', port: 443, path: 7 },
        { host: 'a.example', port: 443, path: '/a b' },
        null,
        'a.example:443',
        [],
        { host: 'ok.example', port: 65535 },
      ]),
    ).toEqual([ep('ok.example', 65535)]);
  });

  it('keeps at most 5 and drops duplicates', () => {
    const list = Array.from({ length: 8 }, (_, i) => ({ host: `h${i}.example`, port: 443 }));
    expect(parseMqttEndpoints(list)).toHaveLength(MAX_MQTT_ENDPOINTS);
    expect(parseMqttEndpoints([{ host: 'a.example', port: 443 }, { host: 'A.example', port: 443, tls: true }])).toHaveLength(1);
  });

  it('returns [] for anything that is not an array', () => {
    expect(parseMqttEndpoints(undefined)).toEqual([]);
    expect(parseMqttEndpoints(null)).toEqual([]);
    expect(parseMqttEndpoints({ host: 'a', port: 1 })).toEqual([]);
    expect(parseMqttEndpoints('[]')).toEqual([]);
  });
});

describe('orderEndpoints', () => {
  const def = ep('default.example');
  const a = ep('a.example');
  const b = ep('b.example', 8084);

  it('uses only the default without a server list (behaviour of today)', () => {
    expect(orderEndpoints([], def, null)).toEqual([def]);
    expect(orderEndpoints([], def, a)).toEqual([def]);
  });

  it('lists the server endpoints in order, the default always last', () => {
    expect(orderEndpoints([a, b], def, null)).toEqual([a, b, def]);
  });

  it('puts the endpoint that last worked first', () => {
    expect(orderEndpoints([a, b], def, b)).toEqual([b, a, def]);
  });

  it('ignores a remembered endpoint the server no longer lists', () => {
    expect(orderEndpoints([a], def, b)).toEqual([a, def]);
  });

  it('keeps the default last even when it is listed or remembered', () => {
    expect(orderEndpoints([def, a], def, def)).toEqual([a, def]);
    expect(orderEndpoints([a, b], def, def)).toEqual([a, b, def]);
  });
});

describe('networkKey', () => {
  it('uses the connection type when there is one', () => {
    expect(networkKey({ connection: { type: 'wifi' } })).toBe('wifi');
    expect(networkKey({ connection: { type: 'cellular' } })).toBe('cellular');
  });

  it('falls back to a single key', () => {
    expect(networkKey({})).toBe('');
    expect(networkKey({ connection: { effectiveType: '4g' } })).toBe('');
    expect(networkKey(undefined)).toBe('');
  });
});

describe('EndpointMemory', () => {
  const store = () => {
    const data: Record<string, string> = {};
    return {
      data,
      storage: {
        getItem: (k: string) => (k in data ? data[k] : null),
        setItem: (k: string, v: string) => {
          data[k] = v;
        },
        removeItem: (k: string) => {
          delete data[k];
        },
      },
    };
  };

  it('saves and restores the server list; an empty list clears it', () => {
    const s = store();
    const m = new EndpointMemory(() => s.storage);
    m.saveServerEndpoints([ep('a.example'), ep('b.example', 8083, false, '/ws')]);
    expect(new EndpointMemory(() => s.storage).serverEndpoints()).toEqual([ep('a.example'), ep('b.example', 8083, false, '/ws')]);
    m.saveServerEndpoints([]);
    expect(s.data[ENDPOINTS_STORAGE_KEY]).toBeUndefined();
    expect(m.serverEndpoints()).toEqual([]);
  });

  it('remembers the winner per connection type, or under one key', () => {
    const s = store();
    const m = new EndpointMemory(() => s.storage);
    m.saveWinner('wifi', ep('a.example'));
    m.saveWinner('cellular', ep('b.example'));
    m.saveWinner('', ep('c.example'));
    expect(m.winner('wifi')).toEqual(ep('a.example'));
    expect(m.winner('cellular')).toEqual(ep('b.example'));
    expect(m.winner('')).toEqual(ep('c.example'));
    expect(Object.keys(s.data).sort()).toEqual(
      [WINNER_STORAGE_KEY, `${WINNER_STORAGE_KEY}_cellular`, `${WINNER_STORAGE_KEY}_wifi`].sort(),
    );
    expect(m.winner('ethernet')).toBeNull();
  });

  it('survives corrupt or blocked storage', () => {
    const s = store();
    s.data[ENDPOINTS_STORAGE_KEY] = '{not json';
    s.data[WINNER_STORAGE_KEY] = '"x"';
    const m = new EndpointMemory(() => s.storage);
    expect(m.serverEndpoints()).toEqual([]);
    expect(m.winner('')).toBeNull();

    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const blocked = new EndpointMemory(() => throwing);
    expect(() => blocked.saveServerEndpoints([ep('a.example')])).not.toThrow();
    expect(() => blocked.saveWinner('', ep('a.example'))).not.toThrow();
    expect(blocked.serverEndpoints()).toEqual([]);
    expect(blocked.winner('')).toBeNull();
    expect(new EndpointMemory(() => null).serverEndpoints()).toEqual([]);
  });
});

describe('ReconnectThrottle', () => {
  it('lets the first trigger through and ignores the rest for 1 s', () => {
    let now = 10_000;
    const t = new ReconnectThrottle(1000, () => now);
    expect(t.tryAcquire()).toBe(true);
    now += 10;
    expect(t.tryAcquire()).toBe(false);
    now += 900;
    expect(t.tryAcquire()).toBe(false);
    now += 100;
    expect(t.tryAcquire()).toBe(true);
    t.reset();
    expect(t.tryAcquire()).toBe(true);
  });
});
