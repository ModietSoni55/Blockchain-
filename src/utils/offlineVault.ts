import {
  BatchRecord,
  MedicinePackRecord,
  VerificationResult,
  buildBatchMerkleTree,
  generateMerkleInclusionProof,
  evaluatePackVerification,
  parseQRScanInput,
  verifyQRSignature,
  verifyQRSignatureECDSA,
  deriveDeterministicPUFPrint,
  computePUFHammingMatch,
  PUFMatchResult,
  MANUFACTURER_PUBLIC_ADDRESS,
} from './sentinelLogic';

export interface OfflineVaultSnapshot {
  syncedAt: string;
  ledgerVersion: number;
  issuerAddress: string;
  batches: BatchRecord[];
  packs: MedicinePackRecord[];
  merkleRootsByBatchId: Record<string, string>;
}

export interface QueuedOfflineScan {
  id: string;
  rawInput: string;
  locationLabel: string;
  scannedAt: string;
  localOutcome: string;
}

const DB_NAME = 'medsupply_sentinel_edge_vault';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshot';
const QUEUE_STORE = 'pending_scans';

function openVaultDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable in this runtime.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflineSnapshot(snapshot: OfflineVaultSnapshot): Promise<void> {
  const db = await openVaultDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).put(snapshot, 'latest');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadOfflineSnapshot(): Promise<OfflineVaultSnapshot | null> {
  try {
    const db = await openVaultDB();
    const res = await new Promise<OfflineVaultSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
      const req = tx.objectStore(SNAPSHOT_STORE).get('latest');
      req.onsuccess = () => resolve((req.result as OfflineVaultSnapshot) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export async function enqueueOfflineScan(scan: QueuedOfflineScan): Promise<void> {
  const db = await openVaultDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).put(scan);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listQueuedOfflineScans(): Promise<QueuedOfflineScan[]> {
  try {
    const db = await openVaultDB();
    const list = await new Promise<QueuedOfflineScan[]>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      const req = tx.objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => resolve((req.result as QueuedOfflineScan[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list;
  } catch {
    return [];
  }
}

export async function clearQueuedOfflineScans(): Promise<void> {
  const db = await openVaultDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Verifies a QR scan 100% offline against the cached IndexedDB Merkle Roots & Manufacturer ECDSA Public Key
 */
export async function verifyPackOfflineFromVault(
  rawInput: string,
  snapshot: OfflineVaultSnapshot,
  scannedPufHex?: string
): Promise<{
  result: VerificationResult;
  merkleRootMatched: boolean;
  ecdsaSignerVerified: boolean;
  pufCheck?: PUFMatchResult;
}> {
  const parsed = parseQRScanInput(rawInput);
  const pack = snapshot.packs.find(
    (p) => p.serialNumber.toLowerCase() === parsed.serialNumber.toLowerCase()
  );
  const batch = pack ? snapshot.batches.find((b) => b.batchId === pack.batchId) : undefined;

  let sigTampered = false;
  let ecdsaSignerVerified = false;
  if (pack && batch && parsed.providedSignature) {
    const ecdsaCheck = await verifyQRSignatureECDSA(
      pack.serialNumber,
      pack.batchId,
      batch.expiresAt,
      pack.nonce,
      parsed.providedSignature,
      [snapshot.issuerAddress || MANUFACTURER_PUBLIC_ADDRESS]
    );
    if (ecdsaCheck.isValid) {
      ecdsaSignerVerified = true;
    } else {
      const legacyValid = verifyQRSignature(
        pack.serialNumber,
        pack.batchId,
        batch.expiresAt,
        pack.nonce,
        parsed.providedSignature,
        pack.signature
      );
      if (!legacyValid) {
        sigTampered = true;
      }
    }
  }

  let pufCloned = false;
  let pufCheck: PUFMatchResult | undefined;
  let merkleRootMatched = false;
  if (pack && batch) {
    const anchoredPuf =
      pack.pufSealHash || deriveDeterministicPUFPrint(pack.serialNumber, pack.batchId);
    if (scannedPufHex && scannedPufHex.trim()) {
      pufCheck = computePUFHammingMatch(anchoredPuf, scannedPufHex.trim());
      pufCloned = pufCheck.verdict === 'CLONED_PHOTOCOPY_REJECTED';
    } else {
      pufCheck = computePUFHammingMatch(anchoredPuf, anchoredPuf);
    }

    const batchPacks = snapshot.packs.filter((p) => p.batchId === batch.batchId);
    const proof = generateMerkleInclusionProof(pack.serialNumber, batchPacks, batch.expiresAt);
    const cachedRoot =
      snapshot.merkleRootsByBatchId[batch.batchId] ||
      buildBatchMerkleTree(batchPacks, batch.expiresAt).merkleRoot;
    merkleRootMatched =
      proof.isVerified && proof.merkleRoot.toLowerCase() === cachedRoot.toLowerCase();
  }

  const result = evaluatePackVerification(
    pack,
    batch,
    [],
    [],
    new Date().toISOString(),
    false,
    sigTampered,
    pufCloned
  );

  return {
    result,
    merkleRootMatched,
    ecdsaSignerVerified,
    pufCheck,
  };
}
