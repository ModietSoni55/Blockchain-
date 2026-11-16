import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeAbiParameters, keccak256, concat } from 'viem';
import {
  MANUFACTURER_PUBLIC_ADDRESS,
  computeKeccakHex,
  signQRPayload,
  verifyQRSignature,
  buildQRSignatureDigest,
  verifyQRSignatureECDSA,
  generateCSPRNGBlindingSalt,
  evaluatePredictiveColdChain,
  buildHardwareTelemetryDigest,
  verifySignedTelemetryECDSA,
  computeRecallBlastRadius,
  buildGS1DigitalLink,
  canRoleExecuteAction,
  evaluateColdChainReading,
  calculateMeanKineticTemperature,
  detectImpossibleGeographicJump,
  evaluateLogisticsBottleneck,
  calculateAIRiskScore,
  parseQRScanInput,
  evaluatePackVerification,
  computePackMerkleLeaf,
  hashMerkleNodePair,
  buildBatchMerkleTree,
  generateMerkleInclusionProof,
  verifyMerkleInclusionProof,
  computeEIP712AttestationDigest,
  createZKPrescriptionCommitment,
  verifyZKPrescriptionCommitment,
  createNIZKPrescriptionProof,
  verifyNIZKPrescriptionProof,
  buildHashChainedBlocks,
  deriveDeterministicPUFPrint,
  perturbPUFBits,
  computePUFHammingMatch,
  splitSecretShamir,
  sealShamirSharesECIES,
  decryptShamirShareECIES,
  reconstructSecretShamir,
  createSelectiveDisclosureVC,
  verifySelectiveDisclosureVC,
  analyzeCustodyGraphDiversion,
  sealTelemetryEventChain,
  sealTelemetrySequence,
  buildTelemetryHashChain,
  traceSupplyChainStageForensics,
  buildPhoneScannableQRCertificate,
  BatchRecord,
  MedicinePackRecord,
  TelemetryEvent,
  CustodyEvent,
} from './sentinelLogic';
import { verifyPackOfflineFromVault } from './offlineVault';

test('True 256-bit keccak256 & QR cryptographic signing succeeds with or without 0x prefix and rejects tampering', () => {
  const digest = computeKeccakHex('BATCH-PCV-2026');
  assert.equal(digest.startsWith('0x'), true);
  assert.equal(digest.length, 66);
  // Real 256-bit keccak256 must not repeat its two 128-bit halves
  assert.notEqual(digest.slice(2, 34), digest.slice(34, 66));

  const sn = 'SN-PCV20-2026-0001';
  const batchId = digest;
  const expiresAt = '2027-11-12T00:00:00.000Z';
  const nonce = computeKeccakHex('nonce-1');

  const sig = signQRPayload(sn, batchId, expiresAt, nonce);
  assert.equal(verifyQRSignature(sn, batchId, expiresAt, nonce, sig), true);
  assert.equal(verifyQRSignature(sn, batchId, expiresAt, nonce, `0x${sig}`), true);
  assert.equal(verifyQRSignature('SN-TAMPERED-9999', batchId, expiresAt, nonce, sig), false);
});

test('Asymmetric secp256k1 ECDSA QR verification succeeds via public key recovery without client secrets and rejects forged payloads', async () => {
  // Test manufacturer keypair matching MANUFACTURER_PUBLIC_ADDRESS (Anvil #1)
  const testManufacturerAccount = privateKeyToAccount(
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  );
  assert.equal(
    testManufacturerAccount.address.toLowerCase(),
    MANUFACTURER_PUBLIC_ADDRESS.toLowerCase()
  );

  const sn = 'SN-ECDSA-2026-0001';
  const batchId = computeKeccakHex('BATCH-ECDSA-2026');
  const expiresAt = '2028-06-30T00:00:00.000Z';
  const nonce = computeKeccakHex('ecdsa-nonce-1');

  const digest = buildQRSignatureDigest(sn, batchId, expiresAt, nonce) as `0x${string}`;
  const sig = await testManufacturerAccount.signMessage({ message: { raw: digest } });

  const valid = await verifyQRSignatureECDSA(sn, batchId, expiresAt, nonce, sig);
  assert.equal(valid.isValid, true);
  assert.equal(
    valid.recoveredAddress?.toLowerCase(),
    MANUFACTURER_PUBLIC_ADDRESS.toLowerCase()
  );

  // Altered serial number must recover a different address and fail
  const tampered = await verifyQRSignatureECDSA('SN-FORGED-0001', batchId, expiresAt, nonce, sig);
  assert.equal(tampered.isValid, false);

  // Wrong issuer address list must fail
  const wrongIssuer = await verifyQRSignatureECDSA(sn, batchId, expiresAt, nonce, sig, [
    '0x1111111111111111111111111111111111111111',
  ]);
  assert.equal(wrongIssuer.isValid, false);
});

test('Cold-chain evaluation and Mean Kinetic Temperature (MKT) math are accurate', () => {
  const safe = evaluateColdChainReading(4.8, 2.0, 8.0);
  assert.equal(safe.isBreached, false);

  const overheated = evaluateColdChainReading(14.2, 2.0, 8.0);
  assert.equal(overheated.isBreached, true);
  assert.equal(overheated.breachType, 'OVERHEATING');

  const mkt = calculateMeanKineticTemperature([4.0, 4.5, 5.0, 4.8]);
  assert.equal(mkt >= 4.0 && mkt <= 5.2, true);

  const mktExcursion = calculateMeanKineticTemperature([4.2, 4.6, 15.5]);
  assert.equal(mktExcursion > 8.0, true);
});

test('Predictive Arrhenius cold-chain model computes drift velocity, +2h EXCURSION_IMMINENT alerts, and shelf-life potency', () => {
  const risingReadings: TelemetryEvent[] = [
    {
      id: 't1',
      batchId: '0xb1',
      temperature: 4.5,
      humidity: 45,
      latitude: 42.3,
      longitude: -71.0,
      locationLabel: 'Hub A',
      deviceId: 'SENS-1',
      timestamp: '2026-11-12T10:00:00.000Z',
      isBreached: false,
    },
    {
      id: 't2',
      batchId: '0xb1',
      temperature: 6.8,
      humidity: 47,
      latitude: 42.3,
      longitude: -71.0,
      locationLabel: 'Hub A',
      deviceId: 'SENS-1',
      timestamp: '2026-11-12T11:00:00.000Z',
      isBreached: false,
    },
  ];

  const imminent = evaluatePredictiveColdChain(risingReadings, 2.0, 8.0);
  assert.equal(imminent.driftPerHour > 2.0, true);
  assert.equal(imminent.projectedTemp2h > 8.0, true);
  assert.equal(imminent.isExcursionImminent, true);
  assert.equal(Boolean(imminent.imminentWarning?.includes('EXCURSION_IMMINENT')), true);
  assert.equal(imminent.remainingShelfLifePct <= 100 && imminent.remainingShelfLifePct > 50, true);

  const breachedReadings: TelemetryEvent[] = [
    ...risingReadings,
    {
      id: 't3',
      batchId: '0xb1',
      temperature: 14.5,
      humidity: 55,
      latitude: 42.3,
      longitude: -71.0,
      locationLabel: 'Hub A',
      deviceId: 'SENS-1',
      timestamp: '2026-11-12T12:00:00.000Z',
      isBreached: true,
      breachType: 'OVERHEATING',
    },
  ];
  const degraded = evaluatePredictiveColdChain(breachedReadings, 2.0, 8.0);
  assert.equal(degraded.remainingShelfLifePct < imminent.remainingShelfLifePct, true);
});

