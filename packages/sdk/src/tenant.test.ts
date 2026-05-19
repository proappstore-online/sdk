import { describe, expect, it, vi } from 'vitest';
import { Database } from './db.js';
import { TenantScope } from './tenant.js';

interface AuthLike {
  token: string | null;
  handleUnauthorized: () => void;
}

function fakeAuth(): AuthLike {
  return { token: 'tok', handleUnauthorized: vi.fn() };
}

/** Build a Database where query()/execute() capture the SQL+params they were called with. */
function captureDb() {
  const calls: { kind: 'query' | 'execute'; sql: string; params: unknown[] }[] = [];
  const db = new Database('app', 'https://data.example', fakeAuth());

  // Intercept the network call.
  db.query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ kind: 'query', sql, params: params ?? [] });
    return { rows: [], meta: { changes: 0, duration: 0 } };
  });
  db.execute = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ kind: 'execute', sql, params: params ?? [] });
    return { meta: { changes: 1, duration: 0, last_row_id: 0 } };
  });
  return { db, calls };
}

describe('TenantScope', () => {
  describe('construction', () => {
    it('throws when tenantId is empty', () => {
      const { db } = captureDb();
      expect(() => new TenantScope(db, '')).toThrow(/non-empty/);
    });

    it('exposes db and tenantId for raw escape-hatch queries', () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-42');
      expect(tx.db).toBe(db);
      expect(tx.tenantId).toBe('studio-42');
    });
  });

  describe('find', () => {
    it('appends tenant_id to the WHERE and LIMIT 1', async () => {
      const { db, calls } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await tx.find('clients', { id: 'c-1' });
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toBe('SELECT * FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1');
      expect(calls[0].params).toEqual(['c-1', 'studio-1']);
    });

    it('handles empty filter — scopes by tenant_id only', async () => {
      const { db, calls } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await tx.find('clients');
      expect(calls[0].sql).toBe('SELECT * FROM clients WHERE tenant_id = ? LIMIT 1');
      expect(calls[0].params).toEqual(['studio-1']);
    });

    it('returns null when no rows', async () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      expect(await tx.find('clients', { id: 'missing' })).toBeNull();
    });

    it('returns the first row when present', async () => {
      const db = new Database('app', 'https://data.example', fakeAuth());
      db.query = vi.fn(async () => ({
        rows: [{ id: 'c-1', name: 'Alice' }],
        meta: { changes: 0, duration: 0 },
      }));
      const tx = new TenantScope(db, 'studio-1');
      const row = await tx.find<{ id: string; name: string }>('clients', { id: 'c-1' });
      expect(row).toEqual({ id: 'c-1', name: 'Alice' });
    });
  });

  describe('findMany', () => {
    it('appends tenant_id and returns all rows', async () => {
      const db = new Database('app', 'https://data.example', fakeAuth());
      db.query = vi.fn(async () => ({
        rows: [{ id: '1' }, { id: '2' }],
        meta: { changes: 0, duration: 0 },
      }));
      const tx = new TenantScope(db, 'studio-1');
      const rows = await tx.findMany('clients', { active: 1 });
      expect(rows).toHaveLength(2);
      expect((db.query as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
        'SELECT * FROM clients WHERE active = ? AND tenant_id = ?',
        [1, 'studio-1'],
      ]);
    });
  });

  describe('insert', () => {
    it('appends tenant_id to columns and binds it last', async () => {
      const { db, calls } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await tx.insert('clients', { id: 'c-1', name: 'Alice' });
      expect(calls[0].kind).toBe('execute');
      expect(calls[0].sql).toBe('INSERT INTO clients (id, name, tenant_id) VALUES (?, ?, ?)');
      expect(calls[0].params).toEqual(['c-1', 'Alice', 'studio-1']);
    });

    it('refuses to insert when caller passes tenant_id explicitly', async () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await expect(
        tx.insert('clients', { id: 'c-1', tenant_id: 'studio-OTHER' }),
      ).rejects.toThrow(/automatically/);
    });
  });

  describe('update', () => {
    it('builds SET clause + tenant-scoped WHERE in correct bind order', async () => {
      const { db, calls } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await tx.update('clients', { id: 'c-1' }, { name: 'Alicia', notes: 'VIP' });
      expect(calls[0].sql).toBe(
        'UPDATE clients SET name = ?, notes = ? WHERE id = ? AND tenant_id = ?',
      );
      expect(calls[0].params).toEqual(['Alicia', 'VIP', 'c-1', 'studio-1']);
    });

    it('refuses when values has tenant_id', async () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await expect(
        tx.update('clients', { id: 'c-1' }, { tenant_id: 'studio-OTHER' }),
      ).rejects.toThrow(/automatically/);
    });

    it('refuses when no columns to set', async () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await expect(tx.update('clients', { id: 'c-1' }, {})).rejects.toThrow(
        /at least one column/,
      );
    });
  });

  describe('delete', () => {
    it('builds tenant-scoped DELETE', async () => {
      const { db, calls } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await tx.delete('clients', { id: 'c-1' });
      expect(calls[0].sql).toBe('DELETE FROM clients WHERE id = ? AND tenant_id = ?');
      expect(calls[0].params).toEqual(['c-1', 'studio-1']);
    });

    it('with empty filter deletes the whole tenant slice (still scoped)', async () => {
      const { db, calls } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await tx.delete('audit_log', {});
      // Critical: no missing tenant_id — would have been a cross-tenant disaster
      expect(calls[0].sql).toBe('DELETE FROM audit_log WHERE tenant_id = ?');
      expect(calls[0].params).toEqual(['studio-1']);
    });
  });

  describe('count', () => {
    it('returns the count from SELECT COUNT(*)', async () => {
      const db = new Database('app', 'https://data.example', fakeAuth());
      db.query = vi.fn(async () => ({
        rows: [{ n: 7 }],
        meta: { changes: 0, duration: 0 },
      }));
      const tx = new TenantScope(db, 'studio-1');
      expect(await tx.count('clients')).toBe(7);
      expect((db.query as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
        'SELECT COUNT(*) AS n FROM clients WHERE tenant_id = ?',
        ['studio-1'],
      ]);
    });

    it('returns 0 when query yields no rows', async () => {
      const db = new Database('app', 'https://data.example', fakeAuth());
      db.query = vi.fn(async () => ({ rows: [], meta: { changes: 0, duration: 0 } }));
      const tx = new TenantScope(db, 'studio-1');
      expect(await tx.count('clients')).toBe(0);
    });
  });

  describe('identifier safety', () => {
    it('rejects unsafe table names', async () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await expect(tx.find('clients; DROP TABLE users')).rejects.toThrow(/Unsafe SQL identifier/);
      await expect(tx.findMany('clients WHERE 1=1')).rejects.toThrow(/Unsafe SQL identifier/);
      await expect(tx.insert("clients';--", { id: 'x' })).rejects.toThrow(/Unsafe SQL identifier/);
    });

    it('rejects unsafe column names in filter', async () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await expect(tx.find('clients', { 'id OR 1=1': 'x' })).rejects.toThrow(
        /Unsafe SQL identifier/,
      );
    });

    it('rejects unsafe column names in insert values', async () => {
      const { db } = captureDb();
      const tx = new TenantScope(db, 'studio-1');
      await expect(tx.insert('clients', { 'name)--': 'x' })).rejects.toThrow(
        /Unsafe SQL identifier/,
      );
    });
  });

  describe('via Database.tenant()', () => {
    it('Database.tenant returns a TenantScope bound to that id', () => {
      const db = new Database('app', 'https://data.example', fakeAuth());
      const tx = db.tenant('studio-99');
      expect(tx).toBeInstanceOf(TenantScope);
      expect(tx.tenantId).toBe('studio-99');
      expect(tx.db).toBe(db);
    });
  });
});
