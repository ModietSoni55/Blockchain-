"""
IoT Cold-Chain Telemetry Processing Service
"""

from typing import Tuple, Optional
from datetime import datetime
from app.models.batch import Batch
from app.models.telemetry import TelemetryReading


class TelemetryService:
    @staticmethod
    def evaluate_reading(
        batch: Batch,
        temperature: float
    ) -> Tuple[bool, Optional[str]]:
        """
        Evaluates a temperature reading against safe threshold limits.
        Returns: (is_breached, breach_type)
        """
        if temperature < batch.min_temp:
            return True, "SUBCOOLING"
        elif temperature > batch.max_temp:
            return True, "OVERHEATING"
        return False, None


telemetry_service = TelemetryService()
