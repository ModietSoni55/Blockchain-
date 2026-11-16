import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  BatchRecord,
  RecallProposalRecord,
  MedicinePackRecord,
  CustodyEvent,
  TelemetryEvent,
  PatientAdverseReport,
  ParticipantEntity,
  LogisticsHubNode,
  TransitRouteCorridor,
  PalletContainerRecord,
  CommandAuditRecord,
} from '../src/utils/sentinelLogic.ts';
import {
  INITIAL_BATCHES,
  INITIAL_PACKS,
  INITIAL_CUSTODY_EVENTS,
  INITIAL_TELEMETRY,
  INITIAL_ADVERSE_REPORTS,
  INITIAL_PARTICIPANTS,
  INITIAL_LOGISTICS_HUBS,
  INITIAL_TRANSIT_CORRIDORS,
  INITIAL_PALLETS,
} from '../src/utils/seedData.ts';

export interface PersistentLedgerState {
  version: number;
  batches: BatchRecord[];
  recallProposals: RecallProposalRecord[];
  packs: MedicinePackRecord[];
  pallets: PalletContainerRecord[];
  custodyEvents: CustodyEvent[];
  telemetry: TelemetryEvent[];
  adverseReports: PatientAdverseReport[];
  participants: ParticipantEntity[];
  logisticsHubs: LogisticsHubNode[];
  transitCorridors: TransitRouteCorridor[];
  auditLog: CommandAuditRecord[];
  lastUpdatedAt: string;
}