test('Hardware IoT ECDSA telemetry signature verification authenticates authorized gateways and blocks spoofed sensors', async () => {
  const gatewayAccount = privateKeyToAccount(
    '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
  );
  const reading = {
    batchId: '0xbatch-iot',
    temperature: 4.9,
    humidity: 44.2,
    latitude: 42.3601,
    longitude: -71.0589,
    timestamp: '2026-11-12T14:00:00.000Z',
    deviceId: 'IOT-REEFER-BOS-01',
  };
  const digest = buildHardwareTelemetryDigest(reading) as `0x${string}`;
  const sig = await gatewayAccount.signMessage({ message: { raw: digest } });

  const verified = await verifySignedTelemetryECDSA(
    { ...reading, signature: sig },
    [gatewayAccount.address]
  );
  assert.equal(verified.isValid, true);
  assert.equal(verified.recoveredAddress?.toLowerCase(), gatewayAccount.address.toLowerCase());

  const tamperedTemp = await verifySignedTelemetryECDSA(
    { ...reading, temperature: 18.4, signature: sig },
    [gatewayAccount.address]
  );
  assert.equal(tamperedTemp.isValid, false);

  const unauthorizedGateway = await verifySignedTelemetryECDSA(
    { ...reading, signature: sig },
    ['0x9999999999999999999999999999999999999999']
  );
  assert.equal(unauthorizedGateway.isValid, false);
});

test('Haversine geo-velocity detector flags impossible geographic jumps between sequential scans', () => {
  // Boston (42.3601, -71.0589) to Los Angeles (34.0522, -118.2437) in 5 minutes
  const jump = detectImpossibleGeographicJump(42.3601, -71.0589, 34.0522, -118.2437, 5);
  assert.equal(jump.distanceKm > 3500, true);
  assert.equal(jump.isImpossibleJump, true);

  // Local hospital transfer within Boston over 60 minutes
  const normalMove = detectImpossibleGeographicJump(42.3601, -71.0589, 42.3505, -71.0765, 60);
  assert.equal(normalMove.isImpossibleJump, false);
});

test('Logistics bottleneck evaluator classifies OPTIMAL, CONGESTED, and CRITICAL_BOTTLENECK hubs', () => {
  const optimal = evaluateLogisticsBottleneck({
    dwellHours: 4,
    maxSafeDwellHours: 12,
    excursionCount: 0,
    throughputCapacityPct: 58,
  });
  assert.equal(optimal.status, 'OPTIMAL');

  const congested = evaluateLogisticsBottleneck({
    dwellHours: 16,
    maxSafeDwellHours: 12,
    excursionCount: 0,
    throughputCapacityPct: 82,
  });
  assert.equal(congested.status, 'CONGESTED');

  const critical = evaluateLogisticsBottleneck({
    dwellHours: 24,
    maxSafeDwellHours: 12,
    excursionCount: 2,
    throughputCapacityPct: 95,
  });
  assert.equal(critical.status, 'CRITICAL_BOTTLENECK');
  assert.equal(critical.severityScore >= 65, true);
});

test('AI Risk Engine scores clean packs at 0 LOW and compromised or unregistered packs at HIGH/CRITICAL', () => {
  const clean = calculateAIRiskScore({
    isRegistered: true,
    scanCount: 1,
    isDispensed: false,
    isExpired: false,
    isQuarantined: false,
    isRecalled: false,
    coldChainBreached: false,
  });
  assert.equal(clean.riskScore, 0);
  assert.equal(clean.riskLevel, 'LOW');

  const duplicateAndBreach = calculateAIRiskScore({
    isRegistered: true,
    scanCount: 3,
    isDispensed: false,
    isExpired: false,
    isQuarantined: false,
    isRecalled: false,
    coldChainBreached: true,
    maxExcursionDelta: 6.2,
  });
  assert.equal(duplicateAndBreach.riskScore >= 75, true);
  assert.equal(duplicateAndBreach.riskLevel === 'HIGH' || duplicateAndBreach.riskLevel === 'CRITICAL', true);

  const unregistered = calculateAIRiskScore({
    isRegistered: false,
    scanCount: 1,
    isDispensed: false,
    isExpired: false,
    isQuarantined: false,
    isRecalled: false,
    coldChainBreached: false,
  });
  assert.equal(unregistered.riskScore, 100);
  assert.equal(unregistered.riskLevel, 'CRITICAL');
});

test('Full pack verification transitions from AUTHENTIC to SUSPICIOUS_DUPLICATE and QUARANTINED', () => {
  const batch: BatchRecord = {
    batchId: '0xbatch1',
    batchCode: 'BATCH-PCV-2026',
    productCode: 'NDC-0069-4210-01',
    brandName: 'Prevnar 20 Vaccine',
    genericName: 'Pneumococcal 20-valent Conjugate Vaccine',
    dosageForm: 'Suspension for Injection',
    strength: '0.5 mL',
    totalPacks: 50,
    packsRegistered: 5,
    minTemp: 2.0,
    maxTemp: 8.0,
    manufacturedAt: '2026-01-10T00:00:00.000Z',
    expiresAt: '2027-12-31T00:00:00.000Z',
    manufacturerName: 'Pfizer BioTech Labs',
    manufacturerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    isQuarantined: false,
    isRecalled: false,
    txHash: '0xtx1',
  };

  const pack: MedicinePackRecord = {
    serialNumber: 'SN-PCV20-2026-0001',
    serialHash: computeKeccakHex('SN-PCV20-2026-0001'),
    batchId: '0xbatch1',
    tokenId: 1,
    status: 'AT_PHARMACY',
    currentCustodian: 'City Central Hospital Pharmacy',
    custodianRole: 'PHARMACY',
    nonce: '0xnonce1',
    signature: 'sig1',
    scanCount: 1,
    isSuspicious: false,
  };

  const r1 = evaluatePackVerification(pack, batch, [], [], '2026-11-12T06:00:00.000Z');
  assert.equal(r1.outcome, 'AUTHENTIC');
  assert.equal(r1.isAuthentic, true);

  // Second scan flags duplicate
  const packScannedTwice = { ...pack, scanCount: 2, isSuspicious: true };
  const r2 = evaluatePackVerification(packScannedTwice, batch, [], [], '2026-11-12T06:05:00.000Z');
  assert.equal(r2.outcome, 'SUSPICIOUS_DUPLICATE');
  assert.equal(r2.isAuthentic, false);

  // Quarantine overrides outcome
  const quarantinedBatch = { ...batch, isQuarantined: true, quarantineReason: 'Excursion above 14°C' };
  const r3 = evaluatePackVerification(packScannedTwice, quarantinedBatch, [], [], '2026-11-12T06:10:00.000Z');
  assert.equal(r3.outcome, 'QUARANTINED');
  assert.equal(r3.aiAssessment.riskLevel, 'CRITICAL');

  // Tampered QR signature triggers TAMPERED_SIGNATURE
  const r4 = evaluatePackVerification(pack, batch, [], [], '2026-11-12T06:12:00.000Z', false, true);
  assert.equal(r4.outcome, 'TAMPERED_SIGNATURE');
  assert.equal(r4.isAuthentic, false);
  assert.equal(r4.aiAssessment.riskLevel, 'CRITICAL');
});

