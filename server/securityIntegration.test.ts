import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteLedgerStore } from './sqliteLedger.ts';
import { verifyCommandEIP712 } from './cryptoIssuer.ts';
import { ROLE_SIGNERS, signSentinelCommand } from '../src/utils/commandSigner.ts';
import { canRoleExecuteAction } from '../src/utils/sentinelLogic.ts';

test('SqliteLedgerStore seals Shamir shares at rest with ECIES and supports O(1) scan + incremental delta commits', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medsupply-sqlite-test-'));
  const dbPath = path.join(tmpDir, 'test-ledger.db');
  try {
    const store = new SqliteLedgerStore(dbPath);
    const initial = store.getFullState();
    assert.equal(initial.version >= 1, true);

    // Seed pack SN-PCV20-2026-0005 shares must be sealed at rest (empty plaintext yChunksHex)
    const dispensedSeedPack = initial.packs.find((p) => p.serialNumber === 'SN-PCV20-2026-0005');
    assert.ok(dispensedSeedPack);
    assert.equal(dispensedSeedPack.shamirRecallShares?.length, 3);
    for (const share of dispensedSeedPack.shamirRecallShares || []) {
      assert.equal(share.isSealedECIES, true);
      assert.equal(share.yChunksHex.length, 0);
      assert.ok(share.eciesEnvelope?.ciphertextHex);
    }

    // O(1) granular pack scan update
    const scanPack = initial.packs[0];
    const updatedScanPack = {
      ...scanPack,
      scanCount: scanPack.scanCount + 1,
      lastScannedLocation: 'Boston Clinical Test Hub',
    };
    const afterGranular = store.updatePackScanGranular(updatedScanPack, initial);
    assert.equal(afterGranular.version, initial.version + 1);
    const reloadedAfterGranular = store.getFullState();
    const persistedScanPack = reloadedAfterGranular.packs.find(
      (p) => p.serialNumber === scanPack.serialNumber
    );
    assert.equal(persistedScanPack?.scanCount, scanPack.scanCount + 1);
    assert.equal(persistedScanPack?.lastScannedLocation, 'Boston Clinical Test Hub');

    // Incremental delta commit + atomic nonce replay guard
    const nextState = structuredClone(reloadedAfterGranular);
    nextState.batches = [
      {
        ...nextState.batches[0],
        packsRegistered: nextState.batches[0].packsRegistered + 1,
      },
      ...nextState.batches.slice(1),
    ];
    const nonce = `TEST-NONCE-${Date.now()}`;
    const afterDelta = store.commitIncrementalState(reloadedAfterGranular, nextState, nonce);
    assert.equal(afterDelta.version, reloadedAfterGranular.version + 1);
    assert.equal(store.isNonceUsed(nonce), true);

    const reloadedAfterDelta = store.getFullState();
    assert.equal(
      reloadedAfterDelta.batches[0].packsRegistered,
      reloadedAfterGranular.batches[0].packsRegistered + 1
    );
    store.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('EIP-712 command signer + server RBAC verification authorizes Regulator LEDGER_RESET and blocks Manufacturer/Distributor escalation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medsupply-rbac-test-'));
  const dbPath = path.join(tmpDir, 'test-rbac.db');
  try {
    const store = new SqliteLedgerStore(dbPath);
    const state = store.getFullState();

    // Stub minimal globalThis.window for commandSigner in Node test environment
    if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
      (globalThis as Record<string, unknown>).window = {};
    }

    const regulator = ROLE_SIGNERS.find((s) => s.role === 'REGULATOR')!;
    const distributor = ROLE_SIGNERS.find((s) => s.role === 'DISTRIBUTOR')!;

    const resetCmd = await signSentinelCommand({
      action: 'ledger-reset',
      targetId: 'GLOBAL',
      payload: {},
      signer: regulator,
    });
    const authReg = await verifyCommandEIP712(resetCmd, state.participants);
    assert.equal(authReg.ok, true);
    assert.equal(authReg.resolvedRole, 'REGULATOR');
    assert.equal(canRoleExecuteAction(authReg.resolvedRole!, 'LEDGER_RESET').allowed, true);
    assert.equal(canRoleExecuteAction(authReg.resolvedRole!, 'MANAGE_PARTICIPANTS').allowed, true);

    const rogueResetCmd = await signSentinelCommand({
      action: 'ledger-reset',
      targetId: 'GLOBAL',
      payload: {},
      signer: distributor,
    });
    const authDist = await verifyCommandEIP712(rogueResetCmd, state.participants);
    assert.equal(authDist.ok, true);
    assert.equal(authDist.resolvedRole, 'DISTRIBUTOR');
    assert.equal(canRoleExecuteAction(authDist.resolvedRole!, 'LEDGER_RESET').allowed, false);
    assert.equal(canRoleExecuteAction(authDist.resolvedRole!, 'MANAGE_PARTICIPANTS').allowed, false);

    store.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
