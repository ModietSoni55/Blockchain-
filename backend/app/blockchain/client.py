"""
Web3 Blockchain Client Manager
Connects to local Anvil EVM node via Web3.py.
Handles transaction signing, nonces, and graceful offline fallback.
"""

import logging
from typing import Optional, Dict, Any
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from eth_account import Account

from app.config import settings

logger = logging.getLogger(__name__)


class BlockchainClient:
    def __init__(self):
        self.rpc_url = settings.BLOCKCHAIN_RPC_URL
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        self.is_connected = False
        self.operator_account = None

        try:
            self.is_connected = self.w3.is_connected()
            if self.is_connected:
                self.operator_account = Account.from_key(settings.BACKEND_OPERATOR_PRIVATE_KEY)
                logger.info(f"Connected to EVM Blockchain at {self.rpc_url}. Chain ID: {self.w3.eth.chain_id}")
            else:
                logger.warning(f"Could not connect to EVM Blockchain at {self.rpc_url}. Running in local simulation mode.")
        except Exception as e:
            logger.warning(f"Blockchain connection initialization notice: {e}")

    def check_connection(self) -> bool:
        """Returns True if local Anvil EVM node is active and reachable."""
        try:
            return self.w3.is_connected()
        except Exception:
            return False

    def send_transaction(self, tx_dict: Dict[str, Any]) -> str:
        """Signs and broadcasts a transaction using the local backend operator key."""
        if not self.check_connection() or not self.operator_account:
            # Deterministic simulated transaction hash for local offline testing
            dummy_hash = f"0xsimulated{Web3.keccak(text=str(tx_dict)).hex()[11:]}"
            return dummy_hash

        try:
            tx_dict["from"] = self.operator_account.address
            if "nonce" not in tx_dict:
                tx_dict["nonce"] = self.w3.eth.get_transaction_count(self.operator_account.address)
            if "gasPrice" not in tx_dict:
                tx_dict["gasPrice"] = self.w3.eth.gas_price

            signed_tx = self.w3.eth.account.sign_transaction(tx_dict, private_key=self.operator_account.key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            return self.w3.to_hex(tx_hash)
        except Exception as e:
            logger.error(f"Error broadcasting on-chain transaction: {e}")
            return f"0xsimulated{Web3.keccak(text=str(tx_dict)).hex()[11:]}"


blockchain_client = BlockchainClient()
