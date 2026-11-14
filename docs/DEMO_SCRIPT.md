# MedSupply Sentinel — 3-Minute Hackathon Demo Script & Judge Q&A

## ⏱️ 3-Minute Live Competition Pitch Flow

1. **0:00 – 0:30 | The Problem & Vision**
   - Counterfeit drugs represent a $200B illicit market and cold-chain excursions spoil 20%+ of temperature-sensitive biologics.
   - Introduce **MedSupply Sentinel**: 100% open-source EVM blockchain traceability + HMAC-signed QR codes + Cold-Chain IoT Oracle + local Scikit-Learn AI Risk Engine.

2. **0:30 – 1:15 | Step 1: Manufacturer Batch Genesis & Pack Serialization**
   - Switch to **Supply Chain Ops → Manufacturer**.
   - Create a new batch (e.g., `BATCH-MRNA-2026`, `Comirnaty Biologic`, `2.0°C to 8.0°C`) and click **Register Batch on Smart Contract**.
   - Click **Dispatch to Distributor**, then switch to **Distributor** and click **Deliver to Pharmacy** to demonstrate full multi-party custody handovers.

3. **1:15 – 2:00 | Step 2: Patient QR Verification & Duplicate Scan Fraud Detection**
   - Switch to **QR Verification**.
   - Click **Scan Authentic Pack (SN-0001)** → Displays `AUTHENTIC`, Risk Score `0.0 / 100 (LOW)`, and the complete 3-step custody provenance trail.
   - Click **Verify Pack Authenticity** a second time on the same serial → Immediately flags `SUSPICIOUS DUPLICATE` and raises the AI Counterfeit Risk Score with feature importance breakdown.

4. **2:00 – 2:40 | Step 3: Cold-Chain IoT Excursion & Regulator Emergency Quarantine**
   - Switch to **Cold-Chain IoT** and click **Simulate 14.8°C Excursion Breach** → `ColdChainOracle.sol` logs an `OVERHEATING` breach.
   - Switch to **Regulator Portal** and click **Quarantine Batch** on `BATCH-PCV-2026`.
   - Return to **QR Verification** and scan `SN-PCV20-2026-0001` → Status immediately locks to `QUARANTINED` with a `CRITICAL` AI risk warning.

5. **2:40 – 3:00 | Closing Differentiators**
   - Highlight zero cloud API dependency: runs 100% offline/locally with Anvil, Foundry, FastAPI, SQLite, and Scikit-Learn.

---

## ⚖️ Judge Q&A Answers

### Q1: What prevents a counterfeiter from simply copying a valid QR code onto 1,000 fake boxes?
**Answer**: Every QR code contains an HMAC-SHA256 / ECDSA signature bound to a unique `serial_hash` and `nonce`. First, `QRAttestation.sol` and our backend increment the immutable `scan_count` on every scan—if a code is scanned across multiple locations or more than once prior to dispensing, the AI Risk Engine flags `SUSPICIOUS_DUPLICATE`. Second, once a pharmacist dispenses the pack (`dispenseToPatient`), its ERC-721 passport transitions permanently to `DISPENSED`. Any subsequent scan of a cloned box immediately triggers an `ALREADY_DISPENSED` fraud alert.

### Q2: Why use a blockchain instead of a centralized SQL database?
**Answer**: Pharmaceutical supply chains span mutually untrusted actors across borders (contract manufacturers, 3PL cold-chain carriers, regional wholesalers, hospital pharmacies, and national regulators). A single centralized operator creates a single point of tampering or censorship. Our EVM smart contracts (`MedSupplySentinel.sol`, `RegulatorGovernance.sol`) enforce role-based access control (`AccessControl`) and soulbound ERC-721 custody transitions (`MedicinePackNFT.sol`) that no single participant can retroactively alter.

### Q3: Does your AI engine require expensive OpenAI/Gemini API credits?
**Answer**: No. In strict compliance with zero-cost, offline-ready operation, our AI engine uses local Python `scikit-learn` (`RandomForestClassifier` + `IsolationForest`) alongside deterministic domain rules. It executes in sub-millisecond latency on CPU and outputs human-readable feature importance weights.
