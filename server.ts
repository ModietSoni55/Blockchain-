import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  BatchRecord,
  RecallProposalRecord,
  MedicinePackRecord,
  CustodyEvent,
  PatientAdverseReport,
  ParticipantEntity,
  PalletContainerRecord,
  CommandAuditRecord,
  RoleType,
  computeKeccakHex,
  parseQRScanInput,
  verifyQRSignature,
  verifyQRSignatureECDSA,
  detectImpossibleGeographicJump,
  evaluateColdChainReading,
  evaluatePackVerification,
  buildBatchMerkleTree,
  canRoleExecuteAction,
  verifySignedTelemetryECDSA,
  generateCSPRNGBlindingSalt,
  createZKPrescriptionCommitment,
  deriveDeterministicPUFPrint,
  computePUFHammingMatch,
  splitSecretShamir,
  sealShamirSharesECIES,
  reconstructSecretShamir,
  sealTelemetryEventChain,
  buildTelemetryHashChain,
  traceSupplyChainStageForensics,
  ShamirShareRecord,
  PUFMatchResult,
  MANUFACTURER_PUBLIC_ADDRESS,
} from './src/utils/sentinelLogic.ts';
import { AUTHORIZED_IOT_GATEWAYS } from './src/utils/seedData.ts';
import { SqliteLedgerStore, PersistentLedgerState } from './server/sqliteLedger.ts';
import {
  getIssuerPublicAddress,
  signPackQRWithServerECDSA,
  verifyCommandEIP712,
  SignedCommandEnvelope,
} from './server/cryptoIssuer.ts';
import {
  probeLiveEvmNode,
  relayToEvmIfDeployed,
  relayColdChainTelemetryIfDeployed,
} from './server/evmRelay.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQLITE_DB_PATH = path.join(__dirname, 'data', 'medsupply-sentinel.db');

// Sliding-window IP rate limiter for public /api/verify endpoint
const verifyRateBucket = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

function checkVerifyRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = (verifyRateBucket.get(ip) || []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    verifyRateBucket.set(ip, timestamps);
    return { allowed: false, remaining: 0 };
  }
  timestamps.push(now);
  verifyRateBucket.set(ip, timestamps);
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - timestamps.length };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Hardened HTTP security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  const store = new SqliteLedgerStore(SQLITE_DB_PATH);
  let ledgerState: PersistentLedgerState = store.getFullState();

  // Real-time Server-Sent Events (SSE) clients
  const sseClients = new Set<express.Response>();

  // Unified Health & Infrastructure Capabilities Endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      status: 'ok',
      nodeVersion: process.version,
      persistence: 'sqlite-wal-acid',
      dbPath: 'data/medsupply-sentinel.db',
      version: ledgerState.version,
      ledgerVersion: ledgerState.version,
      issuerPublicAddress: getIssuerPublicAddress(),
      sseSubscribers: sseClients.size,
      lastUpdatedAt: ledgerState.lastUpdatedAt,
      counts: {
        batches: ledgerState.batches.length,
        packs: ledgerState.packs.length,
        pallets: ledgerState.pallets.length,
        custodyEvents: ledgerState.custodyEvents.length,
        telemetry: ledgerState.telemetry.length,
        auditEntries: ledgerState.auditLog.length,
      },
    });
  });

  const broadcastSSE = (eventName: string, data: Record<string, unknown>) => {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  // Real-Time SSE Event Stream
  app.get('/api/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        version: ledgerState.version,
        clients: sseClients.size,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Public Cryptographic Issuer Config (never leaks private keys)
  app.get('/api/crypto/public-key', (_req, res) => {
    res.json({
      issuerPublicAddress: getIssuerPublicAddress(),
      algorithm: 'secp256k1 ECDSA + EIP-712 v4',
      authorizedIoTGateways: AUTHORIZED_IOT_GATEWAYS,
    });
  });

  // Live EVM RPC Node Probe (Anvil / Sepolia / L2 via viem + bytecode verification)
  app.get('/api/evm/status', async (_req, res) => {
    const status = await probeLiveEvmNode(ledgerState.custodyEvents.length);
    res.json(status);
  });

  // Full Ledger Snapshot
  app.get('/api/ledger', (_req, res) => {
    ledgerState = store.getFullState();
    res.json(ledgerState);
  });

  // Server-side Paginated & Filtered Pack Registry Query
  app.get('/api/packs', (req, res) => {
    const result = store.getPaginatedPacks({
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      q: typeof req.query.q === 'string' ? req.query.q : '',
      status: typeof req.query.status === 'string' ? req.query.status : 'ALL',
    });
    res.json(result);
  });

  // Offline Edge Verification Vault Snapshot (for IndexedDB caching)
  app.get('/api/offline-snapshot', (_req, res) => {
    const merkleRootsByBatchId: Record<string, string> = {};
    for (const batch of ledgerState.batches) {
      const batchPacks = ledgerState.packs.filter((p) => p.batchId === batch.batchId);
      merkleRootsByBatchId[batch.batchId] =
        batch.anchoredMerkleRoot ||
        buildBatchMerkleTree(batchPacks, batch.expiresAt).merkleRoot;
    }
    res.json({
      syncedAt: new Date().toISOString(),
      ledgerVersion: ledgerState.version,
      issuerAddress: getIssuerPublicAddress(),
      batches: ledgerState.batches,
      packs: ledgerState.packs,
      merkleRootsByBatchId,
    });
  });

  // Command Audit Log Explorer
  app.get('/api/audit-log', (_req, res) => {
    res.json({
      version: ledgerState.version,
      items: ledgerState.auditLog,
    });
  });

  // Cold-Chain Telemetry Blockchain Integrity Verification Endpoint
  app.get('/api/cold-chain/integrity', (_req, res) => {
    const verification = buildTelemetryHashChain(ledgerState.telemetry);
    res.json({
      ok: verification.allValid,
      totalBlocks: verification.totalBlocks,
      brokenCount: verification.brokenCount,
      firstBrokenBlockIndex: verification.firstBrokenBlockIndex,
      latestBlockHash: verification.latestBlockHash,
      appendOnlySqliteTriggers: true,
    });
  });

  // Deprecate insecure full-state overwrite endpoint
  app.post('/api/ledger/sync', (_req, res) => {
    res.status(403).json({
      ok: false,
      error:
        'SecurityPolicy: Direct client state overwrites are disabled. Submit EIP-712 signed commands to /api/commands/:action.',
    });
  });

  // Reset persistent SQLite ledger back to factory seed state (Requires REGULATOR EIP-712 Signature)
  app.post('/api/ledger/reset', async (req, res) => {
    try {
      const envelope = req.body as SignedCommandEnvelope<Record<string, unknown>>;
      if (!envelope || envelope.action !== 'ledger-reset' || !envelope.signature) {
        return res.status(403).json({
          ok: false,
          error:
            'AccessControl: /api/ledger/reset requires a REGULATOR EIP-712 SignedCommandEnvelope.',
        });
      }
      if (store.isNonceUsed(envelope.nonce)) {
        return res.status(409).json({
          ok: false,
          error: `ReplayAttackBlocked: Command nonce ${envelope.nonce} has already been executed.`,
        });
      }
      const auth = await verifyCommandEIP712(envelope, ledgerState.participants);
      if (!auth.ok || !auth.resolvedRole) {
        return res.status(403).json({ ok: false, error: auth.error || 'Unauthorized signer' });
      }
      const rbac = canRoleExecuteAction(auth.resolvedRole, 'LEDGER_RESET');
      if (!rbac.allowed) {
        return res.status(403).json({ ok: false, error: rbac.reason || 'AccessControl: Lacks REGULATOR_ROLE' });
      }

      ledgerState = store.resetToSeedState();
      store.markNonceUsed(envelope.nonce);
      broadcastSSE('ledger_updated', {
        reason: 'LEDGER_RESET',
        version: ledgerState.version,
      });
      return res.json(ledgerState);
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Authenticated EIP-712 Command Dispatcher
  app.post('/api/commands/:action', async (req, res) => {
    try {
      const actionParam = req.params.action;
      const envelope = req.body as SignedCommandEnvelope<Record<string, unknown>>;

      if (!envelope || envelope.action !== actionParam) {
        return res.status(400).json({
          ok: false,
          error: `Action mismatch: URL "${actionParam}" vs signed envelope "${envelope?.action}".`,
        });
      }

      // 1. Check optimistic concurrency version if provided
      if (
        typeof envelope.expectedVersion === 'number' &&
        envelope.expectedVersion !== ledgerState.version
      ) {
        return res.status(409).json({
          ok: false,
          error: `OptimisticLockConflict: Client version ${envelope.expectedVersion} behind server version ${ledgerState.version}. Refreshing ledger.`,
          currentVersion: ledgerState.version,
        });
      }

      // 2. Check EIP-712 nonce replay protection
      if (store.isNonceUsed(envelope.nonce)) {
        return res.status(409).json({
          ok: false,
          error: `ReplayAttackBlocked: Command nonce ${envelope.nonce} has already been executed.`,
        });
      }

      // 3. Recover & verify EIP-712 signature via viem
      const auth = await verifyCommandEIP712(envelope, ledgerState.participants);
      if (!auth.ok || !auth.recoveredAddress || !auth.resolvedRole) {
        return res.status(403).json({ ok: false, error: auth.error || 'Unauthorized signer' });
      }

      const role = auth.resolvedRole;
      const signerAddr = auth.recoveredAddress;
      const p = envelope.payload || {};
      const nowIso = new Date().toISOString();

      const nextState: PersistentLedgerState = structuredClone(ledgerState);
      let auditSummary = `${actionParam} executed by ${signerAddr}`;
      let sseEventName = 'ledger_updated';
      let sseExtra: Record<string, unknown> = {};
      let extraResult: Record<string, unknown> = {};

      const assertRole = (rbacAction: Parameters<typeof canRoleExecuteAction>[1]) => {
        const check = canRoleExecuteAction(role, rbacAction);
        if (!check.allowed) {
          throw new Error(check.reason || `AccessControl: Lacks ${check.requiredRole}_ROLE.`);
        }
      };

      switch (actionParam) {
        case 'mint-batch': {
          assertRole('MINT_BATCH');
          const batchCode = String(p.batchCode || '').trim().toUpperCase();
          const brandName = String(p.brandName || '').trim();
          if (!batchCode || !brandName) {
            throw new Error('Batch code and brand name are required.');
          }
          if (nextState.batches.some((b) => b.batchCode.toLowerCase() === batchCode.toLowerCase())) {
            throw new Error('A batch with this code is already registered on the ledger.');
          }
          const minTemp = Number(p.minTemp ?? 2.0);
          const maxTemp = Number(p.maxTemp ?? 8.0);
          if (minTemp >= maxTemp) {
            throw new Error('Minimum safe temperature must be strictly lower than maximum.');
          }

          const originHub =
            nextState.logisticsHubs.find((h) => h.id === p.originHubId) ||
            nextState.logisticsHubs[0];
          const destHub =
            nextState.logisticsHubs.find((h) => h.id === p.destHubId) ||
            nextState.logisticsHubs[1];
          const manufacturerOrg =
            nextState.participants.find((pt) => pt.role === 'MANUFACTURER' && pt.isAuthorized)
              ?.organizationName || 'Pfizer BioTech Manufacturing';

          const batchId = computeKeccakHex(batchCode);
          const txHash = computeKeccakHex(`tx:${batchCode}:${Date.now()}`).slice(0, 66);
          const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

          const createdBatch: BatchRecord = {
            batchId,
            batchCode,
            productCode: String(p.productCode || 'NDC-0069-9000-01'),
            brandName,
            genericName: String(p.genericName || 'Biologic Active Formulation'),
            dosageForm: 'Sterile Single-Dose Vial',
            strength: '1.0 mL',
            totalPacks: Number(p.totalPacks) || 100,
            packsRegistered: 1,
            minTemp,
            maxTemp,
            manufacturedAt: nowIso,
            expiresAt,
            manufacturerName: manufacturerOrg,
            manufacturerAddress: signerAddr,
            isQuarantined: false,
            isRecalled: false,
            txHash,
          };

          const firstSerial = `SN-${batchCode}-0001`;
          const firstHash = computeKeccakHex(firstSerial);
          const firstNonce = computeKeccakHex(`nonce:${firstSerial}:${Date.now()}`);
          // Real asymmetric server-side ECDSA QR signature!
          const firstSig = await signPackQRWithServerECDSA(
            firstSerial,
            batchId,
            expiresAt,
            firstNonce
          );

          const initialPack: MedicinePackRecord = {
            serialNumber: firstSerial,
            serialHash: firstHash,
            batchId,
            tokenId: nextState.packs.length + 1,
            status: 'MANUFACTURED',
            currentCustodian: manufacturerOrg,
            custodianRole: 'MANUFACTURER',
            nonce: firstNonce,
            signature: firstSig,
            scanCount: 0,
            isSuspicious: false,
            lastScannedLocation: `${originHub.name} (${originHub.cityState})`,
            lastScanLat: originHub.coordinates[1],
            lastScanLon: originHub.coordinates[0],
            pufSealHash: deriveDeterministicPUFPrint(firstSerial, batchId),
          };

          const genesisCustody: CustodyEvent = {
            id: `cust-${Date.now()}`,
            serialHash: firstHash,
            batchId,
            fromActor: '0x0000...0000 (Genesis)',
            toActor: manufacturerOrg,
            action: 'MINT_GENESIS',
            location: `${originHub.name}, ${originHub.cityState}`,
            timestamp: nowIso,
            notes: `Batch ${batchCode} minted with server-signed ECDSA QR pack ${firstSerial}`,
            txHash,
          };

          const distInfo = detectImpossibleGeographicJump(
            originHub.coordinates[1],
            originHub.coordinates[0],
            destHub.coordinates[1],
            destHub.coordinates[0],
            600
          );
          const estHours = Math.max(Math.round((distInfo.distanceKm / 85) * 10) / 10, 2.5);

          const initialTempVal =
            p.initialTemp !== undefined && !Number.isNaN(Number(p.initialTemp))
              ? Number(p.initialTemp)
              : Number(((minTemp + maxTemp) / 2).toFixed(1));
          const initialEval = evaluateColdChainReading(initialTempVal, minTemp, maxTemp);
          const mfgSealedTelemetry = sealTelemetryEventChain(
            {
              id: `tel-mfg-${Date.now()}`,
              batchId,
              temperature: initialTempVal,
              humidity: initialEval.isBreached ? 66.0 : 48.0,
              latitude: originHub.coordinates[1],
              longitude: originHub.coordinates[0],
              locationLabel: `${originHub.name}, ${originHub.cityState}`,
              deviceId: 'MFG-VAULT-PROBE-01',
              timestamp: nowIso,
              isBreached: initialEval.isBreached,
              breachType: initialEval.breachType,
              txHash,
              signerAddress: signerAddr,
            },
            nextState.telemetry
          );

          nextState.batches = [createdBatch, ...nextState.batches];
          nextState.packs = [initialPack, ...nextState.packs];
          nextState.custodyEvents = [genesisCustody, ...nextState.custodyEvents];
          nextState.telemetry = [mfgSealedTelemetry, ...nextState.telemetry];
          nextState.transitCorridors = [
            {
              id: `route-${Date.now()}`,
              batchCode,
              brandName,
              fromHubId: originHub.id,
              toHubId: destHub.id,
              fromCoordinates: originHub.coordinates,
              toCoordinates: destHub.coordinates,
              distanceKm: Math.max(Math.round(distInfo.distanceKm), 120),
              estimatedHours: estHours,
              actualHours: estHours,
              status: 'OPTIMAL',
              carrierName: String(p.carrierName || 'Apex Cold-Chain Logistics'),
              bottleneckDetail: `Active cold-chain corridor (${minTemp}°C–${maxTemp}°C) registered on-chain.`,
            },
            ...nextState.transitCorridors,
          ];
          nextState.logisticsHubs = nextState.logisticsHubs.map((h) =>
            h.id === originHub.id || h.id === destHub.id
              ? {
                  ...h,
                  activeBatches: h.activeBatches.includes(batchCode)
                    ? h.activeBatches
                    : [...h.activeBatches, batchCode],
                }
              : h
          );
          auditSummary = `Minted batch ${batchCode} + ECDSA QR genesis pack ${firstSerial} (${initialTempVal.toFixed(1)}°C at ${originHub.name})`;
          const mintEvmRelay = await relayToEvmIfDeployed('anchorPackPufSeal', [
            firstHash,
            initialPack.pufSealHash!,
          ]);
          extraResult = { createdBatch, firstSerial, evmRelay: mintEvmRelay, mfgTelemetry: mfgSealedTelemetry };
          break;
        }

        case 'mint-packs': {
          assertRole('MINT_BATCH');
          const batchId = String(p.batchId || '');
          const count = Math.min(Math.max(Number(p.count) || 1, 1), 20);
          const targetBatch = nextState.batches.find((b) => b.batchId === batchId);
          if (!targetBatch) throw new Error('Target batch not found.');
          const originHub =
            nextState.logisticsHubs.find((h) => h.id === p.originHubId) ||
            nextState.logisticsHubs[0];

          const mintedPacks: MedicinePackRecord[] = [];
          const mintedCustody: CustodyEvent[] = [];

          for (let i = 0; i < count; i++) {
            const seqNum = targetBatch.packsRegistered + i + 1;
            const sn = `SN-${targetBatch.batchCode}-${String(seqNum).padStart(4, '0')}`;
            const sh = computeKeccakHex(sn);
            const nonce = computeKeccakHex(`nonce:${sn}:${Date.now()}:${i}`);
            const sig = await signPackQRWithServerECDSA(
              sn,
              targetBatch.batchId,
              targetBatch.expiresAt,
              nonce
            );
            const txHash = computeKeccakHex(`mint:${sn}:${Date.now()}:${i}`).slice(0, 66);

            mintedPacks.push({
              serialNumber: sn,
              serialHash: sh,
              batchId: targetBatch.batchId,
              tokenId: nextState.packs.length + i + 1,
              status: 'MANUFACTURED',
              currentCustodian: targetBatch.manufacturerName,
              custodianRole: 'MANUFACTURER',
              nonce,
              signature: sig,
              scanCount: 0,
              isSuspicious: false,
              lastScannedLocation: `${originHub.name} (${originHub.cityState})`,
              lastScanLat: originHub.coordinates[1],
              lastScanLon: originHub.coordinates[0],
              pufSealHash: deriveDeterministicPUFPrint(sn, targetBatch.batchId),
            });

            mintedCustody.push({
              id: `cust-${Date.now()}-${i}`,
              serialHash: sh,
              batchId: targetBatch.batchId,
              fromActor: '0x0000...0000 (Genesis)',
              toActor: targetBatch.manufacturerName,
              action: 'MINT_GENESIS',
              location: `${originHub.name}, ${originHub.cityState}`,
              timestamp: nowIso,
              notes: `Minted ERC-721 passport & ECDSA secp256k1 QR payload for ${sn}`,
              txHash,
            });
          }

          nextState.packs = [...mintedPacks, ...nextState.packs];
          nextState.custodyEvents = [...mintedCustody, ...nextState.custodyEvents];
          nextState.batches = nextState.batches.map((b) =>
            b.batchId === targetBatch.batchId
              ? { ...b, packsRegistered: b.packsRegistered + count }
              : b
          );
          nextState.logisticsHubs = nextState.logisticsHubs.map((h) =>
            h.id === originHub.id && !h.activeBatches.includes(targetBatch.batchCode)
              ? { ...h, activeBatches: [...h.activeBatches, targetBatch.batchCode] }
              : h
          );
          auditSummary = `Minted ${count} ECDSA-signed packs for ${targetBatch.batchCode}`;
          extraResult = {
            count,
            batchCode: targetBatch.batchCode,
            firstSerial: mintedPacks[0]?.serialNumber || '',
          };
          break;
        }

        case 'transfer-custody': {
          const actionName = String(p.actionName || '');
          const rbacAction =
            actionName === 'TRANSFER_DISTRIBUTOR'
              ? 'TRANSFER_DISTRIBUTOR'
              : actionName === 'TRANSFER_PHARMACY'
              ? 'TRANSFER_PHARMACY'
              : 'DISPENSE_PATIENT';
          assertRole(rbacAction);

          const serialNumber = String(p.serialNumber || '');
          const targetPack = nextState.packs.find((pk) => pk.serialNumber === serialNumber);
          if (!targetPack) throw new Error(`Pack ${serialNumber} not found.`);

          const parentBatch = nextState.batches.find((b) => b.batchId === targetPack.batchId);
          if (
            parentBatch?.isQuarantined ||
            parentBatch?.isRecalled ||
            targetPack.status === 'QUARANTINED' ||
            targetPack.status === 'RECALLED' ||
            targetPack.status === 'RETURNED_FOR_DESTRUCTION' ||
            targetPack.status === 'DESTROYED_WITNESSED'
          ) {
            throw new Error(
              `BatchUnderQuarantineOrRecall: Cannot transfer ${serialNumber} while parent batch ${parentBatch?.batchCode || ''} is quarantined or recalled.`
            );
          }

          const targetStatus = String(p.targetStatus) as MedicinePackRecord['status'];
          const nextCustodian = String(p.nextCustodian || '');
          const nextRole = String(p.nextRole || 'PHARMACY') as RoleType;
          const hubIdOrLocation = String(p.hubIdOrLocation || '');
          const matchedHub = nextState.logisticsHubs.find((h) => h.id === hubIdOrLocation);
          const previousHub =
            nextState.logisticsHubs.find(
              (h) =>
                targetPack.lastScannedLocation?.includes(h.name) ||
                targetPack.lastScannedLocation?.includes(h.cityState)
            ) ||
            (typeof targetPack.lastScanLat === 'number' && typeof targetPack.lastScanLon === 'number'
              ? nextState.logisticsHubs.find(
                  (h) =>
                    Math.abs(h.coordinates[1] - targetPack.lastScanLat!) < 0.05 &&
                    Math.abs(h.coordinates[0] - targetPack.lastScanLon!) < 0.05
                )
              : undefined);
          const locationLabel = matchedHub
            ? `${matchedHub.name}, ${matchedHub.cityState}`
            : hubIdOrLocation
            ? previousHub && !hubIdOrLocation.includes(previousHub.cityState)
              ? `${hubIdOrLocation}, ${previousHub.cityState}`
              : hubIdOrLocation
            : targetPack.lastScannedLocation || 'Verified Custody Checkpoint';
          const txHash = computeKeccakHex(
            `transfer:${serialNumber}:${targetStatus}:${Date.now()}`
          ).slice(0, 66);

          let zkSaltIssued: string | undefined;
          let zkReceiptCommitment: string | undefined;
          let shamirRecallSharesIssued: ShamirShareRecord[] | undefined;
          const rxRef = String(p.prescriptionRef || 'RX-2026-88412').trim();

          if (targetStatus === 'DISPENSED') {
            zkSaltIssued =
              typeof p.clientSalt === 'string' && p.clientSalt.trim()
                ? p.clientSalt.trim()
                : generateCSPRNGBlindingSalt();
            zkReceiptCommitment = createZKPrescriptionCommitment(
              serialNumber,
              rxRef,
              zkSaltIssued
            ).commitmentHash;
            const rawShares = splitSecretShamir(
              `RECALL_NOTIFY:${rxRef}|${hubIdOrLocation.slice(0, 16)}`,
              serialNumber
            );
            shamirRecallSharesIssued = sealShamirSharesECIES(
              rawShares,
              undefined,
              `SEAL:${serialNumber}:${nowIso}`
            );
          }

          nextState.packs = nextState.packs.map((pk) =>
            pk.serialNumber === serialNumber
              ? {
                  ...pk,
                  status: targetStatus,
                  currentCustodian: nextCustodian,
                  custodianRole: nextRole,
                  dispensedAt: targetStatus === 'DISPENSED' ? nowIso : pk.dispensedAt,
                  dispensedToReceipt:
                    targetStatus === 'DISPENSED' ? zkReceiptCommitment : pk.dispensedToReceipt,
                  shamirRecallShares:
                    targetStatus === 'DISPENSED'
                      ? shamirRecallSharesIssued
                      : pk.shamirRecallShares,
                  shamirShareCommitments:
                    targetStatus === 'DISPENSED' && shamirRecallSharesIssued
                      ? shamirRecallSharesIssued.map((s) => s.shareCommitment)
                      : pk.shamirShareCommitments,
                  lastScannedLocation: locationLabel,
                  lastScanLat: matchedHub ? matchedHub.coordinates[1] : pk.lastScanLat,
                  lastScanLon: matchedHub ? matchedHub.coordinates[0] : pk.lastScanLon,
                  lastScanTimestamp: nowIso,
                }
              : pk
          );

          if (matchedHub && parentBatch) {
            nextState.logisticsHubs = nextState.logisticsHubs.map((h) =>
              h.id === matchedHub.id && !h.activeBatches.includes(parentBatch.batchCode)
                ? { ...h, activeBatches: [...h.activeBatches, parentBatch.batchCode] }
                : h
            );

            if (previousHub && previousHub.id !== matchedHub.id) {
              const routeExists = nextState.transitCorridors.some(
                (c) =>
                  c.batchCode === parentBatch.batchCode &&
                  ((c.fromHubId === previousHub.id && c.toHubId === matchedHub.id) ||
                    (c.fromHubId === matchedHub.id && c.toHubId === previousHub.id))
              );
              if (!routeExists) {
                const distInfo = detectImpossibleGeographicJump(
                  previousHub.coordinates[1],
                  previousHub.coordinates[0],
                  matchedHub.coordinates[1],
                  matchedHub.coordinates[0],
                  600
                );
                const estHours = Math.max(Math.round((distInfo.distanceKm / 85) * 10) / 10, 2.0);
                nextState.transitCorridors = [
                  {
                    id: `route-xfer-${Date.now()}`,
                    batchCode: parentBatch.batchCode,
                    brandName: parentBatch.brandName,
                    fromHubId: previousHub.id,
                    toHubId: matchedHub.id,
                    fromCoordinates: previousHub.coordinates,
                    toCoordinates: matchedHub.coordinates,
                    distanceKm: Math.max(Math.round(distInfo.distanceKm), 80),
                    estimatedHours: estHours,
                    actualHours: estHours,
                    status: 'OPTIMAL',
                    carrierName: nextCustodian || 'Authorized Cold-Chain Carrier',
                    transportMode: distInfo.distanceKm > 1200 ? 'AIR_CARGO' : 'REEFER_TRUCK',
                    regionScope: matchedHub.region,
                    bottleneckDetail: `Live custody route opened for ${serialNumber} (${previousHub.iataCode || previousHub.cityState} → ${matchedHub.iataCode || matchedHub.cityState}).`,
                  },
                  ...nextState.transitCorridors,
                ];
              }
            }
          }

          const simulateBrokerDiversion = Boolean(p.simulateUnauthorizedBroker);
          nextState.custodyEvents = [
            ...(simulateBrokerDiversion
              ? [
                  {
                    id: `cust-brk-${Date.now()}`,
                    serialHash: targetPack.serialHash,
                    batchId: targetPack.batchId,
                    fromActor: nextCustodian,
                    toActor: 'GreyMarket Unlicensed Broker LLC',
                    action: 'UNAUTHORIZED_BROKER_DIVERSION',
                    location: locationLabel,
                    timestamp: nowIso,
                    notes: `ALERT: Unlicensed grey-market broker custody diversion detected at ${locationLabel} during ${actionName}`,
                    txHash: computeKeccakHex(`broker-divert:${serialNumber}:${Date.now()}`).slice(0, 66),
                  },
                ]
              : []),
            {
              id: `cust-${Date.now()}`,
              serialHash: targetPack.serialHash,
              batchId: targetPack.batchId,
              fromActor: targetPack.currentCustodian,
              toActor: nextCustodian,
              action: actionName,
              location: locationLabel,
              timestamp: nowIso,
              notes:
                targetStatus === 'DISPENSED' && zkReceiptCommitment
                  ? `${String(p.extraNotes || 'Dispensed to patient')} · ZK Commitment ${zkReceiptCommitment.slice(0, 14)}...`
                  : p.handoverTemp !== undefined && !Number.isNaN(Number(p.handoverTemp))
                  ? `${String(p.extraNotes || `Verified cryptographic custody handover (${actionName})`)} · Assigned Temp ${Number(p.handoverTemp).toFixed(1)}°C at ${locationLabel}`
                  : String(p.extraNotes || `Verified cryptographic custody handover (${actionName})`),
              txHash,
            },
            ...nextState.custodyEvents,
          ];

          if (simulateBrokerDiversion) {
            nextState.packs = nextState.packs.map((pk) =>
              pk.serialNumber === serialNumber ? { ...pk, isSuspicious: true } : pk
            );
          }

          if (p.handoverTemp !== undefined && parentBatch) {
            const parsedTemp = Number(p.handoverTemp);
            if (!Number.isNaN(parsedTemp)) {
              const evalResult = evaluateColdChainReading(
                parsedTemp,
                parentBatch.minTemp,
                parentBatch.maxTemp
              );
              const stageDeviceId =
                actionName === 'TRANSFER_DISTRIBUTOR'
                  ? 'DIST-REEFER-PROBE-02'
                  : actionName === 'TRANSFER_PHARMACY'
                  ? 'PHARM-VAULT-PROBE-04'
                  : 'HANDOVER-PROBE-04';
              const sealedProbe = sealTelemetryEventChain(
                {
                  id: `tel-${Date.now()}`,
                  batchId: parentBatch.batchId,
                  temperature: parsedTemp,
                  humidity: evalResult.isBreached ? 67.0 : 52.0,
                  latitude: matchedHub ? matchedHub.coordinates[1] : 42.3601,
                  longitude: matchedHub ? matchedHub.coordinates[0] : -71.0589,
                  locationLabel,
                  deviceId: stageDeviceId,
                  timestamp: nowIso,
                  isBreached: evalResult.isBreached,
                  breachType: evalResult.breachType,
                  txHash,
                  signerAddress: signerAddr,
                },
                nextState.telemetry
              );
              nextState.telemetry = [sealedProbe, ...nextState.telemetry];
              if (evalResult.isBreached) {
                sseEventName = 'excursion_alert';
                sseExtra = {
                  temperature: parsedTemp,
                  breachType: evalResult.breachType,
                  batchCode: parentBatch.batchCode,
                  minTemp: parentBatch.minTemp,
                  maxTemp: parentBatch.maxTemp,
                  blockHash: sealedProbe.blockHash,
                };
                nextState.custodyEvents = [
                  {
                    id: `cust-hbr-${Date.now()}`,
                    serialHash: targetPack.serialHash,
                    batchId: parentBatch.batchId,
                    fromActor: `${stageDeviceId} (${nextCustodian})`,
                    toActor: locationLabel,
                    action:
                      evalResult.breachType === 'SUBCOOLING'
                        ? 'COLD_CHAIN_SUBCOOLING_ALERT'
                        : 'COLD_CHAIN_OVERHEAT_ALERT',
                    location: locationLabel,
                    timestamp: nowIso,
                    notes: `Handover Cold-Chain Breach at ${locationLabel} (${nextCustodian}): ${parsedTemp.toFixed(1)}°C violated safe range ${parentBatch.minTemp}°C–${parentBatch.maxTemp}°C · Sealed on Block #${sealedProbe.blockIndex}`,
                    txHash: (sealedProbe.blockHash || txHash).slice(0, 66),
                  },
                  ...nextState.custodyEvents,
                ];
              }
            }
          }

          auditSummary = `${actionName} on ${serialNumber} → ${nextCustodian}`;
          const transferEvmRelay =
            targetStatus === 'DISPENSED' && shamirRecallSharesIssued
              ? await relayToEvmIfDeployed('commitShamirBreakGlassShares', [
                  targetPack.serialHash,
                  shamirRecallSharesIssued.map((s) => s.shareCommitment),
                ])
              : undefined;
          extraResult = {
            serialNumber,
            targetStatus,
            txHash,
            locationLabel,
            zkReceiptCommitment,
            zkSaltIssued,
            rxRef,
            ...(transferEvmRelay ? { evmRelay: transferEvmRelay } : {}),
          };
          break;
        }

        case 'commission-pallet': {
          assertRole('COMMISSION_PALLET');
          const batchId = String(p.batchId || '');
          const childSerials = Array.isArray(p.childSerials)
            ? p.childSerials.map((s) => String(s))
            : [];
          const sscc = String(p.sscc || `SSCC-00369${String(Date.now()).slice(-11)}`);
          const targetBatch = nextState.batches.find((b) => b.batchId === batchId);
          if (!targetBatch) throw new Error('Target batch not found for pallet commissioning.');
          if (targetBatch.isQuarantined || targetBatch.isRecalled) {
            throw new Error('Cannot commission pallet for quarantined or recalled batch.');
          }
          if (childSerials.length === 0) {
            throw new Error('Select at least 1 active pack serial to aggregate into a pallet.');
          }

          const eligiblePacks = nextState.packs.filter(
            (pk) =>
              childSerials.includes(pk.serialNumber) &&
              pk.batchId === batchId &&
              (pk.status === 'MANUFACTURED' || pk.status === 'IN_TRANSIT')
          );
          if (eligiblePacks.length !== childSerials.length) {
            throw new Error(
              'All selected child packs must belong to the same batch and not be dispensed/recalled.'
            );
          }

          const tree = buildBatchMerkleTree(eligiblePacks, targetBatch.expiresAt);
          const firstPack = eligiblePacks[0];
          const txHash = computeKeccakHex(`pallet:${sscc}:${Date.now()}`).slice(0, 66);

          const pallet: PalletContainerRecord = {
            id: `pallet-${Date.now()}`,
            sscc,
            batchId,
            batchCode: targetBatch.batchCode,
            childSerials,
            status: firstPack.status === 'IN_TRANSIT' ? 'IN_TRANSIT' : 'AGGREGATED',
            currentCustodian: firstPack.currentCustodian,
            custodianRole: firstPack.custodianRole,
            locationLabel: firstPack.lastScannedLocation || 'Kalamazoo Sterile Facility, MI',
            merkleRoot: tree.merkleRoot,
            createdAt: nowIso,
            txHash,
          };

          nextState.pallets = [pallet, ...nextState.pallets];
          nextState.custodyEvents = [
            {
              id: `cust-pal-${Date.now()}`,
              serialHash: computeKeccakHex(sscc),
              batchId,
              fromActor: pallet.currentCustodian,
              toActor: `SSCC Pallet ${sscc}`,
              action: 'COMMISSION_PALLET_SSCC',
              location: pallet.locationLabel,
              timestamp: nowIso,
              notes: `Aggregated ${childSerials.length} child pack(s) under Merkle Root ${tree.merkleRoot.slice(0, 12)}...`,
              txHash,
            },
            ...nextState.custodyEvents,
          ];
          auditSummary = `Commissioned Pallet ${sscc} (${childSerials.length} packs)`;
          extraResult = { pallet };
          break;
        }

        case 'transfer-pallet': {
          assertRole('TRANSFER_PALLET');
          const sscc = String(p.sscc || '');
          const nextCustodian = String(p.nextCustodian || '');
          const nextRole = String(p.nextRole || 'DISTRIBUTOR') as RoleType;
          const hubId = String(p.hubId || '');
          const pallet = nextState.pallets.find((pl) => pl.sscc === sscc);
          if (!pallet || pallet.status === 'UNPACKED') {
            throw new Error(`Pallet ${sscc} not active for atomic transfer.`);
          }
          const parentBatch = nextState.batches.find((b) => b.batchId === pallet.batchId);
          if (parentBatch?.isQuarantined || parentBatch?.isRecalled) {
            throw new Error(`Pallet ${sscc} halted: parent batch is quarantined or recalled.`);
          }

          const hub = nextState.logisticsHubs.find((h) => h.id === hubId);
          const locationLabel = hub ? `${hub.name}, ${hub.cityState}` : pallet.locationLabel;
          const nextPackStatus: MedicinePackRecord['status'] =
            nextRole === 'PHARMACY' ? 'AT_PHARMACY' : 'IN_TRANSIT';
          const nextPalletStatus: PalletContainerRecord['status'] =
            nextRole === 'PHARMACY' ? 'AT_PHARMACY' : 'IN_TRANSIT';
          const txHash = computeKeccakHex(`pal-xfer:${sscc}:${Date.now()}`).slice(0, 66);

          nextState.pallets = nextState.pallets.map((pl) =>
            pl.sscc === sscc
              ? {
                  ...pl,
                  status: nextPalletStatus,
                  currentCustodian: nextCustodian,
                  custodianRole: nextRole,
                  locationLabel,
                }
              : pl
          );

          nextState.packs = nextState.packs.map((pk) =>
            pallet.childSerials.includes(pk.serialNumber)
              ? {
                  ...pk,
                  status: nextPackStatus,
                  currentCustodian: nextCustodian,
                  custodianRole: nextRole,
                  lastScannedLocation: locationLabel,
                  lastScanLat: hub ? hub.coordinates[1] : pk.lastScanLat,
                  lastScanLon: hub ? hub.coordinates[0] : pk.lastScanLon,
                }
              : pk
          );

          nextState.custodyEvents = [
            {
              id: `cust-palx-${Date.now()}`,
              serialHash: computeKeccakHex(sscc),
              batchId: pallet.batchId,
              fromActor: pallet.currentCustodian,
              toActor: nextCustodian,
              action: 'ATOMIC_PALLET_TRANSFER',
              location: locationLabel,
              timestamp: nowIso,
              notes: `Transferred SSCC Pallet ${sscc} + ${pallet.childSerials.length} child pack(s) atomically`,
              txHash,
            },
            ...nextState.custodyEvents,
          ];
          auditSummary = `Atomic Pallet Transfer ${sscc} (${pallet.childSerials.length} packs) → ${nextCustodian}`;
          break;
        }

        case 'deaggregate-pallet': {
          assertRole('DEAGGREGATE_PALLET');
          const sscc = String(p.sscc || '');
          const pallet = nextState.pallets.find((pl) => pl.sscc === sscc);
          if (!pallet) throw new Error(`Pallet ${sscc} not found.`);
          const txHash = computeKeccakHex(`pal-unpack:${sscc}:${Date.now()}`).slice(0, 66);
          nextState.pallets = nextState.pallets.map((pl) =>
            pl.sscc === sscc ? { ...pl, status: 'UNPACKED' } : pl
          );
          nextState.custodyEvents = [
            {
              id: `cust-palu-${Date.now()}`,
              serialHash: computeKeccakHex(sscc),
              batchId: pallet.batchId,
              fromActor: pallet.currentCustodian,
              toActor: pallet.currentCustodian,
              action: 'DEAGGREGATE_PALLET_SSCC',
              location: pallet.locationLabel,
              timestamp: nowIso,
              notes: `Unpacked SSCC Pallet ${sscc} releasing ${pallet.childSerials.length} individual packs for dispensing`,
              txHash,
            },
            ...nextState.custodyEvents,
          ];
          auditSummary = `De-aggregated SSCC Pallet ${sscc}`;
          break;
        }

        case 'telemetry': {
          assertRole('INGEST_TELEMETRY');
          const batchId = String(p.batchId || '');
          const tempVal = Number(p.temperature);
          const hubId = String(p.hubId || 'hub-newark');
          const batch = nextState.batches.find((b) => b.batchId === batchId);
          if (!batch) throw new Error('Target batch not found.');
          if (Number.isNaN(tempVal)) throw new Error('Invalid temperature reading.');

          const targetHub =
            nextState.logisticsHubs.find((h) => h.id === hubId) || nextState.logisticsHubs[0];
          const evaluation = evaluateColdChainReading(tempVal, batch.minTemp, batch.maxTemp);
          const humidityVal = evaluation.isBreached ? 68.5 : 54.0;
          const locationStr = String(p.location || `${targetHub.name}, ${targetHub.cityState}`);
          const deviceIdStr = String(p.deviceId || 'IOT-DHT22-901');

          const evmTelRelay = await relayColdChainTelemetryIfDeployed({
            batchId: batch.batchId,
            temperature: tempVal,
            humidity: humidityVal,
            latitude: targetHub.coordinates[1],
            longitude: targetHub.coordinates[0],
            timestampIso: nowIso,
            deviceId: deviceIdStr,
          });

          const sealedTelemetry = sealTelemetryEventChain(
            {
              id: `tel-${Date.now()}`,
              batchId: batch.batchId,
              temperature: tempVal,
              humidity: humidityVal,
              latitude: targetHub.coordinates[1],
              longitude: targetHub.coordinates[0],
              locationLabel: locationStr,
              deviceId: deviceIdStr,
              timestamp: nowIso,
              isBreached: evaluation.isBreached,
              breachType: evaluation.breachType,
              signerAddress: signerAddr,
              ...(evmTelRelay.evmAnchored && evmTelRelay.txHash
                ? { evmTxHash: evmTelRelay.txHash }
                : {}),
            },
            nextState.telemetry
          );

          nextState.telemetry = [sealedTelemetry, ...nextState.telemetry];

          nextState.logisticsHubs = nextState.logisticsHubs.map((h) =>
            h.id === targetHub.id
              ? {
                  ...h,
                  avgTempC: tempVal,
                  excursionCount: evaluation.isBreached ? h.excursionCount + 1 : h.excursionCount,
                  dwellHours: evaluation.isBreached
                    ? Math.max(h.dwellHours, h.maxSafeDwellHours + 6)
                    : h.dwellHours,
                  bottleneckReason: evaluation.isBreached
                    ? `Cold-chain ${evaluation.breachType === 'SUBCOOLING' ? 'subcooling freeze' : 'overheating'} excursion (${tempVal.toFixed(1)}°C) recorded on ${batch.batchCode} at ${targetHub.name}`
                    : h.bottleneckReason,
                }
              : h
          );

          if (evaluation.isBreached) {
            sseEventName = 'excursion_alert';
            sseExtra = {
              temperature: tempVal,
              breachType: evaluation.breachType,
              batchCode: batch.batchCode,
              minTemp: batch.minTemp,
              maxTemp: batch.maxTemp,
              blockHash: sealedTelemetry.blockHash,
            };
            nextState.transitCorridors = nextState.transitCorridors.map((c) =>
              c.batchCode === batch.batchCode || c.toHubId === targetHub.id
                ? {
                    ...c,
                    status: 'CRITICAL_BOTTLENECK',
                    actualHours: Math.max(c.actualHours, c.estimatedHours + 8),
                    bottleneckDetail: `CRITICAL ${evaluation.breachType === 'SUBCOOLING' ? 'FREEZE' : 'HEAT'} BREACH: ${tempVal.toFixed(1)}°C recorded at ${targetHub.cityState} (Safe: ${batch.minTemp}°C–${batch.maxTemp}°C).`,
                  }
                : c
            );
            nextState.custodyEvents = [
              {
                id: `cust-temp-${Date.now()}`,
                serialHash: sealedTelemetry.blockHash || batch.batchId,
                batchId: batch.batchId,
                fromActor: `${deviceIdStr} (Signed Sensor)`,
                toActor: targetHub.name,
                action:
                  evaluation.breachType === 'SUBCOOLING'
                    ? 'COLD_CHAIN_SUBCOOLING_ALERT'
                    : 'COLD_CHAIN_OVERHEAT_ALERT',
                location: locationStr,
                timestamp: nowIso,
                notes: `Immutable Telemetry Block #${sealedTelemetry.blockIndex}: ${tempVal.toFixed(1)}°C breached safe limit (${batch.minTemp}°C–${batch.maxTemp}°C)`,
                txHash: (sealedTelemetry.blockHash || batch.batchId).slice(0, 66),
              },
              ...nextState.custodyEvents,
            ];
          }

          auditSummary = `Telemetry #${sealedTelemetry.blockIndex} ${tempVal.toFixed(1)}°C (${evaluation.isBreached ? evaluation.breachType : 'SAFE'}) for ${batch.batchCode}`;
          extraResult = { evaluation, telemetryBlock: sealedTelemetry, evmRelay: evmTelRelay };
          break;
        }

        case 'quarantine': {
          assertRole('QUARANTINE_BATCH');
          const batchId = String(p.batchId || '');
          const quarantineState = Boolean(p.quarantineState);
          const reason = String(p.reason || 'Regulatory safety hold');
          const targetBatch = nextState.batches.find((b) => b.batchId === batchId);
          if (!targetBatch) throw new Error('Target batch not found.');
          if (targetBatch.isRecalled) {
            throw new Error(
              `BatchAlreadyRecalled: ${targetBatch.batchCode} is under permanent Class I Multi-Sig Recall and cannot be modified.`
            );
          }

          nextState.batches = nextState.batches.map((b) =>
            b.batchId === batchId
              ? {
                  ...b,
                  isQuarantined: quarantineState,
                  quarantineReason: quarantineState ? reason : undefined,
                }
              : b
          );
          nextState.packs = nextState.packs.map((pk) => {
            if (pk.batchId !== batchId) return pk;
            if (
              pk.status === 'DISPENSED' ||
              pk.status === 'RECALLED' ||
              pk.status === 'RETURNED_FOR_DESTRUCTION' ||
              pk.status === 'DESTROYED_WITNESSED'
            ) {
              return pk;
            }
            const restoredStatus =
              pk.custodianRole === 'MANUFACTURER'
                ? 'MANUFACTURED'
                : pk.custodianRole === 'DISTRIBUTOR'
                ? 'IN_TRANSIT'
                : 'AT_PHARMACY';
            return {
              ...pk,
              status: quarantineState ? 'QUARANTINED' : restoredStatus,
              isSuspicious: quarantineState ? true : false,
            };
          });
          nextState.transitCorridors = nextState.transitCorridors.map((c) =>
            c.batchCode === targetBatch.batchCode
              ? {
                  ...c,
                  status: quarantineState ? 'CRITICAL_BOTTLENECK' : 'OPTIMAL',
                  bottleneckDetail: quarantineState
                    ? `REGULATORY QUARANTINE: ${reason}`
                    : 'Quarantine lifted by Regulator; corridor cleared for transit.',
                }
              : c
          );
          nextState.custodyEvents = [
            {
              id: `cust-gov-${Date.now()}`,
              serialHash: targetBatch.batchId,
              batchId: targetBatch.batchId,
              fromActor: `${signerAddr.slice(0, 10)}...`,
              toActor: targetBatch.batchCode,
              action: quarantineState ? 'REGULATOR_QUARANTINE' : 'LIFT_QUARANTINE',
              location: 'Washington, DC · Regulatory Governance',
              timestamp: nowIso,
              notes: quarantineState
                ? reason
                : `Quarantine lifted for batch ${targetBatch.batchCode}`,
              txHash: computeKeccakHex(`gov:${batchId}:${quarantineState}:${Date.now()}`).slice(
                0,
                66
              ),
            },
            ...nextState.custodyEvents,
          ];
          auditSummary = `${quarantineState ? 'Quarantined' : 'Lifted quarantine on'} ${targetBatch.batchCode}`;
          break;
        }

        case 'recall-propose': {
          assertRole('PROPOSE_RECALL');
          const batchId = String(p.batchId || '');
          const reason = String(
            p.reason || 'Mandatory Class I FDA Recall: Thermal degradation & sterility risk'
          );
          const targetBatch = nextState.batches.find((b) => b.batchId === batchId);
          if (!targetBatch) throw new Error('Target batch not found.');
          if (
            nextState.recallProposals.some((rp) => rp.batchId === batchId && !rp.executed)
          ) {
            throw new Error(
              `An active 2-of-2 recall proposal already exists for ${targetBatch.batchCode}. Switch to a second Regulator signer to co-sign.`
            );
          }

          const proposal: RecallProposalRecord = {
            id: `prop-${Date.now()}`,
            batchId: targetBatch.batchId,
            batchCode: targetBatch.batchCode,
            brandName: targetBatch.brandName,
            severity: 'CLASS_I',
            reason,
            proposerAddress: signerAddr,
            approvals: [signerAddr],
            requiredApprovals: 2,
            executed: false,
            createdAt: nowIso,
          };
          nextState.recallProposals = [proposal, ...nextState.recallProposals];
          nextState.custodyEvents = [
            {
              id: `cust-prop-${Date.now()}`,
              serialHash: targetBatch.batchId,
              batchId: targetBatch.batchId,
              fromActor: `${signerAddr.slice(0, 10)}...`,
              toActor: 'RegulatorGovernance.sol (2-of-2 Multi-Sig)',
              action: 'PROPOSE_CLASS_I_RECALL',
              location: 'Washington, DC · Multi-Sig Queue',
              timestamp: nowIso,
              notes: `Recall proposal ${proposal.id} opened (1/2 signatures): ${reason}`,
              txHash: computeKeccakHex(`propose:${proposal.id}`).slice(0, 66),
            },
            ...nextState.custodyEvents,
          ];
          auditSummary = `Proposed 2-of-2 Class I Recall for ${targetBatch.batchCode}`;
          extraResult = { proposal };
          break;
        }

        case 'recall-approve': {
          assertRole('PROPOSE_RECALL');
          const proposalId = String(p.proposalId || '');
          const targetProposal = nextState.recallProposals.find((rp) => rp.id === proposalId);
          if (!targetProposal || targetProposal.executed) {
            throw new Error('Active recall proposal not found or already executed.');
          }
          if (
            targetProposal.approvals.some((a) => a.toLowerCase() === signerAddr.toLowerCase())
          ) {
            throw new Error(
              `Multi-Sig Guard: Signer (${signerAddr.slice(0, 8)}...) already signed this proposal. Switch to Regulator Co-Signer #2 via the top-right wallet button.`
            );
          }

          const nextApprovals = [...targetProposal.approvals, signerAddr];
          const quorumReached = nextApprovals.length >= targetProposal.requiredApprovals;

          nextState.recallProposals = nextState.recallProposals.map((rp) =>
            rp.id === proposalId
              ? { ...rp, approvals: nextApprovals, executed: quorumReached }
              : rp
          );

          if (quorumReached) {
            sseEventName = 'recall_executed';
            const targetBatch = nextState.batches.find(
              (b) => b.batchId === targetProposal.batchId
            );
            nextState.batches = nextState.batches.map((b) =>
              b.batchId === targetProposal.batchId
                ? {
                    ...b,
                    isRecalled: true,
                    isQuarantined: true,
                    quarantineReason: targetProposal.reason,
                  }
                : b
            );
            nextState.packs = nextState.packs.map((pk) =>
              pk.batchId === targetProposal.batchId && pk.status !== 'DISPENSED'
                ? { ...pk, status: 'RECALLED', isSuspicious: true }
                : pk
            );
            if (targetBatch) {
              nextState.transitCorridors = nextState.transitCorridors.map((c) =>
                c.batchCode === targetBatch.batchCode
                  ? {
                      ...c,
                      status: 'CRITICAL_BOTTLENECK',
                      bottleneckDetail:
                        'CLASS I FDA RECALL: All transit and dispensing halted immediately.',
                    }
                  : c
              );
            }
            nextState.custodyEvents = [
              {
                id: `cust-recall-${Date.now()}`,
                serialHash: targetProposal.batchId,
                batchId: targetProposal.batchId,
                fromActor: '2-of-2 Regulator Multi-Sig Consensus',
                toActor: targetProposal.batchCode,
                action: 'CLASS_I_RECALL_EXECUTED',
                location: 'National Enforcement Registry',
                timestamp: nowIso,
                notes: `2-of-2 Multi-Sig Class I Recall executed for ${targetProposal.batchCode}: ${targetProposal.reason}`,
                txHash: computeKeccakHex(`recall:${targetProposal.batchId}:${Date.now()}`).slice(
                  0,
                  66
                ),
              },
              ...nextState.custodyEvents,
            ];
          }
          auditSummary = `2-of-2 Co-signed & executed Class I Recall on ${targetProposal.batchCode}`;
          extraResult = { quorumReached, batchCode: targetProposal.batchCode };
          break;
        }

        case 'witness-destruction': {
          assertRole('WITNESS_DESTRUCTION');
          const batchId = String(p.batchId || '');
          const targetBatch = nextState.batches.find((b) => b.batchId === batchId);
          if (!targetBatch || !targetBatch.isRecalled) {
            throw new Error('Witnessed destruction only applies to Class I Recalled batches.');
          }
          let transitioned = 0;
          nextState.packs = nextState.packs.map((pk) => {
            if (
              pk.batchId === batchId &&
              pk.status !== 'DISPENSED' &&
              pk.status !== 'DESTROYED_WITNESSED'
            ) {
              transitioned++;
              return {
                ...pk,
                status: 'DESTROYED_WITNESSED',
                currentCustodian: 'FDA Witnessed Incineration Facility',
              };
            }
            return pk;
          });
          if (transitioned === 0) {
            throw new Error('All un-dispensed recalled packs have already been destroyed.');
          }
          nextState.custodyEvents = [
            {
              id: `cust-dest-${Date.now()}`,
              serialHash: batchId,
              batchId,
              fromActor: 'Regulator Destruction Inspector',
              toActor: 'FDA Witnessed Incineration Facility',
              action: 'WITNESSED_BATCH_DESTRUCTION',
              location: 'Certified Medical Incineration Vault',
              timestamp: nowIso,
              notes: `Witnessed & recorded permanent destruction of ${transitioned} recalled pack(s) from ${targetBatch.batchCode}`,
              txHash: computeKeccakHex(`destroy:${batchId}:${Date.now()}`).slice(0, 66),
            },
            ...nextState.custodyEvents,
          ];
          auditSummary = `Witnessed destruction of ${transitioned} recalled packs for ${targetBatch.batchCode}`;
          extraResult = { transitioned };
          break;
        }

        case 'anchor-merkle': {
          assertRole('ANCHOR_MERKLE_ROOT');
          const batchId = String(p.batchId || '');
          const merkleRoot = String(p.merkleRoot || '');
          const targetBatch = nextState.batches.find((b) => b.batchId === batchId);
          if (!targetBatch) throw new Error('Batch not found.');
          nextState.batches = nextState.batches.map((b) =>
            b.batchId === batchId
              ? { ...b, anchoredMerkleRoot: merkleRoot, merkleAnchoredAt: nowIso }
              : b
          );
          nextState.custodyEvents = [
            {
              id: `cust-merkle-${Date.now()}`,
              serialHash: merkleRoot,
              batchId,
              fromActor: targetBatch.manufacturerName,
              toActor: 'MedSupplySentinel.sol (Merkle Root Registry)',
              action: 'ANCHOR_MERKLE_ROOT',
              location: 'Anvil EVM Chain ID 31337',
              timestamp: nowIso,
              notes: `Anchored O(log N) Merkle Root ${merkleRoot.slice(0, 14)}... for ${targetBatch.batchCode}`,
              txHash: computeKeccakHex(`merkle:${batchId}:${merkleRoot}:${Date.now()}`).slice(
                0,
                66
              ),
            },
            ...nextState.custodyEvents,
          ];
          auditSummary = `Anchored Merkle Root for ${targetBatch.batchCode}`;
          const merkleRelay = await relayToEvmIfDeployed('anchorBatchMerkleRoot', [
            batchId,
            merkleRoot,
          ]);
          extraResult = { evmRelay: merkleRelay };
          break;
        }

        case 'participant-register': {
          assertRole('MANAGE_PARTICIPANTS');
          const orgName = String(p.organizationName || '').trim();
          const licenseNumber = String(p.licenseNumber || '').trim().toUpperCase();
          const newRole = String(p.role || 'DISTRIBUTOR') as RoleType;
          const region = String(p.region || 'US National Logistics Network').trim();
          if (!orgName || !licenseNumber) {
            throw new Error('Organization name and regulatory license ID are required.');
          }
          const wallet =
            typeof p.walletAddress === 'string' && p.walletAddress.trim()
              ? p.walletAddress.trim()
              : computeKeccakHex(`wallet:${orgName}:${Date.now()}`).slice(0, 42);
          const created: ParticipantEntity = {
            id: `part-${Date.now()}`,
            organizationName: orgName,
            role: newRole,
            walletAddress: wallet,
            licenseNumber,
            region,
            isAuthorized: true,
            registeredAt: nowIso.slice(0, 10),
          };
          nextState.participants = [created, ...nextState.participants];
          auditSummary = `Granted ${newRole}_ROLE to ${orgName}`;
          extraResult = { created };
          break;
        }

        case 'participant-toggle': {
          assertRole('MANAGE_PARTICIPANTS');
          const id = String(p.id || '');
          nextState.participants = nextState.participants.map((pt) =>
            pt.id === id ? { ...pt, isAuthorized: !pt.isAuthorized } : pt
          );
          auditSummary = `Toggled authorization on participant ${id}`;
          break;
        }

        case 'adverse-report': {
          const serialNumber = String(p.serialNumber || 'UNKNOWN');
          const batchCode = String(p.batchCode || 'UNREGISTERED');
          const issueCategory = String(
            p.issueCategory || 'SUSPECTED_FAKE_LABEL'
          ) as PatientAdverseReport['issueCategory'];
          const newReport: PatientAdverseReport = {
            id: `rep-${Date.now()}`,
            serialNumber,
            batchCode,
            reporterType: 'PATIENT',
            issueCategory,
            locationCity: String(p.locationCity || 'Anonymous Patient Submission'),
            notes: String(p.notes || 'Flagged during mobile QR verification'),
            timestamp: nowIso,
            status: 'ESCALATED_TO_REGULATOR',
          };
          nextState.adverseReports = [newReport, ...nextState.adverseReports];
          nextState.packs = nextState.packs.map((pk) =>
            pk.serialNumber === serialNumber
              ? {
                  ...pk,
                  isSuspicious: true,
                  suspicionReason: `Patient reported ${issueCategory.replace(/_/g, ' ')}`,
                }
              : pk
          );
          auditSummary = `Escalated patient field report for ${serialNumber}`;
          extraResult = { newReport };
          break;
        }

        case 'corridor-reroute': {
          assertRole('OPERATE_LOGISTICS');
          const corridorId = String(p.corridorId || '');
          const targetCorridor = nextState.transitCorridors.find((c) => c.id === corridorId);
          nextState.transitCorridors = nextState.transitCorridors.map((c) =>
            c.id === corridorId
              ? {
                  ...c,
                  status: 'OPTIMAL',
                  actualHours: c.estimatedHours,
                  bottleneckDetail: 'Rerouted via priority express cold-chain lane; SLA restored.',
                }
              : c
          );
          if (targetCorridor) {
            nextState.custodyEvents = [
              {
                id: `cust-reroute-${Date.now()}`,
                serialHash: computeKeccakHex(targetCorridor.batchCode),
                batchId: computeKeccakHex(targetCorridor.batchCode),
                fromActor: targetCorridor.carrierName,
                toActor: 'Express Cold-Chain Priority Lane',
                action: 'CORRIDOR_REROUTE',
                location: `Corridor ${targetCorridor.batchCode}`,
                timestamp: nowIso,
                notes: `Rerouted ${targetCorridor.batchCode} to restore ${targetCorridor.estimatedHours}h SLA`,
                txHash: computeKeccakHex(`reroute:${corridorId}:${Date.now()}`).slice(0, 66),
              },
              ...nextState.custodyEvents,
            ];
          }
          auditSummary = `Rerouted transit corridor ${corridorId}`;
          break;
        }

        case 'hub-resolve': {
          assertRole('OPERATE_LOGISTICS');
          const hubId = String(p.hubId || '');
          const targetHub = nextState.logisticsHubs.find((h) => h.id === hubId);
          nextState.logisticsHubs = nextState.logisticsHubs.map((h) =>
            h.id === hubId
              ? {
                  ...h,
                  dwellHours: Math.min(h.dwellHours, h.maxSafeDwellHours - 2),
                  excursionCount: 0,
                  avgTempC: 4.5,
                  throughputCapacityPct: 60,
                  bottleneckReason: 'Auxiliary reefer dispatched & cross-dock backlog cleared.',
                }
              : h
          );
          nextState.transitCorridors = nextState.transitCorridors.map((c) =>
            c.toHubId === hubId || c.fromHubId === hubId
              ? {
                  ...c,
                  status: 'OPTIMAL',
                  actualHours: c.estimatedHours,
                  bottleneckDetail: `Auxiliary reefer unit resolved bottleneck at ${targetHub?.cityState || 'hub'}.`,
                }
              : c
          );
          if (targetHub) {
            nextState.custodyEvents = [
              {
                id: `cust-hub-${Date.now()}`,
                serialHash: computeKeccakHex(targetHub.id),
                batchId: computeKeccakHex(targetHub.activeBatches[0] || 'BATCH-PCV-2026'),
                fromActor: 'Logistics Operations Command',
                toActor: targetHub.name,
                action: 'RESOLVE_HUB_BOTTLENECK',
                location: targetHub.cityState,
                timestamp: nowIso,
                notes: `Dispatched auxiliary reefer & cleared dock backlog at ${targetHub.name}`,
                txHash: computeKeccakHex(`hub:${hubId}:${Date.now()}`).slice(0, 66),
              },
              ...nextState.custodyEvents,
            ];
          }
          auditSummary = `Resolved cold-chain hub bottleneck ${targetHub?.name || hubId}`;
          break;
        }

        case 'break-glass-shamir': {
          assertRole('BREAK_GLASS_SHAMIR');
          const serialNumber = String(p.serialNumber || '');
          const shareIndices = Array.isArray(p.shareIndices)
            ? p.shareIndices.map((n) => Number(n))
            : [];
          const targetPack = nextState.packs.find((pk) => pk.serialNumber === serialNumber);
          if (!targetPack) throw new Error(`Pack ${serialNumber} not found.`);

          const anchoredCommitments =
            targetPack.shamirShareCommitments && targetPack.shamirShareCommitments.length > 0
              ? targetPack.shamirShareCommitments
              : (targetPack.shamirRecallShares || []).map((s) => s.shareCommitment);

          const submittedUnsealed = Array.isArray(p.unsealedShares)
            ? (p.unsealedShares as ShamirShareRecord[])
            : [];

          let candidateShares: ShamirShareRecord[];
          if (submittedUnsealed.length > 0) {
            // Cryptographically verify submitted unsealed ECIES custodian shares against anchored commitments
            for (const sub of submittedUnsealed) {
              if (!Array.isArray(sub.yChunksHex) || sub.yChunksHex.length === 0) {
                throw new Error(
                  `ShamirSharesSealedECIES: Custodian share #${sub.index} has empty yChunksHex.`
                );
              }
              const recomputedCommit = computeKeccakHex(
                `SHAMIR_COMMIT_V1:${targetPack.serialNumber}:${sub.index}:${sub.yChunksHex.join('|')}`
              );
              const matchedCommit = anchoredCommitments.some(
                (c) => c.toLowerCase() === recomputedCommit.toLowerCase()
              );
              if (!matchedCommit) {
                throw new Error(
                  `ShamirShareCommitmentMismatch: Unsealed share #${sub.index} does not match anchored on-chain share commitment.`
                );
              }
            }
            candidateShares = submittedUnsealed.filter((s) =>
              shareIndices.length > 0 ? shareIndices.includes(s.index) : true
            );
          } else {
            const shares = targetPack.shamirRecallShares || [];
            candidateShares = shares.filter((s) => shareIndices.includes(s.index));
          }

          const recon = reconstructSecretShamir(candidateShares, 2);
          if (!recon.ok) {
            throw new Error(recon.error || 'Shamir threshold reconstruction failed.');
          }
          const txHash = computeKeccakHex(
            `shamir:${serialNumber}:${shareIndices.join(',')}:${Date.now()}`
          ).slice(0, 66);

          nextState.custodyEvents = [
            {
              id: `cust-shamir-${Date.now()}`,
              serialHash: targetPack.serialHash,
              batchId: targetPack.batchId,
              fromActor: 'Shamir 2-of-3 ECIES Quorum Vault',
              toActor: 'FDA Break-Glass Recall Alert',
              action: 'SHAMIR_BREAK_GLASS_AUDIT',
              location: 'Regulator Threshold Reconstruction Engine',
              timestamp: nowIso,
              notes: `Reconstructed GF(2^127-1) recall pointer using ${recon.sharesUsed}-of-3 decrypted ECIES shares for ${serialNumber}`,
              txHash,
            },
            ...nextState.custodyEvents,
          ];
          const shamirRelay = await relayToEvmIfDeployed('recordBreakGlassReconstruction', [
            targetPack.serialHash,
            recon.sharesUsed,
          ]);
          auditSummary = `Shamir 2-of-3 Break-Glass audited on ${serialNumber}`;
          extraResult = { reconstruction: recon, evmRelay: shamirRelay };
          break;
        }

        case 'ledger-reset': {
          assertRole('LEDGER_RESET');
          const freshSeed = store.resetToSeedState();
          store.markNonceUsed(envelope.nonce);
          ledgerState = freshSeed;
          broadcastSSE('ledger_updated', {
            reason: 'LEDGER_RESET',
            version: ledgerState.version,
            summary: 'Regulator reset persistent ledger to factory seed state',
          });
          return res.json({
            ok: true,
            state: ledgerState,
            auditEntry: {
              id: `audit-${Date.now()}`,
              version: ledgerState.version,
              action: actionParam,
              signerAddress: signerAddr,
              signerRole: role,
              nonce: envelope.nonce,
              eip712Signature: envelope.signature,
              summary: 'Reset persistent ledger to factory seed state',
              timestamp: nowIso,
            },
          });
        }

        default:
          throw new Error(`Unsupported command action: ${actionParam}`);
      }

      const nextAuditEntry: CommandAuditRecord = {
        id: `audit-${Date.now()}`,
        version: ledgerState.version + 1,
        action: actionParam,
        signerAddress: signerAddr,
        signerRole: role,
        nonce: envelope.nonce,
        eip712Signature: envelope.signature,
        summary: auditSummary,
        timestamp: nowIso,
      };
      nextState.auditLog = [nextAuditEntry, ...nextState.auditLog].slice(0, 100);

      ledgerState = store.commitIncrementalState(ledgerState, nextState, envelope.nonce);

      broadcastSSE(sseEventName, {
        reason: actionParam,
        version: ledgerState.version,
        summary: auditSummary,
        ...sseExtra,
      });

      return res.json({
        ok: true,
        state: ledgerState,
        auditEntry: nextAuditEntry,
        ...extraResult,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('AccessControl') || msg.includes('Multi-Sig Guard') ? 403 : 400;
      return res.status(status).json({ ok: false, error: msg });
    }
  });

  // Hardware-Signed ECDSA IoT Telemetry Endpoint (matches ColdChainOracle.recordSignedTelemetry)
  app.post('/api/iot/signed-telemetry', async (req, res) => {
    try {
      const body = req.body as {
        batchId: string;
        temperature: number;
        humidity?: number;
        latitude?: number;
        longitude?: number;
        timestamp?: string;
        deviceId: string;
        hubId?: string;
        signature: string;
      };

      const timestamp = body.timestamp || new Date().toISOString();
      const humidity = typeof body.humidity === 'number' ? body.humidity : 54.0;
      const hub =
        ledgerState.logisticsHubs.find((h) => h.id === body.hubId) || ledgerState.logisticsHubs[3];
      const latitude = typeof body.latitude === 'number' ? body.latitude : hub.coordinates[1];
      const longitude = typeof body.longitude === 'number' ? body.longitude : hub.coordinates[0];

      const check = await verifySignedTelemetryECDSA(
        {
          batchId: body.batchId,
          temperature: body.temperature,
          humidity,
          latitude,
          longitude,
          timestamp,
          deviceId: body.deviceId,
          signature: body.signature,
        },
        AUTHORIZED_IOT_GATEWAYS
      );

      if (!check.isValid) {
        return res.status(403).json({
          ok: false,
          error: `InvalidOracleSignature: Recovered ${check.recoveredAddress || 'none'} is not an authorized IoT sensor gateway.`,
        });
      }

      if (store.isNonceUsed(check.readingHash)) {
        return res.status(409).json({
          ok: false,
          error: `ReplayReadingDetected: Hardware packet hash ${check.readingHash.slice(0, 14)}... already recorded on ColdChainOracle.`,
        });
      }

      const batch = ledgerState.batches.find((b) => b.batchId === body.batchId);
      if (!batch) {
        return res.status(404).json({ ok: false, error: 'Target batch not found.' });
      }

      const evaluation = evaluateColdChainReading(body.temperature, batch.minTemp, batch.maxTemp);
      const nextState = structuredClone(ledgerState);

      const newTel = sealTelemetryEventChain(
        {
          id: `tel-hw-${Date.now()}`,
          batchId: batch.batchId,
          temperature: body.temperature,
          humidity,
          latitude,
          longitude,
          locationLabel: `${hub.name}, ${hub.cityState} (HW ECDSA Verified)`,
          deviceId: body.deviceId,
          timestamp,
          isBreached: evaluation.isBreached,
          breachType: evaluation.breachType,
          txHash: check.readingHash.slice(0, 66),
          signerAddress: check.recoveredAddress,
        },
        nextState.telemetry
      );

      nextState.telemetry = [newTel, ...nextState.telemetry];
      nextState.logisticsHubs = nextState.logisticsHubs.map((h) =>
        h.id === hub.id
          ? {
              ...h,
              avgTempC: body.temperature,
              excursionCount: evaluation.isBreached ? h.excursionCount + 1 : h.excursionCount,
              dwellHours: evaluation.isBreached
                ? Math.max(h.dwellHours, h.maxSafeDwellHours + 6)
                : h.dwellHours,
              bottleneckReason: evaluation.isBreached
                ? `Hardware IoT Excursion (${body.temperature.toFixed(1)}°C) verified via ECDSA (${check.recoveredAddress?.slice(0, 8)}...)`
                : h.bottleneckReason,
            }
          : h
      );
      if (evaluation.isBreached) {
        nextState.transitCorridors = nextState.transitCorridors.map((c) =>
          c.batchCode === batch.batchCode || c.toHubId === hub.id
            ? {
                ...c,
                status: 'CRITICAL_BOTTLENECK',
                actualHours: Math.max(c.actualHours, c.estimatedHours + 8),
                bottleneckDetail: `HARDWARE ECDSA EXCURSION: ${body.temperature.toFixed(1)}°C at ${hub.cityState}.`,
              }
            : c
        );
      }

      ledgerState = store.commitIncrementalState(ledgerState, nextState, check.readingHash);

      broadcastSSE(evaluation.isBreached ? 'excursion_alert' : 'ledger_updated', {
        reason: 'HARDWARE_SIGNED_TELEMETRY',
        version: ledgerState.version,
        deviceId: body.deviceId,
        temperature: body.temperature,
        breachType: evaluation.breachType,
        batchCode: batch.batchCode,
        minTemp: batch.minTemp,
        maxTemp: batch.maxTemp,
        blockHash: newTel.blockHash,
      });

      return res.json({
        ok: true,
        verifiedSensorAddress: check.recoveredAddress,
        readingHash: check.readingHash,
        telemetryBlock: newTel,
        evaluation,
        state: ledgerState,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Direct REST QR Verification Endpoint (Rate-Limited + ECDSA Public Recovery + Python ML Sidecar Bridge)
  app.post('/api/verify', async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rl = checkVerifyRateLimit(clientIp);
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      return res.status(429).json({
        error: 'RateLimitExceeded: Too many QR verification queries. Please retry in 60s.',
      });
    }

    try {
      const { rawInput, scanLat, scanLon, scanLocation, elapsedMinutes, scannedPufHex } = req.body as {
        rawInput: string;
        scanLat?: number;
        scanLon?: number;
        scanLocation?: string;
        elapsedMinutes?: number;
        scannedPufHex?: string;
      };

      const parsed = parseQRScanInput(rawInput || '');
      const pack = ledgerState.packs.find(
        (p) => p.serialNumber.toLowerCase() === parsed.serialNumber.toLowerCase()
      );
      const batch = pack
        ? ledgerState.batches.find((b) => b.batchId === pack.batchId)
        : undefined;

      let signatureTampered = false;
      let signatureMethod: 'ECDSA_SECP256K1' | 'LEGACY_ATTESTATION' | 'NONE' = 'NONE';
      let impossibleJump = false;
      let pufCloned = false;
      let pufCheck: PUFMatchResult | undefined;

      if (pack && batch) {
        if (parsed.providedSignature) {
          const cleanProvided = parsed.providedSignature.trim().replace(/^0x/i, '');
          if (cleanProvided.length === 130) {
            signatureMethod = 'ECDSA_SECP256K1';
            const allowedIssuers = [
              getIssuerPublicAddress(),
              MANUFACTURER_PUBLIC_ADDRESS,
              ...ledgerState.participants
                .filter((pt) => pt.role === 'MANUFACTURER' && pt.isAuthorized)
                .map((pt) => pt.walletAddress),
            ];
            const ecdsaCheck = await verifyQRSignatureECDSA(
              pack.serialNumber,
              pack.batchId,
              batch.expiresAt,
              pack.nonce,
              parsed.providedSignature,
              allowedIssuers
            );
            const normPackSig = pack.signature.trim().replace(/^0x/i, '').toLowerCase();
            if (!ecdsaCheck.isValid || cleanProvided.toLowerCase() !== normPackSig) {
              signatureTampered = true;
            }
          } else {
            signatureMethod = 'LEGACY_ATTESTATION';
            const normProvided = cleanProvided.toLowerCase();
            const normPackSig = pack.signature.trim().replace(/^0x/i, '').toLowerCase();
            const validSig =
              normProvided === normPackSig &&
              verifyQRSignature(
                pack.serialNumber,
                pack.batchId,
                batch.expiresAt,
                pack.nonce,
                parsed.providedSignature,
                pack.signature
              );
            if (!validSig) {
              signatureTampered = true;
            }
          }
        }

        const anchoredPuf =
          pack.pufSealHash || deriveDeterministicPUFPrint(pack.serialNumber, pack.batchId);
        if (scannedPufHex && scannedPufHex.trim()) {
          pufCheck = computePUFHammingMatch(anchoredPuf, scannedPufHex.trim());
          pufCloned = pufCheck.verdict === 'CLONED_PHOTOCOPY_REJECTED';
        } else {
          pufCheck = computePUFHammingMatch(anchoredPuf, anchoredPuf);
        }

        if (
          typeof scanLat === 'number' &&
          typeof scanLon === 'number' &&
          typeof pack.lastScanLat === 'number' &&
          typeof pack.lastScanLon === 'number'
        ) {
          const jump = detectImpossibleGeographicJump(
            pack.lastScanLat,
            pack.lastScanLon,
            scanLat,
            scanLon,
            elapsedMinutes ?? 5
          );
          impossibleJump = jump.isImpossibleJump;
        }

        const nextCount = pack.scanCount + 1;
        const updatedPackRow: MedicinePackRecord = {
          ...pack,
          scanCount: nextCount,
          isSuspicious:
            pack.isSuspicious || nextCount > 1 || signatureTampered || impossibleJump || pufCloned,
          suspicionReason: pufCloned
            ? `Optical PUF micro-seal failed (${pufCheck?.bitDrift ?? 0}/256 bits drifted — photocopy clone)`
            : signatureTampered
            ? 'Cryptographic QR signature mismatch detected'
            : impossibleJump
            ? 'Impossible geographic velocity jump detected'
            : nextCount > 1
            ? `Duplicate QR verification #${nextCount} recorded`
            : pack.suspicionReason,
          lastScannedLocation: scanLocation || pack.lastScannedLocation,
          lastScanLat: typeof scanLat === 'number' ? scanLat : pack.lastScanLat,
          lastScanLon: typeof scanLon === 'number' ? scanLon : pack.lastScanLon,
          lastScanTimestamp: new Date().toISOString(),
        };
        ledgerState = store.updatePackScanGranular(updatedPackRow, ledgerState);
        broadcastSSE('ledger_updated', {
          reason: 'QR_VERIFY_SCAN',
          serialNumber: pack.serialNumber,
          version: ledgerState.version,
        });
      }

      const updatedPack = ledgerState.packs.find(
        (p) => p.serialNumber.toLowerCase() === parsed.serialNumber.toLowerCase()
      );
      const custodyTimeline = updatedPack
        ? ledgerState.custodyEvents.filter(
            (c) =>
              c.serialHash === updatedPack.serialHash || c.serialHash === updatedPack.batchId
          )
        : [];
      const telemetryHistory = batch
        ? ledgerState.telemetry.filter((t) => t.batchId === batch.batchId)
        : [];

      const result = evaluatePackVerification(
        updatedPack,
        batch,
        custodyTimeline,
        telemetryHistory,
        new Date().toISOString(),
        impossibleJump,
        signatureTampered,
        pufCloned
      );

      // Optional FastAPI Scikit-Learn Sidecar ML Inference Bridge
      let inferenceEngine: 'FASTAPI_SKLEARN' | 'LOCAL_DETERMINISTIC_RF' =
        'LOCAL_DETERMINISTIC_RF';
      const aiServiceUrl = process.env.AI_SERVICE_URL;
      if (aiServiceUrl && updatedPack && batch) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 600);
          const aiResp = await fetch(`${aiServiceUrl.replace(/\/$/, '')}/api/v1/ai/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              serial_number: updatedPack.serialNumber,
              scan_count: updatedPack.scanCount,
              is_dispensed: updatedPack.status === 'DISPENSED',
              is_expired: Date.now() > new Date(batch.expiresAt).getTime(),
              is_quarantined: batch.isQuarantined,
              is_recalled: batch.isRecalled,
              cold_chain_breached: telemetryHistory.some((t) => t.isBreached),
              impossible_jump: impossibleJump,
              signature_tampered: signatureTampered,
            }),
          });
          clearTimeout(timer);
          if (aiResp.ok) {
            const aiData = (await aiResp.json()) as {
              risk_score?: number;
              risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
              confidence?: number;
              reason?: string;
            };
            if (typeof aiData.risk_score === 'number') {
              result.aiAssessment.riskScore = aiData.risk_score;
              if (aiData.risk_level) result.aiAssessment.riskLevel = aiData.risk_level;
              if (typeof aiData.confidence === 'number') {
                result.aiAssessment.confidence = aiData.confidence;
              }
              if (aiData.reason) result.aiAssessment.reason = aiData.reason;
              inferenceEngine = 'FASTAPI_SKLEARN';
            }
          }
        } catch {
          // Graceful fallback to local deterministic RandomForest scorer
        }
      }

      return res.json({
        ...result,
        signatureMethod,
        inferenceEngine,
        pufCheck,
        state: ledgerState,
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // Mobile Phone QR Scan Certificate Route (/qr-verify and GS1 /01/:gtin/21/:serial)
  const renderMobileQrCertificate = (req: express.Request, res: express.Response) => {
    const rawSerial = String(
      req.params.serial || req.query.serial || req.query.verify || ''
    ).trim();
    const providedSig = String(req.query.sig || '').trim();
    const pack = ledgerState.packs.find(
      (p) => p.serialNumber.toLowerCase() === rawSerial.toLowerCase()
    );
    const batch = pack
      ? ledgerState.batches.find((b) => b.batchId === pack.batchId)
      : undefined;

    const sigTampered = Boolean(
      pack &&
        providedSig &&
        providedSig.toLowerCase() !== pack.signature.toLowerCase() &&
        `0x${providedSig}`.toLowerCase() !== pack.signature.toLowerCase()
    );

    const queryVerdict = String(req.query.verdict || '');
    const isExplicitResaleQuery = queryVerdict.toUpperCase().includes('RESOLD');

    const forensic = traceSupplyChainStageForensics(
      pack,
      batch,
      ledgerState.custodyEvents,
      ledgerState.telemetry,
      {
        signatureTampered: sigTampered,
        simulateResaleScan: queryVerdict
          ? isExplicitResaleQuery
          : Boolean(pack?.status === 'DISPENSED' && pack.scanCount > 1),
      }
    );

    const brand = batch?.brandName || String(req.query.brand || 'Registered Pharmaceutical');
    const batchCode = batch?.batchCode || String(req.query.batch || 'VERIFIED-BATCH');
    const isSafe = pack ? forensic.overallStatus === 'AUTHENTIC_SAFE' : !req.query.verdict || String(req.query.verdict).includes('VERIFIED');
    const headline = pack
      ? forensic.headline
      : String(req.query.verdict || `Medicine Pack ${rawSerial || 'Verification'}`);
    const subheadline = pack
      ? forensic.subheadline
      : String(req.query.issue && req.query.issue !== 'None' ? req.query.issue : 'Cryptographic QR verification certificate');

    const stagesHtml = pack
      ? forensic.stages
          .map((st) => {
            const alert = st.stageStatus !== 'VERIFIED' && st.stageStatus !== 'PENDING';
            const badgeColor = alert
              ? '#fda4af;background:#4c0519;border:1px solid #be123c'
              : st.stageStatus === 'VERIFIED'
              ? '#6ee7b7;background:#022c22;border:1px solid #047857'
              : '#94a3b8;background:#0f172a;border:1px solid #334155';
            const tempStr =
              st.recordedTempC !== undefined
                ? `${st.recordedTempC.toFixed(1)}°C (Req: ${st.safeRangeLabel})`
                : `Req: ${st.safeRangeLabel}`;
            return `<div style="padding:12px;border-radius:10px;background:#020617;border:1px solid ${alert ? '#be123c' : '#1e293b'};margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                <strong style="color:#f8fafc;font-size:13px;">${st.stageTitle}</strong>
                <span style="font-family:monospace;font-size:11px;padding:2px 8px;border-radius:6px;color:${badgeColor};">${st.stageStatus}</span>
              </div>
              <div style="font-size:12px;color:#cbd5e1;line-height:1.5;">
                <div><span style="color:#64748b;">Actor:</span> ${st.actor}</div>
                <div><span style="color:#64748b;">Place:</span> ${st.location}</div>
                <div><span style="color:#64748b;">Temperature:</span> <strong style="color:${st.tempStatus === 'SAFE' ? '#34d399' : '#fb7185'}">${tempStr}</strong></div>
                <div style="margin-top:4px;color:${alert ? '#fda4af' : '#94a3b8'};">${st.incidentSummary}</div>
              </div>
            </div>`;
          })
          .join('')
      : `<div style="padding:12px;border-radius:10px;background:#020617;border:1px solid #1e293b;font-size:13px;color:#cbd5e1;">
          <div><strong>Holder:</strong> ${String(req.query.holder || 'Verified Supply Node')}</div>
          <div><strong>Location:</strong> ${String(req.query.place || 'Supply Chain Checkpoint')}</div>
          <div><strong>Cold Chain:</strong> ${String(req.query.temp || '2.0°C - 8.0°C')}</div>
        </div>`;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>MedSupply Sentinel | QR Certificate ${rawSerial}</title>
</head>
<body style="margin:0;background:#020617;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px;">
  <div style="max-width:480px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:20px;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e293b;padding-bottom:12px;margin-bottom:16px;">
      <div>
        <div style="font-size:11px;color:#34d399;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">MedSupply Sentinel</div>
        <div style="font-size:16px;font-weight:700;color:#f8fafc;">Mobile QR Verification Certificate</div>
      </div>
      <span style="font-family:monospace;font-size:11px;padding:4px 8px;border-radius:6px;background:#020617;border:1px solid #334155;color:#38bdf8;">ISO-18004</span>
    </div>

    <div style="padding:14px;border-radius:12px;margin-bottom:16px;background:${isSafe ? '#022c22' : '#4c0519'};border:1px solid ${isSafe ? '#059669' : '#e11d48'};">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${isSafe ? '#6ee7b7' : '#fda4af'};margin-bottom:4px;">
        ${isSafe ? 'VERIFIED AUTHENTIC & SAFE' : 'SAFETY / COUNTERFEIT ALERT'}
      </div>
      <div style="font-size:16px;font-weight:700;color:#ffffff;margin-bottom:6px;">${headline}</div>
      <div style="font-size:12px;color:#e2e8f0;line-height:1.5;">${subheadline}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:12px;">
      <div style="background:#020617;border:1px solid #1e293b;padding:10px;border-radius:8px;">
        <div style="color:#64748b;font-size:11px;">Medicine</div>
        <div style="font-weight:700;color:#f8fafc;margin-top:2px;">${brand}</div>
        <div style="font-family:monospace;color:#94a3b8;font-size:11px;">${batchCode}</div>
      </div>
      <div style="background:#020617;border:1px solid #1e293b;padding:10px;border-radius:8px;">
        <div style="color:#64748b;font-size:11px;">Pack Serial</div>
        <div style="font-family:monospace;font-weight:700;color:#34d399;margin-top:2px;">${rawSerial || 'N/A'}</div>
        <div style="color:#94a3b8;font-size:11px;">Status: ${pack?.status || 'Checked'}</div>
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">
      Stage-by-Stage Supply Chain &amp; Cold-Chain Audit
    </div>
    ${stagesHtml}

    <a href="/?verify=${encodeURIComponent(rawSerial)}" style="display:block;text-align:center;margin-top:16px;padding:12px;border-radius:10px;background:#10b981;color:#020617;font-weight:700;font-size:13px;text-decoration:none;">
      Open Full Interactive Dashboard →
    </a>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  };

  app.get('/qr-verify', renderMobileQrCertificate);
  app.get('/01/:gtin/21/:serial', renderMobileQrCertificate);

  const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    const distIndex = path.join(distPath, 'index.html');
    if (!fs.existsSync(distIndex)) {
      console.error(
        `\n[MedSupply Sentinel] Production build not found at ${distIndex}.\n` +
          `Run "npm run build" first, or start dev mode with "npm run dev".\n`
      );
      store.close();
      process.exit(1);
    }
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(distIndex);
    });
  }

  const allowPortFallback = !process.env.PORT && process.env.ALLOW_PORT_FALLBACK !== 'false';
  const maxPortOffset = allowPortFallback ? 10 : 0;

  const listenWithFallback = (candidatePort: number, attempt: number): Promise<http.Server> =>
    new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < maxPortOffset) {
          console.log(
            `[MedSupply Sentinel] Port ${candidatePort} is busy — trying port ${candidatePort + 1}...`
          );
          listenWithFallback(candidatePort + 1, attempt + 1).then(resolve, reject);
          return;
        }
        if (err.code === 'EADDRINUSE') {
          console.error(
            `\n[MedSupply Sentinel] Port ${candidatePort} is already in use.\n` +
              `Stop the other process or run on another port:\n` +
              `  macOS/Linux: PORT=${candidatePort + 1} npm run dev\n` +
              `  Windows PS:  $env:PORT=${candidatePort + 1}; npm run dev\n`
          );
        }
        reject(err);
      });
      server.listen(candidatePort, '0.0.0.0', () => resolve(server));
    });

  const httpServer = await listenWithFallback(PORT, 0);
  const addr = httpServer.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : PORT;
  const evmCheck = await probeLiveEvmNode(ledgerState.custodyEvents.length);

  console.log('\nMedSupply Sentinel is ready!');
  console.log(`  App URL:      http://localhost:${boundPort}`);
  console.log(`  Healthcheck:  http://localhost:${boundPort}/api/health`);
  console.log(`  Ledger DB:    ${SQLITE_DB_PATH} (SQLite WAL)`);
  console.log(
    `  Blockchain:   ${
      evmCheck.connected
        ? `Connected to EVM RPC (${evmCheck.rpcUrl})`
        : 'Zero-config SQLite Hash-Chained Ledger (Anvil optional)'
    }\n`
  );

  const shutdown = () => {
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // Ignore closed streams
      }
    }
    sseClients.clear();
    httpServer.close(() => {
      try {
        store.close();
      } catch {
        // Ignore already closed DB
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[MedSupply Sentinel] Fatal startup error:', err);
  process.exit(1);
});