export class SqliteLedgerStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.createSchema();
    this.seedIfEmpty();
  }

  private createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS batches (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT UNIQUE NOT NULL,
        batch_code TEXT UNIQUE NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_batches_code ON batches(batch_code);

      CREATE TABLE IF NOT EXISTS packs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        serial_number TEXT UNIQUE NOT NULL,
        batch_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_packs_batch ON packs(batch_id);
      CREATE INDEX IF NOT EXISTS idx_packs_status ON packs(status);

      CREATE TABLE IF NOT EXISTS pallets (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        sscc TEXT UNIQUE NOT NULL,
        batch_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recall_proposals (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        batch_id TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS custody_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        serial_hash TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_custody_serial ON custody_events(serial_hash);
      CREATE INDEX IF NOT EXISTS idx_custody_batch ON custody_events(batch_id);

      CREATE TABLE IF NOT EXISTS telemetry (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        batch_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_batch ON telemetry(batch_id);

      CREATE TABLE IF NOT EXISTS adverse_reports (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        batch_code TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS participants (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        wallet_address TEXT NOT NULL,
        role TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_participants_wallet ON participants(wallet_address);

      CREATE TABLE IF NOT EXISTS logistics_hubs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transit_corridors (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        batch_code TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        version INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS trg_telemetry_no_update
      BEFORE UPDATE ON telemetry
      BEGIN
        SELECT RAISE(ABORT, 'ImmutableColdChainLedger: Sealed temperature records cannot be modified.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_telemetry_no_delete
      BEFORE DELETE ON telemetry
      BEGIN
        SELECT RAISE(ABORT, 'ImmutableColdChainLedger: Sealed temperature records cannot be deleted.');
      END;
    `);
  }

  private seedIfEmpty() {
    const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM batches').get() as { cnt: number };
    const existingMeta = this.db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
      | { value: string }
      | undefined;

    if (row.cnt === 0 || !existingMeta) {
      this.resetToSeedState();
      return;
    }

    // Check if legacy pre-Keccak hashes or pre-ECIES Shamir seed exist
    const pcvRow = this.db
      .prepare("SELECT batch_id FROM batches WHERE batch_code = 'BATCH-PCV-2026'")
      .get() as { batch_id: string } | undefined;
    if (pcvRow && pcvRow.batch_id !== INITIAL_BATCHES[0].batchId) {
      this.resetToSeedState();
      return;
    }

    const dispensedRow = this.db
      .prepare("SELECT data FROM packs WHERE serial_number = 'SN-PCV20-2026-0005'")
      .get() as { data: string } | undefined;
    if (dispensedRow) {
      try {
        const parsed = JSON.parse(dispensedRow.data) as MedicinePackRecord;
        const firstShare = parsed.shamirRecallShares?.[0];
        if (!firstShare?.isSealedECIES || (firstShare.yChunksHex?.length ?? 0) > 0) {
          this.resetToSeedState();
          return;
        }
      } catch {
        this.resetToSeedState();
        return;
      }
    }

    // Ensure telemetry records carry Keccak-256 chain block hashes
    const firstTel = this.db
      .prepare("SELECT data FROM telemetry WHERE id = 'tel-1'")
      .get() as { data: string } | undefined;
    if (firstTel) {
      try {
        const parsedTel = JSON.parse(firstTel.data) as TelemetryEvent;
        if (!parsedTel.blockHash || !parsedTel.prevBlockHash) {
          this.resetToSeedState();
        }
      } catch {
        this.resetToSeedState();
      }
    }
  }

  public getVersion(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) || 1 : 1;
  }

  public getLastUpdatedAt(): string {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'lastUpdatedAt'").get() as
      | { value: string }
      | undefined;
    return row ? row.value : new Date().toISOString();
  }

  public resetToSeedState(): PersistentLedgerState {
    const now = new Date().toISOString();
    const state: PersistentLedgerState = {
      version: 1,
      batches: structuredClone(INITIAL_BATCHES),
      recallProposals: [],
      packs: structuredClone(INITIAL_PACKS),
      pallets: structuredClone(INITIAL_PALLETS),
      custodyEvents: structuredClone(INITIAL_CUSTODY_EVENTS),
      telemetry: structuredClone(INITIAL_TELEMETRY),
      adverseReports: structuredClone(INITIAL_ADVERSE_REPORTS),
      participants: structuredClone(INITIAL_PARTICIPANTS),
      logisticsHubs: structuredClone(INITIAL_LOGISTICS_HUBS),
      transitCorridors: structuredClone(INITIAL_TRANSIT_CORRIDORS),
      auditLog: [],
      lastUpdatedAt: now,
    };
    this.replaceState(state, false);
    this.db.prepare('DELETE FROM used_nonces').run();
    return state;
  }

  public replaceState(state: PersistentLedgerState, bumpVersion = true): PersistentLedgerState {
    const nextVersion = bumpVersion ? this.getVersion() + 1 : state.version || 1;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DROP TRIGGER IF EXISTS trg_telemetry_no_update;');
      this.db.exec('DROP TRIGGER IF EXISTS trg_telemetry_no_delete;');
      const tables = [
        'batches',
        'packs',
        'pallets',
        'recall_proposals',
        'custody_events',
        'telemetry',
        'adverse_reports',
        'participants',
        'logistics_hubs',
        'transit_corridors',
        'audit_log',
      ];
      for (const tbl of tables) {
        this.db.exec(`DELETE FROM ${tbl}`);
      }

      const insertBatch = this.db.prepare(
        'INSERT INTO batches (batch_id, batch_code, data) VALUES (?, ?, ?)'
      );
      for (const b of state.batches) {
        insertBatch.run(b.batchId, b.batchCode, JSON.stringify(b));
      }

      const insertPack = this.db.prepare(
        'INSERT INTO packs (serial_number, batch_id, status, data) VALUES (?, ?, ?, ?)'
      );
      for (const p of state.packs) {
        insertPack.run(p.serialNumber, p.batchId, p.status, JSON.stringify(p));
      }

      const insertPallet = this.db.prepare(
        'INSERT INTO pallets (sscc, batch_id, status, data) VALUES (?, ?, ?, ?)'
      );
      for (const pal of state.pallets || []) {
        insertPallet.run(pal.sscc, pal.batchId, pal.status, JSON.stringify(pal));
      }

      const insertProp = this.db.prepare(
        'INSERT INTO recall_proposals (id, batch_id, data) VALUES (?, ?, ?)'
      );
      for (const rp of state.recallProposals || []) {
        insertProp.run(rp.id, rp.batchId, JSON.stringify(rp));
      }

      const insertCustody = this.db.prepare(
        'INSERT INTO custody_events (id, serial_hash, batch_id, timestamp, data) VALUES (?, ?, ?, ?, ?)'
      );
      for (const c of state.custodyEvents) {
        insertCustody.run(c.id, c.serialHash, c.batchId, c.timestamp, JSON.stringify(c));
      }

      const insertTel = this.db.prepare(
        'INSERT INTO telemetry (id, batch_id, timestamp, data) VALUES (?, ?, ?, ?)'
      );
      for (const t of state.telemetry) {
        insertTel.run(t.id, t.batchId, t.timestamp, JSON.stringify(t));
      }

      const insertRep = this.db.prepare(
        'INSERT INTO adverse_reports (id, batch_code, data) VALUES (?, ?, ?)'
      );
      for (const r of state.adverseReports) {
        insertRep.run(r.id, r.batchCode, JSON.stringify(r));
      }

      const insertPart = this.db.prepare(
        'INSERT INTO participants (id, wallet_address, role, data) VALUES (?, ?, ?, ?)'
      );
      for (const pt of state.participants) {
        insertPart.run(pt.id, pt.walletAddress.toLowerCase(), pt.role, JSON.stringify(pt));
      }

      const insertHub = this.db.prepare('INSERT INTO logistics_hubs (id, data) VALUES (?, ?)');
      for (const h of state.logisticsHubs) {
        insertHub.run(h.id, JSON.stringify(h));
      }

      const insertCorr = this.db.prepare(
        'INSERT INTO transit_corridors (id, batch_code, data) VALUES (?, ?, ?)'
      );
      for (const c of state.transitCorridors) {
        insertCorr.run(c.id, c.batchCode, JSON.stringify(c));
      }

      const insertAudit = this.db.prepare(
        'INSERT INTO audit_log (id, version, timestamp, data) VALUES (?, ?, ?, ?)'
      );
      for (const a of (state.auditLog || []).slice(0, 100)) {
        insertAudit.run(a.id, a.version, a.timestamp, JSON.stringify(a));
      }

      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)")
        .run(String(nextVersion));
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastUpdatedAt', ?)")
        .run(now);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_telemetry_no_update
        BEFORE UPDATE ON telemetry
        BEGIN
          SELECT RAISE(ABORT, 'ImmutableColdChainLedger: Sealed temperature records cannot be modified.');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_telemetry_no_delete
        BEFORE DELETE ON telemetry
        BEGIN
          SELECT RAISE(ABORT, 'ImmutableColdChainLedger: Sealed temperature records cannot be deleted.');
        END;
      `);

      this.db.exec('COMMIT');
      return {
        ...state,
        version: nextVersion,
        lastUpdatedAt: now,
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * O(1) ACID SQLite row update for public /api/verify scans without rewriting untouched tables.
   */
  public updatePackScanGranular(
    updatedPack: MedicinePackRecord,
    currentState: PersistentLedgerState
  ): PersistentLedgerState {
    const nextVersion = this.getVersion() + 1;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('UPDATE packs SET status = ?, data = ? WHERE serial_number = ?')
        .run(updatedPack.status, JSON.stringify(updatedPack), updatedPack.serialNumber);

      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)")
        .run(String(nextVersion));
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastUpdatedAt', ?)")
        .run(now);
      this.db.exec('COMMIT');

      return {
        ...currentState,
        packs: currentState.packs.map((p) =>
          p.serialNumber === updatedPack.serialNumber ? updatedPack : p
        ),
        version: nextVersion,
        lastUpdatedAt: now,
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Incremental ACID delta commit: only writes rows added or mutated relative to prevState,
   * eliminating full-table DELETE+reinsert overhead on high-volume operations.
   */
  public commitIncrementalState(
    prevState: PersistentLedgerState,
    nextState: PersistentLedgerState,
    usedNonce?: string
  ): PersistentLedgerState {
    const nextVersion = this.getVersion() + 1;
    const now = new Date().toISOString();

    const syncTableByKey = <T>(
      prevItems: T[],
      nextItems: T[],
      getKey: (item: T) => string,
      upsertSql: string,
      bindArgs: (item: T) => Array<string | number>
    ) => {
      const prevMap = new Map<string, string>();
      for (const item of prevItems) {
        prevMap.set(getKey(item), JSON.stringify(item));
      }
      const stmt = this.db.prepare(upsertSql);
      for (const item of nextItems) {
        const key = getKey(item);
        const serialized = JSON.stringify(item);
        if (prevMap.get(key) !== serialized) {
          stmt.run(...bindArgs(item));
        }
      }
    };

    this.db.exec('BEGIN IMMEDIATE');
    try {
      syncTableByKey(
        prevState.batches,
        nextState.batches,
        (b) => b.batchId,
        'INSERT INTO batches (batch_id, batch_code, data) VALUES (?, ?, ?) ON CONFLICT(batch_id) DO UPDATE SET batch_code = excluded.batch_code, data = excluded.data',
        (b) => [b.batchId, b.batchCode, JSON.stringify(b)]
      );

      syncTableByKey(
        prevState.packs,
        nextState.packs,
        (p) => p.serialNumber,
        'INSERT INTO packs (serial_number, batch_id, status, data) VALUES (?, ?, ?, ?) ON CONFLICT(serial_number) DO UPDATE SET batch_id = excluded.batch_id, status = excluded.status, data = excluded.data',
        (p) => [p.serialNumber, p.batchId, p.status, JSON.stringify(p)]
      );

      syncTableByKey(
        prevState.pallets || [],
        nextState.pallets || [],
        (pal) => pal.sscc,
        'INSERT INTO pallets (sscc, batch_id, status, data) VALUES (?, ?, ?, ?) ON CONFLICT(sscc) DO UPDATE SET batch_id = excluded.batch_id, status = excluded.status, data = excluded.data',
        (pal) => [pal.sscc, pal.batchId, pal.status, JSON.stringify(pal)]
      );

      syncTableByKey(
        prevState.recallProposals || [],
        nextState.recallProposals || [],
        (rp) => rp.id,
        'INSERT INTO recall_proposals (id, batch_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET batch_id = excluded.batch_id, data = excluded.data',
        (rp) => [rp.id, rp.batchId, JSON.stringify(rp)]
      );

      syncTableByKey(
        prevState.custodyEvents,
        nextState.custodyEvents,
        (c) => c.id,
        'INSERT OR IGNORE INTO custody_events (id, serial_hash, batch_id, timestamp, data) VALUES (?, ?, ?, ?, ?)',
        (c) => [c.id, c.serialHash, c.batchId, c.timestamp, JSON.stringify(c)]
      );

      syncTableByKey(
        prevState.telemetry,
        nextState.telemetry,
        (t) => t.id,
        'INSERT OR IGNORE INTO telemetry (id, batch_id, timestamp, data) VALUES (?, ?, ?, ?)',
        (t) => [t.id, t.batchId, t.timestamp, JSON.stringify(t)]
      );

      syncTableByKey(
        prevState.adverseReports,
        nextState.adverseReports,
        (r) => r.id,
        'INSERT INTO adverse_reports (id, batch_code, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        (r) => [r.id, r.batchCode, JSON.stringify(r)]
      );

      syncTableByKey(
        prevState.participants,
        nextState.participants,
        (pt) => pt.id,
        'INSERT INTO participants (id, wallet_address, role, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET wallet_address = excluded.wallet_address, role = excluded.role, data = excluded.data',
        (pt) => [pt.id, pt.walletAddress.toLowerCase(), pt.role, JSON.stringify(pt)]
      );

      syncTableByKey(
        prevState.logisticsHubs,
        nextState.logisticsHubs,
        (h) => h.id,
        'INSERT INTO logistics_hubs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        (h) => [h.id, JSON.stringify(h)]
      );

      syncTableByKey(
        prevState.transitCorridors,
        nextState.transitCorridors,
        (c) => c.id,
        'INSERT INTO transit_corridors (id, batch_code, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET batch_code = excluded.batch_code, data = excluded.data',
        (c) => [c.id, c.batchCode, JSON.stringify(c)]
      );

      syncTableByKey(
        prevState.auditLog || [],
        (nextState.auditLog || []).slice(0, 100),
        (a) => a.id,
        'INSERT INTO audit_log (id, version, timestamp, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, data = excluded.data',
        (a) => [a.id, a.version, a.timestamp, JSON.stringify(a)]
      );

      if (usedNonce) {
        this.db
          .prepare('INSERT OR IGNORE INTO used_nonces (nonce, created_at) VALUES (?, ?)')
          .run(usedNonce, now);
      }

      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)")
        .run(String(nextVersion));
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastUpdatedAt', ?)")
        .run(now);

      this.db.exec('COMMIT');
      return {
        ...nextState,
        version: nextVersion,
        lastUpdatedAt: now,
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public isNonceUsed(nonce: string): boolean {
    const row = this.db.prepare('SELECT nonce FROM used_nonces WHERE nonce = ?').get(nonce);
    return Boolean(row);
  }

  public markNonceUsed(nonce: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO used_nonces (nonce, created_at) VALUES (?, ?)')
      .run(nonce, new Date().toISOString());
  }

  public getFullState(): PersistentLedgerState {
    const parseRows = <T>(table: string): T[] => {
      const rows = this.db.prepare(`SELECT data FROM ${table} ORDER BY seq ASC`).all() as Array<{
        data: string;
      }>;
      return rows.map((r) => JSON.parse(r.data) as T);
    };

    const custodyEvents = parseRows<CustodyEvent>('custody_events').sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const telemetry = parseRows<TelemetryEvent>('telemetry').sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const adverseReports = parseRows<PatientAdverseReport>('adverse_reports').sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const auditLog = parseRows<CommandAuditRecord>('audit_log').sort(
      (a, b) => b.version - a.version
    );

    return {
      version: this.getVersion(),
      batches: parseRows<BatchRecord>('batches'),
      recallProposals: parseRows<RecallProposalRecord>('recall_proposals'),
      packs: parseRows<MedicinePackRecord>('packs'),
      pallets: parseRows<PalletContainerRecord>('pallets'),
      custodyEvents,
      telemetry,
      adverseReports,
      participants: parseRows<ParticipantEntity>('participants'),
      logisticsHubs: parseRows<LogisticsHubNode>('logistics_hubs'),
      transitCorridors: parseRows<TransitRouteCorridor>('transit_corridors'),
      auditLog,
      lastUpdatedAt: this.getLastUpdatedAt(),
    };
  }

  public getPaginatedPacks(params: {
    page?: number;
    limit?: number;
    q?: string;
    status?: string;
  }): { items: MedicinePackRecord[]; total: number; page: number; totalPages: number } {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(Math.max(1, Number(params.limit) || 20), 100);
    const q = (params.q || '').trim().toLowerCase();
    const statusFilter = (params.status || '').trim().toUpperCase();

    let allPacks = (
      this.db.prepare('SELECT data FROM packs ORDER BY seq ASC').all() as Array<{ data: string }>
    ).map((r) => JSON.parse(r.data) as MedicinePackRecord);

    if (statusFilter && statusFilter !== 'ALL') {
      allPacks = allPacks.filter((p) => p.status.toUpperCase() === statusFilter);
    }
    if (q) {
      allPacks = allPacks.filter(
        (p) =>
          p.serialNumber.toLowerCase().includes(q) ||
          p.currentCustodian.toLowerCase().includes(q) ||
          p.status.toLowerCase().includes(q)
      );
    }

    const total = allPacks.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    return {
      items: allPacks.slice(offset, offset + limit),
      total,
      page,
      totalPages,
    };
  }

  public close(): void {
    this.db.close();
  }
}