test('computeRecallBlastRadius accurately partitions pharmacy, transit, dispensed patient receipts, and destroyed units', () => {
  const batch: BatchRecord = {
    batchId: '0xbatch-br',
    batchCode: 'BATCH-BR-2026',
    productCode: 'NDC-0001',
    brandName: 'Test Biologic',
    genericName: 'Biologic',
    dosageForm: 'Vial',
    strength: '10mg',
    totalPacks: 5,
    packsRegistered: 4,
    minTemp: 2,
    maxTemp: 8,
    manufacturedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    manufacturerName: 'Mfg',
    manufacturerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    isQuarantined: false,
    isRecalled: true,
    txHash: '0x1',
  };

  const packs: MedicinePackRecord[] = [
    {
      serialNumber: 'SN-1',
      serialHash: '0x1',
      batchId: '0xbatch-br',
      tokenId: 1,
      status: 'AT_PHARMACY',
      currentCustodian: 'City Central Pharmacy',
      custodianRole: 'PHARMACY',
      nonce: '0x1',
      signature: 's1',
      scanCount: 0,
      isSuspicious: false,
    },
    {
      serialNumber: 'SN-2',
      serialHash: '0x2',
      batchId: '0xbatch-br',
      tokenId: 2,
      status: 'IN_TRANSIT',
      currentCustodian: 'Midwest Logistics',
      custodianRole: 'DISTRIBUTOR',
      nonce: '0x2',
      signature: 's2',
      scanCount: 0,
      isSuspicious: false,
    },
    {
      serialNumber: 'SN-3',
      serialHash: '0x3',
      batchId: '0xbatch-br',
      tokenId: 3,
      status: 'DISPENSED',
      currentCustodian: 'City Central Pharmacy',
      custodianRole: 'PHARMACY',
      nonce: '0x3',
      signature: 's3',
      scanCount: 1,
      isSuspicious: false,
      dispensedToReceipt: '0xzk1',
    },
    {
      serialNumber: 'SN-4',
      serialHash: '0x4',
      batchId: '0xbatch-br',
      tokenId: 4,
      status: 'DESTROYED_WITNESSED',
      currentCustodian: 'FDA Destruction Witness',
      custodianRole: 'REGULATOR',
      nonce: '0x4',
      signature: 's4',
      scanCount: 0,
      isSuspicious: false,
    },
  ];

  const blast = computeRecallBlastRadius(batch, packs);
  assert.equal(blast.totalTrackedPacks, 4);
  assert.equal(blast.atPharmacyCount, 1);
  assert.equal(blast.inTransitCount, 1);
  assert.equal(blast.dispensedPatientReceipts, 1);
  assert.equal(blast.destroyedCount, 1);
  assert.deepEqual(blast.destructibleSerials, ['SN-1', 'SN-2']);
  assert.deepEqual(blast.patientExposureSerials, ['SN-3']);
});

test('parseQRScanInput parses raw serials, colon-delimited QR strings (with or without 0x), JSON QR, and GS1 Digital Link URIs', () => {
  const raw = parseQRScanInput('SN-PCV20-2026-0001');
  assert.equal(raw.serialNumber, 'SN-PCV20-2026-0001');
  assert.equal(raw.providedSignature, undefined);
  assert.equal(raw.format, 'RAW_SERIAL');

  const colonQr = parseQRScanInput('SN-PCV20-2026-0001:0xabcdef1234567890');
  assert.equal(colonQr.serialNumber, 'SN-PCV20-2026-0001');
  assert.equal(colonQr.providedSignature, '0xabcdef1234567890');
  assert.equal(colonQr.format, 'QR_COLON_PAYLOAD');

  const unprefixedColonQr = parseQRScanInput(
    'SN-PCV20-2026-0001:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
  );
  assert.equal(unprefixedColonQr.serialNumber, 'SN-PCV20-2026-0001');
  assert.equal(
    unprefixedColonQr.providedSignature,
    'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
  );
  assert.equal(unprefixedColonQr.format, 'QR_COLON_PAYLOAD');

  const gs1Uri = buildGS1DigitalLink('NDC-0069-4210-01', 'SN-PCV20-2026-0001', 'deadbeef12345678');
  const parsedGs1 = parseQRScanInput(gs1Uri);
  assert.equal(parsedGs1.serialNumber, 'SN-PCV20-2026-0001');
  assert.equal(parsedGs1.providedSignature, '0xdeadbeef12345678');
  assert.equal(parsedGs1.format, 'GS1_DIGITAL_LINK');

  const jsonQr = parseQRScanInput(
    JSON.stringify({
      serialNumber: 'SN-PCV20-2026-0002',
      batchId: '0xbatch1',
      signature: '0x9988776655',
    })
  );
  assert.equal(jsonQr.serialNumber, 'SN-PCV20-2026-0002');
  assert.equal(jsonQr.providedSignature, '0x9988776655');
  assert.equal(jsonQr.format, 'QR_JSON_PAYLOAD');
});

test('canRoleExecuteAction enforces OpenZeppelin AccessControl role permissions including pallet and destruction ops', () => {
  assert.equal(canRoleExecuteAction('MANUFACTURER', 'MINT_BATCH').allowed, true);
  assert.equal(canRoleExecuteAction('MANUFACTURER', 'COMMISSION_PALLET').allowed, true);
  assert.equal(canRoleExecuteAction('MANUFACTURER', 'TRANSFER_PALLET').allowed, true);
  assert.equal(canRoleExecuteAction('MANUFACTURER', 'QUARANTINE_BATCH').allowed, false);
  assert.equal(canRoleExecuteAction('MANUFACTURER', 'PROPOSE_RECALL').allowed, false);
  assert.equal(canRoleExecuteAction('DISTRIBUTOR', 'TRANSFER_PALLET').allowed, true);
  assert.equal(canRoleExecuteAction('DISTRIBUTOR', 'TRANSFER_PHARMACY').allowed, true);
  assert.equal(canRoleExecuteAction('PHARMACY', 'DISPENSE_PATIENT').allowed, true);
  assert.equal(canRoleExecuteAction('REGULATOR', 'QUARANTINE_BATCH').allowed, true);
  assert.equal(canRoleExecuteAction('REGULATOR', 'PROPOSE_RECALL').allowed, true);
  assert.equal(canRoleExecuteAction('REGULATOR', 'WITNESS_DESTRUCTION').allowed, true);
  assert.equal(canRoleExecuteAction('PHARMACY', 'WITNESS_DESTRUCTION').allowed, false);
});

