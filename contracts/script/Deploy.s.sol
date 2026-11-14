// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/MedicinePackNFT.sol";
import "../src/ColdChainOracle.sol";
import "../src/QRAttestation.sol";
import "../src/RegulatorGovernance.sol";
import "../src/MedSupplySentinel.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "ANVIL_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );

        address deployer = vm.addr(deployerPrivateKey);

        // Pre-configured Anvil accounts for zero-friction demo testing
        address manufacturer = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // Anvil #1
        address distributor  = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // Anvil #2
        address pharmacy     = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // Anvil #3
        address regulator    = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65; // Anvil #4

        vm.startBroadcast(deployerPrivateKey);

        console.log("--------------------------------------------------");
        console.log("Deploying MedSupply Sentinel Core Contracts...");
        console.log("Deployer Address:", deployer);

        // 1. Deploy Subordinate Contracts
        MedicinePackNFT packNFT = new MedicinePackNFT(deployer);
        console.log("MedicinePackNFT deployed at:", address(packNFT));

        ColdChainOracle oracle = new ColdChainOracle(deployer);
        console.log("ColdChainOracle deployed at:", address(oracle));

        QRAttestation qrAttestation = new QRAttestation(deployer);
        console.log("QRAttestation deployed at:", address(qrAttestation));

        RegulatorGovernance regulatorGov = new RegulatorGovernance(deployer);
        console.log("RegulatorGovernance deployed at:", address(regulatorGov));

        // 2. Deploy Master Sentinel Contract
        MedSupplySentinel sentinel = new MedSupplySentinel(
            deployer,
            address(packNFT),
            address(oracle),
            address(qrAttestation),
            address(regulatorGov)
        );
        console.log("MedSupplySentinel deployed at:", address(sentinel));

        // 3. Configure Inter-Contract Authorizations
        packNFT.grantRole(packNFT.MINTER_ROLE(), address(sentinel));
        packNFT.grantRole(packNFT.CONTROLLER_ROLE(), address(sentinel));
        oracle.grantRole(oracle.ORACLE_ROLE(), address(sentinel));

        // 4. Provision Participant Roles for Hackathon Demo Actors
        sentinel.grantRole(sentinel.MANUFACTURER_ROLE(), manufacturer);
        sentinel.grantRole(sentinel.DISTRIBUTOR_ROLE(), distributor);
        sentinel.grantRole(sentinel.PHARMACY_ROLE(), pharmacy);
        sentinel.grantRole(sentinel.REGULATOR_ROLE(), regulator);

        regulatorGov.grantRole(regulatorGov.REGULATOR_ROLE(), regulator);
        oracle.grantRole(oracle.REPORTER_ROLE(), deployer);
        qrAttestation.grantRole(qrAttestation.ISSUER_ROLE(), deployer);
        qrAttestation.grantRole(qrAttestation.ISSUER_ROLE(), manufacturer);

        console.log("Role permissions configured successfully.");
        console.log("--------------------------------------------------");

        vm.stopBroadcast();
    }
}
