#!/usr/bin/env python3
"""
MedSupply Sentinel - Standalone Cold-Chain IoT Telemetry Simulator
Streams realistic DHT22 temperature, relative humidity, and GPS coordinates
to the FastAPI backend (/api/v1/distributor/telemetry).
Supports normal mode and excursion breach injection (--breach).
"""

import argparse
import random
import time
import requests

DEFAULT_API_URL = "http://localhost:8000/api/v1/distributor/telemetry"
DEFAULT_BATCH_ID = "0x8fa30d418e5b4b1a7d65c3e0984a123f124567890abcdef1234567890abcdef1"


def simulate_telemetry(api_url: str, batch_id: str, count: int, inject_breach: bool) -> None:
    print(f"[IoT Daemon] Starting telemetry stream for batch: {batch_id}")
    waypoints = [
        (42.2917, -85.5872, "Kalamazoo Manufacturing Vault"),
        (41.8781, -87.6298, "Chicago Cold-Storage Hub"),
        (41.4993, -81.6944, "Cleveland Transit Corridor I-90"),
        (42.3601, -71.0589, "Boston Medical Receiving Dock"),
    ]

    for i in range(count):
        lat, lon, label = waypoints[i % len(waypoints)]
        if inject_breach and i == count - 1:
            temp = round(random.uniform(13.5, 16.2), 2)
            humidity = round(random.uniform(66.0, 74.0), 1)
            print(f"[IoT Daemon] ⚠️ Injecting thermal excursion reading: {temp}°C at {label}")
        else:
            temp = round(random.uniform(3.2, 6.4), 2)
            humidity = round(random.uniform(51.0, 58.0), 1)

        payload = {
            "batch_id": batch_id,
            "temperature": temp,
            "humidity": humidity,
            "latitude": lat,
            "longitude": lon,
            "device_id": "IOT-DHT22-RIG-01",
        }

        try:
            res = requests.post(api_url, json=payload, timeout=5)
            if res.status_code == 200:
                data = res.json()
                status_str = "BREACH" if data.get("is_breached") else "SAFE"
                print(f"  -> [{status_str}] {temp}°C | {humidity}% RH | {label}")
            else:
                print(f"  -> HTTP {res.status_code}: {res.text}")
        except Exception as exc:
            print(f"  -> [Offline Simulation] {temp}°C | {humidity}% RH ({exc})")

        time.sleep(0.5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MedSupply Sentinel IoT Cold-Chain Simulator")
    parser.add_argument("--api", default=DEFAULT_API_URL, help="Telemetry API endpoint")
    parser.add_argument("--batch", default=DEFAULT_BATCH_ID, help="Target batch ID")
    parser.add_argument("--count", type=int, default=4, help="Number of readings to emit")
    parser.add_argument("--breach", action="store_true", help="Inject an overheating breach")
    args = parser.parse_args()

    simulate_telemetry(args.api, args.batch, args.count, args.breach)