test('Batch Merkle Tree generates valid O(log N) inclusion proofs for all packs and rejects forged leaves', () => {
  const samplePacks = [
    {
      serialNumber: 'SN-PCV20-2026-0001',
      serialHash: computeKeccakHex('SN-PCV20-2026-0001'),
      batchId: '0xbatch1',
    },
    {
      serialNumber: 'SN-PCV20-2026-0002',
      serialHash: computeKeccakHex('SN-PCV20-2026-0002'),
      batchId: '0xbatch1',
    },
    {
      serialNumber: 'SN-PCV20-2026-0003',
      serialHash: computeKeccakHex('SN-PCV20-2026-0003'),
      batchId: '0xbatch1',
    },
    {
      serialNumber: 'SN-PCV20-2026-0004',
      serialHash: computeKeccakHex('SN-PCV20-2026-0004'),
      batchId: '0xbatch1',
    },
  ];
  const expiresAt = '2027-12-31T00:00:00.000Z';

  const tree = buildBatchMerkleTree(samplePacks, expiresAt);
  assert.equal(tree.leaves.length, 4);
  assert.equal(tree.merkleRoot.startsWith('0x'), true);

  for (const p of samplePacks) {
    const proof = generateMerkleInclusionProof(p.serialNumber, samplePacks, expiresAt);
    assert.equal(proof.isVerified, true);
    assert.equal(proof.merkleRoot, tree.merkleRoot);
    assert.equal(
      verifyMerkleInclusionProof(proof.leafHash, proof.proofSiblings, tree.merkleRoot),
      true
    );
  }

  const forgedProof = generateMerkleInclusionProof('SN-FORGED-9999', samplePacks, expiresAt);
  assert.equal(forgedProof.isVerified, false);
});

test('CSPRNG ZK salt, EIP-712 typed structured data digest, ERC-5192 Soulbound lock, ZK commitment, and Hash-Chained Blocks verify cleanly', () => {
  const eip = computeEIP712AttestationDigest({
    serialNumber: 'SN-PCV20-2026-0001',
    serialHash: computeKeccakHex('SN-PCV20-2026-0001'),
    batchId: '0xbatch1',
    expiresAt: '2027-12-31T00:00:00.000Z',
    nonce: '0xnonce1',
    status: 'DISPENSED',
    chainId: 31337,
  });
  assert.equal(eip.eip712Digest.startsWith('0x'), true);
  assert.equal(eip.isSoulboundLocked, true);

  const eipDestroyed = computeEIP712AttestationDigest({
    serialNumber: 'SN-PCV20-2026-0001',
    serialHash: computeKeccakHex('SN-PCV20-2026-0001'),
    batchId: '0xbatch1',
    expiresAt: '2027-12-31T00:00:00.000Z',
    nonce: '0xnonce1',
    status: 'DESTROYED_WITNESSED',
    chainId: 31337,
  });
  assert.equal(eipDestroyed.isSoulboundLocked, true);

  const saltA = generateCSPRNGBlindingSalt();
  const saltB = generateCSPRNGBlindingSalt();
  assert.equal(saltA.startsWith('ZK-SALT-'), true);
  assert.equal(saltA.length, 24);
  assert.notEqual(saltA, saltB);

  const zk = createZKPrescriptionCommitment(
    'SN-PCV20-2026-0001',
    'RX-2026-88412',
    saltA
  );
  assert.equal(
    verifyZKPrescriptionCommitment(
      'SN-PCV20-2026-0001',
      'RX-2026-88412',
      saltA,
      zk.commitmentHash
    ),
    true
  );
  assert.equal(
    verifyZKPrescriptionCommitment(
      'SN-PCV20-2026-0001',
      'RX-2026-88412',
      saltB,
      zk.commitmentHash
    ),
    false
  );

  const blocks = buildHashChainedBlocks([
    {
      id: 'c2',
      serialHash: '0x2',
      batchId: '0xb1',
      fromActor: 'A',
      toActor: 'B',
      action: 'TRANSFER_DISTRIBUTOR',
      location: 'Chicago, IL',
      timestamp: '2026-11-12T06:00:00.000Z',
      notes: 'Step 2',
      txHash: '0xtx2',
    },
    {
      id: 'c1',
      serialHash: '0x1',
      batchId: '0xb1',
      fromActor: 'Genesis',
      toActor: 'A',
      action: 'MINT_GENESIS',
      location: 'Kalamazoo, MI',
      timestamp: '2026-11-12T05:00:00.000Z',
      notes: 'Step 1',
      txHash: '0xtx1',
    },
  ]);
  assert.equal(blocks.length, 2);
  // Latest block's parentBlockHash must equal the previous block's blockHash
  assert.equal(blocks[0].parentBlockHash, blocks[1].blockHash);
});

test('PUF Optical Micro-Seal Hamming distance detects 6-bit jitter as authentic, 40-bit as suspect drift, and 108-bit as photocopy clone', () => {
  const anchored = deriveDeterministicPUFPrint('SN-PCV20-2026-0001', '0xbatch-puf');
  const jitterScan = perturbPUFBits(anchored, 6);
  const driftScan = perturbPUFBits(anchored, 40);
  const cloneScan = perturbPUFBits(anchored, 108);

  const matchOk = computePUFHammingMatch(anchored, jitterScan);
  assert.equal(matchOk.bitDrift, 6);
  assert.equal(matchOk.verdict, 'GENUINE_OPTICAL_SEAL');
  assert.equal(matchOk.isAuthentic, true);

  const matchDrift = computePUFHammingMatch(anchored, driftScan);
  assert.equal(matchDrift.bitDrift, 40);
  assert.equal(matchDrift.verdict, 'SUSPECT_OPTICAL_DRIFT');
  assert.equal(matchDrift.isAuthentic, false);

  const matchClone = computePUFHammingMatch(anchored, cloneScan);
  assert.equal(matchClone.bitDrift, 108);
  assert.equal(matchClone.verdict, 'CLONED_PHOTOCOPY_REJECTED');
  assert.equal(matchClone.isAuthentic, false);

  const sampleBatch: BatchRecord = {
    batchId: '0xbatch-puf',
    batchCode: 'BATCH-PUF-1',
    productCode: 'NDC-0069-4210-01',
    brandName: 'Prevnar 20 Vaccine',
    genericName: 'Pneumococcal 20-valent',
    dosageForm: 'Vial',
    strength: '0.5 mL',
    totalPacks: 10,
    packsRegistered: 1,
    minTemp: 2,
    maxTemp: 8,
    manufacturedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    manufacturerName: 'Pfizer',
    manufacturerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    isQuarantined: false,
    isRecalled: false,
    txHash: '0x1',
  };
  const samplePack: MedicinePackRecord = {
    serialNumber: 'SN-PCV20-2026-0001',
    serialHash: computeKeccakHex('SN-PCV20-2026-0001'),
    batchId: '0xbatch-puf',
    tokenId: 1,
    status: 'AT_PHARMACY',
    currentCustodian: 'Boston Hospital Pharmacy',
    custodianRole: 'PHARMACY',
    nonce: '0xnonce',
    signature: '0xsig',
    pufSealHash: anchored,
    scanCount: 1,
    isSuspicious: false,
  };

  const verdict = evaluatePackVerification(
    samplePack,
    sampleBatch,
    [],
    [],
    '2026-11-12T06:00:00.000Z',
    false,
    false,
    true
  );
  assert.equal(verdict.outcome, 'PHOTOCOPY_CLONE_DETECTED');
  assert.equal(verdict.isAuthentic, false);
  assert.equal(verdict.aiAssessment.riskLevel, 'CRITICAL');
});

