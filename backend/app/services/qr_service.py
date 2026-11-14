"""
QR Code Generation & Cryptographic Attestation Service
Generates local QR codes using the free Python qrcode and Pillow libraries.
Zero paid cloud services.
"""

import io
import base64
import json
import time
from typing import Tuple, Optional, Dict, Any
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer
from qrcode.image.styles.colormasks import SolidFillColorMask

from app.security.crypto import (
    hash_serial,
    generate_secure_nonce,
    sign_qr_payload,
    verify_qr_payload_signature
)


class QRService:
    @staticmethod
    def generate_pack_qr_data(
        serial_number: str,
        batch_id: str,
        expiry_timestamp: int
    ) -> Tuple[str, str, str, str, str]:
        """
        Creates a signed cryptographic QR twin for a medicine pack.
        Returns:
            (serial_hash, nonce, signature, json_payload, base64_image_data_uri)
        """
        serial_hash = hash_serial(serial_number)
        nonce = generate_secure_nonce()
        issued_at = int(time.time())

        # Generate HMAC-SHA256 signature
        signature = sign_qr_payload(
            serial_hash=serial_hash,
            batch_id=batch_id,
            expiry_timestamp=expiry_timestamp,
            nonce=nonce,
            issued_at=issued_at
        )

        # Minified payload for compact QR code rendering
        payload_dict = {
            "sn": serial_number,
            "sh": serial_hash,
            "bid": batch_id,
            "exp": expiry_timestamp,
            "n": nonce,
            "iat": issued_at,
            "sig": signature
        }
        json_payload = json.dumps(payload_dict, separators=(",", ":"))

        # Generate QR code image
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(json_payload)
        qr.make(fit=True)

        img = qr.make_image(
            fill_color="#0f172a", # Slate-900
            back_color="#ffffff"
        )

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        encoded_img = base64.b64encode(buffer.getvalue()).decode("utf-8")
        data_uri = f"data:image/png;base64,{encoded_img}"

        return serial_hash, nonce, signature, json_payload, data_uri

    @staticmethod
    def parse_and_validate_payload(raw_payload: str) -> Optional[Dict[str, Any]]:
        """
        Parses a scanned QR payload and validates its cryptographic integrity.
        """
        try:
            data = json.loads(raw_payload)
            required_keys = ["sn", "sh", "bid", "exp", "n", "iat", "sig"]
            if not all(k in data for k in required_keys):
                return None

            # Verify cryptographic signature
            is_valid = verify_qr_payload_signature(
                serial_hash=data["sh"],
                batch_id=data["bid"],
                expiry_timestamp=int(data["exp"]),
                nonce=data["n"],
                issued_at=int(data["iat"]),
                provided_signature=data["sig"]
            )

            if not is_valid:
                return None

            return data
        except Exception:
            return None


qr_service = QRService()
