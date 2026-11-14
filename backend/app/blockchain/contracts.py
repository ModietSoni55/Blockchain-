"""
Smart Contract Interface Definitions & ABIs
Enables Python backend to invoke on-chain methods on MedSupplySentinel.
"""

from typing import Dict, Any
from app.config import settings

# ABI definitions for key functions invoked by backend
SENTINEL_ABI = [
    {
        "inputs": [
            {"internalType": "bytes32", "name": "batchId", "type": "bytes32"},
            {"internalType": "string", "name": "productCode", "type": "string"},
            {"internalType": "string", "name": "brandName", "type": "string"},
            {"internalType": "uint256", "name": "totalPackCount", "type": "uint256"},
            {"internalType": "uint256", "name": "expiresAt", "type": "uint256"},
            {"internalType": "int16", "name": "minTemp", "type": "int16"},
            {"internalType": "int16", "name": "maxTemp", "type": "int16"},
            {"internalType": "uint32", "name": "maxExcursionSeconds", "type": "uint32"}
        ],
        "name": "createBatch",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "bytes32", "name": "serialHash", "type": "bytes32"}
        ],
        "name": "verifyMedicinePack",
        "outputs": [
            {"internalType": "uint8", "name": "outcome", "type": "uint8"},
            {"internalType": "string", "name": "detail", "type": "string"},
            {
                "components": [
                    {"internalType": "bytes32", "name": "batchId", "type": "bytes32"},
                    {"internalType": "bytes32", "name": "serialHash", "type": "bytes32"},
                    {"internalType": "uint256", "name": "mintTimestamp", "type": "uint256"},
                    {"internalType": "uint256", "name": "expiryTimestamp", "type": "uint256"},
                    {"internalType": "address", "name": "currentCustodian", "type": "address"},
                    {"internalType": "uint8", "name": "status", "type": "uint8"},
                    {"internalType": "bool", "name": "exists", "type": "bool"}
                ],
                "internalType": "struct MedicinePackNFT.PackMetadata",
                "name": "pack",
                "type": "tuple"
            },
            {
                "components": [
                    {"internalType": "bytes32", "name": "batchId", "type": "bytes32"},
                    {"internalType": "string", "name": "productCode", "type": "string"},
                    {"internalType": "string", "name": "brandName", "type": "string"},
                    {"internalType": "address", "name": "manufacturer", "type": "address"},
                    {"internalType": "uint256", "name": "totalPackCount", "type": "uint256"},
                    {"internalType": "uint256", "name": "packsRegistered", "type": "uint256"},
                    {"internalType": "uint256", "name": "manufacturedAt", "type": "uint256"},
                    {"internalType": "uint256", "name": "expiresAt", "type": "uint256"},
                    {"internalType": "int16", "name": "minTemp", "type": "int16"},
                    {"internalType": "int16", "name": "maxTemp", "type": "int16"},
                    {"internalType": "bool", "name": "exists", "type": "bool"}
                ],
                "internalType": "struct MedSupplySentinel.Batch",
                "name": "batch",
                "type": "tuple"
            },
            {"internalType": "uint32", "name": "scanCount", "type": "uint32"},
            {"internalType": "bool", "name": "coldChainBreached", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
    }
]

ORACLE_ABI = [
    {
        "inputs": [
            {"internalType": "bytes32", "name": "batchId", "type": "bytes32"},
            {"internalType": "int16", "name": "temperature", "type": "int16"},
            {"internalType": "uint16", "name": "humidity", "type": "uint16"},
            {"internalType": "int32", "name": "latitude", "type": "int32"},
            {"internalType": "int32", "name": "longitude", "type": "int32"},
            {"internalType": "uint256", "name": "timestamp", "type": "uint256"},
            {"internalType": "string", "name": "deviceId", "type": "string"}
        ],
        "name": "recordTelemetry",
        "outputs": [
            {"internalType": "bool", "name": "breachOccurred", "type": "bool"}
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]