test('Shamir (2,3)-Threshold Secret Sharing over GF(2^127 - 1) enforces zero 1-share leakage and losslessly reconstructs multi-chunk secrets from any 2-of-3 quorum', () => {
  const shortSecret = 'RX-884';
  const longSecret = 'RECALL_NOTIFY:RX-2026-88412|WARD-BOS-02|PATIENT_URGENT_CALLBACK';

  for (const secret of [shortSecret, longSecret]) {
    const shares = splitSecretShamir(secret, 'SN-SHAMIR-TEST');
    assert.equal(shares.length, 3);

    // 1 share alone must fail with ThresholdSecurityHold
    const oneShare = reconstructSecretShamir([shares[0]], 2);
    assert.equal(oneShare.ok, false);
    assert.equal(Boolean(oneShare.error?.includes('ThresholdSecurityHold')), true);

    // All 2-of-3 subsets (1,2), (1,3), (2,3) and all 3 must recover the exact string
    const pairs: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const [a, b] of pairs) {
      const recovered = reconstructSecretShamir([shares[a], shares[b]], 2);
      assert.equal(recovered.ok, true);
      assert.equal(recovered.recoveredSecret, secret);
      assert.equal(recovered.primeFieldLabel, 'GF(2^127 - 1)');
    }
  }
});

test('W3C Selective-Disclosure Verifiable Credential (SD-VC) verifies partially redacted Merkle proofs and rejects tampered claim values', () => {
  const batch: BatchRecord = {
    batchId: '0xbatch-sdvc',
    batchCode: 'BATCH-SDVC-2026',
    productCode: 'NDC-0069-4210-01',
    brandName: 'Prevnar 20 Vaccine',
    genericName: 'Pneumococcal Vaccine',
    dosageForm: 'Injection',
    strength: '0.5 mL',
    totalPacks: 10,
    packsRegistered: 1,
    minTemp: 2,
    maxTemp: 8,
    manufacturedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    manufacturerName: 'Pfizer BioTech Labs',
    manufacturerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    isQuarantined: false,
    isRecalled: false,
    txHash: '0xtx',
  };
  const pack: MedicinePackRecord = {
    serialNumber: 'SN-SDVC-0001',
    serialHash: computeKeccakHex('SN-SDVC-0001'),
    batchId: '0xbatch-sdvc',
    tokenId: 1,
    status: 'DISPENSED',
    currentCustodian: 'Boston Medical Center Outpatient Pharmacy',
    custodianRole: 'PHARMACY',
    nonce: '0x1',
    signature: '0xsig',
    scanCount: 1,
    isSuspicious: false,
    dispensedAt: '2026-11-12T08:00:00.000Z',
  };

  const vc = createSelectiveDisclosureVC(pack, batch, [], [
    'productName',
    'authenticity',
    'coldChainCompliant',
  ]);
  const check = verifySelectiveDisclosureVC(vc);
  assert.equal(check.valid, true);
  assert.equal(check.revealedVerifiedCount, 3);
  assert.equal(check.redactedCount, 3);

  // Tamper one revealed value and verify proof fails
  const tamperedVc = {
    ...vc,
    claims: vc.claims.map((c) =>
      c.key === 'authenticity' ? { ...c, value: 'FORGED_OVERRIDE' } : c
    ),
  };
  const tamperedCheck = verifySelectiveDisclosureVC(tamperedVc);
  assert.equal(tamperedCheck.valid, false);
});

test('analyzeCustodyGraphDiversion detects clean provenance chains vs unauthorized broker diversion hops', () => {
  const cleanPack: MedicinePackRecord = {
    serialNumber: 'SN-GRAPH-01',
    serialHash: '0xserial1',
    batchId: '0xbatch1',
    tokenId: 1,
    status: 'AT_PHARMACY',
    currentCustodian: 'Boston Hospital Pharmacy',
    custodianRole: 'PHARMACY',
    nonce: '0x1',
    signature: '0x1',
    scanCount: 1,
    isSuspicious: false,
  };
  const cleanEvents: CustodyEvent[] = [
    {
      id: 'e1',
      serialHash: '0xserial1',
      batchId: '0xbatch1',
      fromActor: 'Genesis Minting Vault',
      toActor: 'Pfizer BioTech Labs',
      action: 'MINT_GENESIS',
      location: 'Kalamazoo, MI',
      timestamp: '2026-11-10T01:00:00.000Z',
      notes: 'Minted',
      txHash: '0x1',
    },
    {
      id: 'e2',
      serialHash: '0xserial1',
      batchId: '0xbatch1',
      fromActor: 'Pfizer BioTech Labs',
      toActor: 'Midwest Cold Logistics',
      action: 'TRANSFER_DISTRIBUTOR',
      location: 'Chicago, IL',
      timestamp: '2026-11-10T03:00:00.000Z',
      notes: 'Transit',
      txHash: '0x2',
    },
  ];

  const cleanResult = analyzeCustodyGraphDiversion([cleanPack], cleanEvents);
  assert.equal(cleanResult.anomalousTransitions, 0);
  assert.equal(cleanResult.integrityScore, 100);

  const divertedEvents: CustodyEvent[] = [
    ...cleanEvents,
    {
      id: 'e3',
      serialHash: '0xserial1',
      batchId: '0xbatch1',
      fromActor: 'Shadow Gray Broker LLC',
      toActor: 'Unregistered Wholesaler X',
      action: 'GRAY_MARKET_HOP',
      location: 'Unknown',
      timestamp: '2026-11-10T05:00:00.000Z',
      notes: 'Diverted',
      txHash: '0x3',
    },
  ];

  const divertedResult = analyzeCustodyGraphDiversion([cleanPack], divertedEvents);
  assert.equal(divertedResult.anomalousTransitions, 1);
  assert.equal(divertedResult.integrityScore < 100, true);
});

test('Merkle leaf and pair hashing match MedSupplySentinel.sol abi.encode & raw bytes32 ordering 1:1', () => {
  const sn = 'SN-PARITY-001';
  const serialHash = computeKeccakHex(sn) as `0x${string}`;
  const batchId = computeKeccakHex('BATCH-PARITY') as `0x${string}`;
  const expiresAt = '2028-06-30T00:00:00.000Z';
  const expiresUnix = BigInt(Math.floor(new Date(expiresAt).getTime() / 1000));

  const solLeaf = keccak256(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
        [batchId, serialHash, expiresUnix]
      )
    )
  );
  const tsLeaf = computePackMerkleLeaf(batchId, serialHash, expiresAt);
  assert.equal(tsLeaf.toLowerCase(), solLeaf.toLowerCase());

  const leafA = computeKeccakHex('LEAF_A') as `0x${string}`;
  const leafB = computeKeccakHex('LEAF_B') as `0x${string}`;
  const solPair =
    BigInt(leafA) <= BigInt(leafB)
      ? keccak256(concat([leafA, leafB]))
      : keccak256(concat([leafB, leafA]));
  const tsPair = hashMerkleNodePair(leafA, leafB);
  assert.equal(tsPair.toLowerCase(), solPair.toLowerCase());
});

