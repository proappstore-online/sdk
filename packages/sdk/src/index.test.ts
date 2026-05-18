import { describe, it, expect } from 'vitest';
import { initPro, ProAppStore } from './index.js';

describe('initPro', () => {
  it('returns a ProAppStore with all FAS + Pro modules', () => {
    const app = initPro({ appId: 'demo' });
    expect(app).toBeInstanceOf(ProAppStore);
    // FAS modules
    expect(app.auth).toBeDefined();
    expect(app.kv).toBeDefined();
    expect(app.counters).toBeDefined();
    expect(app.rooms).toBeDefined();
    expect(app.proxy).toBeDefined();
    // Pro modules
    expect(app.subscription).toBeDefined();
    expect(app.license).toBeDefined();
    expect(app.notifications).toBeDefined();
  });

  it('uses default API bases when not specified', () => {
    const app = initPro({ appId: 'demo' });
    expect(app).toBeDefined();
  });

  it('accepts custom API bases', () => {
    const app = initPro({
      appId: 'demo',
      fasApiBase: 'http://localhost:8787',
      proApiBase: 'http://localhost:8788',
    });
    expect(app).toBeDefined();
  });
});