test('ECIES secp256k1 Shamir sealing strips plaintext chunks at rest and authenticates custodian ECDH decryption', () => {
  const secret = 'RECALL_NOTIFY:RX-2026-ECIES|WARD-07';
  const raw = splitSecretShamir(secret, 'SN-ECIES-001');
  const sealed = sealShamirSharesECIES(raw, undefined, 'DET-SEED-ECIES');

  // At rest: yChunksHex must be empty & reconstructSecretShamir must refuse sealed shares
  for (const s of sealed) {
    assert.equal(s.isSealedECIES, true);
    assert.equal(s.yChunksHex.length, 0);
    assert.ok(s.eciesEnvelope?.ciphertextHex);
  }
  const blocked = reconstructSecretShamir([sealed[0], sealed[2]], 2);
  assert.equal(blocked.ok, false);
  assert.equal(Boolean(blocked.error?.includes('ShamirSharesSealedECIES')), true);

  // Wrong custodian key (#1 Pharmacy private key cannot decrypt #3 Regulator share)
  const pharmacyPriv = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
  const regulatorPriv = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a';

  assert.throws(() => {
    decryptShamirShareECIES(sealed[2].eciesEnvelope!, pharmacyPriv);
  }, /ECIESAuthenticationFailed/);

  // Rightful custodians #1 (Pharmacy) and #3 (Regulator) decrypt and recover exact secret
  const unsealed1 = {
    ...sealed[0],
    yChunksHex: decryptShamirShareECIES(sealed[0].eciesEnvelope!, pharmacyPriv),
    isSealedECIES: false,
  };
  const unsealed3 = {
    ...sealed[2],
    yChunksHex: decryptShamirShareECIES(sealed[2].eciesEnvelope!, regulatorPriv),
    isSealedECIES: false,
  };
  const recovered = reconstructSecretShamir([unsealed1, unsealed3], 2);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recoveredSecret, secret);
});

test('Pedersen-Schnorr secp256k1 NIZK verifies knowledge without leaking witness and rejects forged scalars or challenges', () => {
  const proof = createNIZKPrescriptionProof(
    'SN-PCV20-2026-0005',
    'RX-2026-88412',
    'ZK-SALT-TEST9988'
  );
  assert.equal(proof.zeroWitnessLeaked, true);
  assert.equal(verifyNIZKPrescriptionProof(proof), true);

  // Tamper response s1 -> must fail EC equation check
  assert.equal(
    verifyNIZKPrescriptionProof({
      ...proof,
      responseS1Hex: `0x${'ab'.repeat(32)}`,
    }),
    false
  );

  // Tamper Fiat-Shamir challenge -> must fail challenge verification
  assert.equal(
    verifyNIZKPrescriptionProof({
      ...proof,
      challengeHex: computeKeccakHex('TAMPERED_CHALLENGE'),
    }),
    false
  );
});

test('Offline Edge Vault detects PUF optical photocopy clones and verifies clean cached packs', async () => {
  const batchId = computeKeccakHex('BATCH-OFFLINE-01');
  const expiresAt = '2028-06-30T00:00:00.000Z';
  const puf = deriveDeterministicPUFPrint('SN-OFFLINE-0001', batchId);
  const pack: MedicinePackRecord = {
    serialNumber: 'SN-OFFLINE-0001',
    serialHash: computeKeccakHex('SN-OFFLINE-0001'),
    batchId,
    tokenId: 1,
    status: 'AT_PHARMACY',
    currentCustodian: 'City Central Hospital Pharmacy',
    custodianRole: 'PHARMACY',
    nonce: computeKeccakHex('offline-nonce-1'),
    signature: signQRPayload('SN-OFFLINE-0001', batchId, expiresAt, computeKeccakHex('offline-nonce-1')),
    scanCount: 0,
    isSuspicious: false,
    pufSealHash: puf,
  };
  const batch: BatchRecord = {
    batchId,
    batchCode: 'BATCH-OFFLINE-01',
    productCode: 'NDC-0069-4210-01',
    brandName: 'Prevnar 20 Vaccine',
    genericName: 'Pneumococcal 20-valent Conjugate Vaccine',
    dosageForm: 'Suspension',
    strength: '0.5 mL',
    totalPacks: 10,
    packsRegistered: 1,
    minTemp: 2,
    maxTemp: 8,
    manufacturedAt: '2026-01-01T00:00:00.000Z',
    expiresAt,
    manufacturerName: 'Pfizer BioTech',
    manufacturerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    isQuarantined: false,
    isRecalled: false,
    txHash: '0xtx',
  };
  const tree = buildBatchMerkleTree([pack], expiresAt);
  const snapshot = {
    syncedAt: '2026-11-12T00:00:00.000Z',
    ledgerVersion: 1,
    issuerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    batches: [batch],
    packs: [pack],
    merkleRootsByBatchId: { [batchId]: tree.merkleRoot },
  };

  const cleanOffline = await verifyPackOfflineFromVault(pack.serialNumber, snapshot);
  assert.equal(cleanOffline.result.outcome, 'AUTHENTIC');
  assert.equal(cleanOffline.merkleRootMatched, true);

  const forgedPuf = perturbPUFBits(puf, 108);
  const cloneOffline = await verifyPackOfflineFromVault(pack.serialNumber, snapshot, forgedPuf);
  assert.equal(cloneOffline.result.outcome, 'PHOTOCOPY_CLONE_DETECTED');
  assert.equal(cloneOffline.pufCheck?.verdict, 'CLONED_PHOTOCOPY_REJECTED');
});

test('Expanded RBAC strictly restricts MANAGE_PARTICIPANTS, LEDGER_RESET, OPERATE_LOGISTICS, and DEAGGREGATE_PALLET', () => {
  assert.equal(canRoleExecuteAction('REGULATOR', 'MANAGE_PARTICIPANTS').allowed, true);
  assert.equal(canRoleExecuteAction('MANUFACTURER', 'MANAGE_PARTICIPANTS').allowed, false);
  assert.equal(canRoleExecuteAction('REGULATOR', 'LEDGER_RESET').allowed, true);
  assert.equal(canRoleExecuteAction('DISTRIBUTOR', 'LEDGER_RESET').allowed, false);
  assert.equal(canRoleExecuteAction('DISTRIBUTOR', 'OPERATE_LOGISTICS').allowed, true);
  assert.equal(canRoleExecuteAction('PHARMACY', 'OPERATE_LOGISTICS').allowed, false);
  assert.equal(canRoleExecuteAction('PHARMACY', 'DEAGGREGATE_PALLET').allowed, true);
  assert.equal(canRoleExecuteAction('DISTRIBUTOR', 'INGEST_TELEMETRY').allowed, true);
});

test('Cold-chain telemetry blockchain seals readings with Keccak-256 links and cascades tamper invalidation on 0.1°C mutation', () => {
  const rawReadings: TelemetryEvent[] = [
    {
      id: 'tel-a',
      batchId: '0xbatch-chain',
      temperature: 4.1,
      humidity: 44,
      latitude: 42.36,
      longitude: -71.05,
      locationLabel: 'Manufacturer Vault',
      deviceId: 'IOT-01',
      timestamp: '2026-11-15T08:00:00.000Z',
      isBreached: false,
      signerAddress: '0x1111111111111111111111111111111111111111',
    },
    {
      id: 'tel-b',
      batchId: '0xbatch-chain',
      temperature: -1.5,
      humidity: 48,
      latitude: 41.87,
      longitude: -87.62,
      locationLabel: 'Transit Reefer',
      deviceId: 'IOT-02',
      timestamp: '2026-11-15T09:00:00.000Z',
      isBreached: true,
      breachType: 'SUBCOOLING',
      signerAddress: '0x1111111111111111111111111111111111111111',
    },
    {
      id: 'tel-c',
      batchId: '0xbatch-chain',
      temperature: 4.4,
      humidity: 45,
      latitude: 42.36,
      longitude: -71.05,
      locationLabel: 'Pharmacy Vault',
      deviceId: 'IOT-03',
      timestamp: '2026-11-15T10:00:00.000Z',
      isBreached: false,
      signerAddress: '0x1111111111111111111111111111111111111111',
    },
  ];

  // Subcooling check
  const sub = evaluateColdChainReading(-1.5, 2.0, 8.0);
  assert.equal(sub.isBreached, true);
  assert.equal(sub.breachType, 'SUBCOOLING');

  const sealed = sealTelemetrySequence(rawReadings);
  const appended = sealTelemetryEventChain(
    {
      id: 'tel-d',
      batchId: '0xbatch-chain',
      temperature: 5.0,
      humidity: 45,
      latitude: 42.36,
      longitude: -71.05,
      locationLabel: 'Dispense Check',
      deviceId: 'IOT-04',
      timestamp: '2026-11-15T11:00:00.000Z',
      isBreached: false,
      signerAddress: '0x1111111111111111111111111111111111111111',
    },
    sealed
  );
  const fullChainInput = [appended, ...sealed];
  const validCheck = buildTelemetryHashChain(fullChainInput);
  assert.equal(validCheck.allValid, true);
  assert.equal(validCheck.totalBlocks, 4);
  assert.equal(validCheck.brokenCount, 0);

  // Tamper block #2 ('tel-b') by changing -1.5°C to fake safe 4.2°C -> blocks #2, #3, #4 must all fail
  const tamperedCheck = buildTelemetryHashChain(fullChainInput, { id: 'tel-b', temperature: 4.2 });
  assert.equal(tamperedCheck.allValid, false);
  assert.equal(tamperedCheck.firstBrokenBlockIndex, 2);
  assert.equal(tamperedCheck.brokenCount, 3);
});

test('Already-dispensed pack is immediately blocked with ALREADY_DISPENSED on the very first customer verification scan', () => {
  const batch: BatchRecord = {
    batchId: '0xbatch-disp',
    batchCode: 'BATCH-DISP-2026',
    productCode: 'NDC-0069-4210-01',
    brandName: 'Insulin Cold Vial',
    genericName: 'Insulin',
    dosageForm: 'Vial',
    strength: '100 U/mL',
    totalPacks: 10,
    packsRegistered: 1,
    minTemp: 2,
    maxTemp: 8,
    manufacturedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    manufacturerName: 'Pfizer BioTech Labs',
    manufacturerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    isQuarantined: false,
    isRecalled: false,
    txHash: '0xtx',
  };

  const soldPackFirstCustomerScan: MedicinePackRecord = {
    serialNumber: 'SN-SOLD-0001',
    serialHash: computeKeccakHex('SN-SOLD-0001'),
    batchId: '0xbatch-disp',
    tokenId: 1,
    status: 'DISPENSED',
    currentCustodian: 'Patient (RX-2026-88412)',
    custodianRole: 'PATIENT',
    nonce: '0x1',
    signature: '0xsig',
    scanCount: 1, // First scan after pharmacy sold it!
    isSuspicious: false,
    dispensedAt: '2026-11-15T10:00:00.000Z',
    dispensedToReceipt: computeKeccakHex('zk-receipt-1'),
  };

  const result = evaluatePackVerification(
    soldPackFirstCustomerScan,
    batch,
    [],
    [],
    '2026-11-15T10:05:00.000Z'
  );
  assert.equal(result.outcome, 'ALREADY_DISPENSED');
  assert.equal(result.isAuthentic, false);
  assert.equal(result.aiAssessment.riskLevel === 'HIGH' || result.aiAssessment.riskLevel === 'CRITICAL', true);
});

test('traceSupplyChainStageForensics pinpoints Distributor temperature drop, Pharmacy resale, broker diversion, and forged QR to exact stage and place', () => {
  const batchId = computeKeccakHex('LOT-FORENSIC-2026');
  const serialNumber = 'SN-FORENSIC-0001';
  const serialHash = computeKeccakHex(serialNumber);
  const batch: BatchRecord = {
    batchId,
    batchCode: 'LOT-FORENSIC-2026',
    productCode: 'NDC-0069-4210-01',
    brandName: 'Insulin Cold Vial',
    genericName: 'Insulin',
    dosageForm: 'Vial',
    strength: '100 U/mL',
    totalPacks: 100,
    packsRegistered: 1,
    minTemp: 2.0,
    maxTemp: 8.0,
    manufacturedAt: '2026-11-15T01:00:00.000Z',
    expiresAt: '2027-11-15T01:00:00.000Z',
    manufacturerName: 'Pfizer BioTech Manufacturing',
    manufacturerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    isQuarantined: false,
    isRecalled: false,
    txHash: '0xtx-mfg',
  };

  const basePack: MedicinePackRecord = {
    serialNumber,
    serialHash,
    batchId,
    tokenId: 1,
    status: 'IN_TRANSIT',
    currentCustodian: 'Apex Cold-Chain Logistics',
    custodianRole: 'DISTRIBUTOR',
    nonce: '0x1',
    signature: '0xsig-valid',
    scanCount: 0,
    isSuspicious: false,
    lastScannedLocation: 'Chicago O’Hare Cold Hub, Chicago, IL',
  };

  const custodyEvents: CustodyEvent[] = [
    {
      id: 'c-dist',
      serialHash,
      batchId,
      fromActor: 'Pfizer BioTech Manufacturing',
      toActor: 'Apex Cold-Chain Logistics',
      action: 'TRANSFER_DISTRIBUTOR',
      location: 'Chicago O’Hare Cold Hub, Chicago, IL',
      timestamp: '2026-11-15T02:00:00.000Z',
      notes: 'Shipped to distributor',
      txHash: '0xtx-dist',
    },
    {
      id: 'c-mfg',
      serialHash,
      batchId,
      fromActor: '0x0000...0000 (Genesis)',
      toActor: 'Pfizer BioTech Manufacturing',
      action: 'MINT_GENESIS',
      location: 'Kalamazoo Sterile Plant, Kalamazoo, MI',
      timestamp: '2026-11-15T01:00:00.000Z',
      notes: 'Minted genesis pack',
      txHash: '0xtx-mfg',
    },
  ];

  const telemetryWithDistDrop = sealTelemetrySequence([
    {
      id: 't-mfg',
      batchId,
      temperature: 4.2,
      humidity: 48,
      latitude: 42.29,
      longitude: -85.58,
      locationLabel: 'Kalamazoo Sterile Plant, Kalamazoo, MI',
      deviceId: 'MFG-VAULT-PROBE-01',
      timestamp: '2026-11-15T01:00:00.000Z',
      isBreached: false,
    },
    {
      id: 't-dist-drop',
      batchId,
      temperature: -1.5,
      humidity: 66,
      latitude: 41.87,
      longitude: -87.62,
      locationLabel: 'Chicago O’Hare Cold Hub, Chicago, IL',
      deviceId: 'DIST-REEFER-PROBE-02',
      timestamp: '2026-11-15T02:00:00.000Z',
      isBreached: true,
      breachType: 'SUBCOOLING',
    },
  ]);

  // 1. Distributor temperature drop is pinpointed to DISTRIBUTOR stage & Chicago O'Hare Cold Hub
  const reportDistDrop = traceSupplyChainStageForensics(
    basePack,
    batch,
    custodyEvents,
    telemetryWithDistDrop
  );
  assert.equal(reportDistDrop.overallStatus, 'BLOCKED_TEMP_BREACH');
  assert.equal(reportDistDrop.stages[0].stageStatus, 'VERIFIED');
  assert.equal(reportDistDrop.stages[1].stageStatus, 'TEMP_BREACH_ORIGIN');
  assert.equal(reportDistDrop.violations[0].category, 'TEMPERATURE_DROP');
  assert.equal(reportDistDrop.violations[0].detectedAtStage, 'DISTRIBUTOR');
  assert.equal(
    reportDistDrop.violations[0].culpritLocation,
    'Chicago O’Hare Cold Hub, Chicago, IL'
  );

  // 2. Dispensed pack resold at Pharmacy is pinpointed to PHARMACY stage & Boston location
  const soldPack: MedicinePackRecord = {
    ...basePack,
    status: 'DISPENSED',
    currentCustodian: 'Patient (RX-2026-88412)',
    custodianRole: 'PATIENT',
    dispensedAt: '2026-11-15T04:00:00.000Z',
    dispensedToReceipt: computeKeccakHex('zk-receipt-forensic'),
  };
  const custodyWithSale: CustodyEvent[] = [
    {
      id: 'c-sale',
      serialHash,
      batchId,
      fromActor: 'City Central Hospital Pharmacy',
      toActor: 'Patient (RX-2026-88412)',
      action: 'DISPENSED_TO_PATIENT',
      location: 'Boston Medical Receiving Vault, Boston, MA',
      timestamp: '2026-11-15T04:00:00.000Z',
      notes: 'Dispensed to patient',
      txHash: '0xtx-sale',
    },
    ...custodyEvents,
  ];
  const reportResold = traceSupplyChainStageForensics(
    soldPack,
    batch,
    custodyWithSale,
    telemetryWithDistDrop
  );
  assert.equal(reportResold.overallStatus, 'BLOCKED_RESOLD_QR');
  assert.equal(reportResold.stages[2].stageStatus, 'RESOLD_LOCKED_ORIGIN');
  assert.equal(
    reportResold.violations.some(
      (v) =>
        v.category === 'PREVIOUSLY_SOLD_RESALE' &&
        v.detectedAtStage === 'PHARMACY' &&
        v.culpritActor === 'City Central Hospital Pharmacy'
    ),
    true
  );

  // 3. Forged QR signature scan is flagged as BLOCKED_COUNTERFEIT
  const reportForged = traceSupplyChainStageForensics(
    basePack,
    batch,
    custodyEvents,
    [telemetryWithDistDrop[1]],
    { signatureTampered: true }
  );
  assert.equal(reportForged.overallStatus, 'BLOCKED_COUNTERFEIT');
  assert.equal(reportForged.violations[0].category, 'COUNTERFEIT_QR_SIGNATURE');
});

test('buildPhoneScannableQRCertificate generates human-readable certificate, mobile web URL, and round-trips through parseQRScanInput', () => {
  const batchId = computeKeccakHex('BATCH-QR-CERT-2026');
  const serialNumber = 'SN-QRCERT-2026-0009';
  const serialHash = computeKeccakHex(serialNumber);
  const nonce = '0x9988776655443322';
  const expiresAt = '2028-12-31T00:00:00.000Z';
  const signature = signQRPayload(serialNumber, batchId, expiresAt, nonce);

  const pack: MedicinePackRecord = {
    serialNumber,
    serialHash,
    batchId,
    tokenId: 9,
    status: 'IN_TRANSIT',
    currentCustodian: 'Apex Cold-Chain Logistics',
    custodianRole: 'DISTRIBUTOR',
    lastScannedLocation: 'Chicago O’Hare Cold Hub, Chicago, IL',
    nonce,
    signature,
    scanCount: 1,
    isSuspicious: false,
  };
  const batch: BatchRecord = {
    batchId,
    batchCode: 'BATCH-QR-CERT-2026',
    productCode: '00300099999001',
    brandName: 'Comirnaty mRNA Vial',
    genericName: 'Tozinameran mRNA',
    dosageForm: 'Vial',
    strength: '30 mcg/0.3 mL',
    totalPacks: 100,
    packsRegistered: 1,
    minTemp: 2,
    maxTemp: 8,
    manufacturedAt: '2026-11-15T01:00:00.000Z',
    expiresAt,
    manufacturerName: 'Pfizer BioTech Manufacturing',
    manufacturerAddress: MANUFACTURER_PUBLIC_ADDRESS,
    isQuarantined: false,
    isRecalled: false,
    txHash: '0xtx-mfg-qr',
  };

  // 1. Human-readable Phone Certificate text has no colon URI prefix and round-trips
  const certText = buildPhoneScannableQRCertificate(pack, batch, undefined, {
    format: 'PHONE_CERTIFICATE',
  });
  assert.equal(certText.includes('MEDSUPPLY SENTINEL CERTIFICATE'), true);
  assert.equal(certText.includes(`Pack Serial: ${serialNumber}`), true);
  assert.equal(certText.includes('Medicine - Comirnaty mRNA Vial'), true);
  const parsedCert = parseQRScanInput(certText);
  assert.equal(parsedCert.serialNumber, serialNumber);
  assert.equal(parsedCert.providedSignature?.toLowerCase(), signature.toLowerCase());

  // 2. Mobile Web Link (/qr-verify) round-trips
  const webLink = buildPhoneScannableQRCertificate(pack, batch, undefined, {
    format: 'MOBILE_WEB_LINK',
    baseOriginUrl: 'http://localhost:3000',
  });
  assert.equal(webLink.startsWith('http://localhost:3000/qr-verify?serial='), true);
  const parsedWeb = parseQRScanInput(webLink);
  assert.equal(parsedWeb.serialNumber, serialNumber);
  assert.equal(parsedWeb.providedSignature?.toLowerCase(), signature.toLowerCase());
});


