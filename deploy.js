const hre = require("hardhat");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// $BANKR token address on Base mainnet
// Verify at: https://basescan.org/token/0x...
const BANKR_TOKEN_ADDRESS = process.env.BANKR_TOKEN_ADDRESS || "0x0000000000000000000000000000000000000000";

// Your platform wallet that receives fees
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || "0x0000000000000000000000000000000000000000";
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  BANKRMINT — Deploy Script");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Deployer:        ", deployer.address);
  console.log("Network:         ", hre.network.name);
  console.log("BANKR Token:     ", BANKR_TOKEN_ADDRESS);
  console.log("Platform Wallet: ", PLATFORM_WALLET);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (
    BANKR_TOKEN_ADDRESS === "0x0000000000000000000000000000000000000000" ||
    PLATFORM_WALLET     === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("Set BANKR_TOKEN_ADDRESS and PLATFORM_WALLET in .env before deploying!");
  }

  // Deploy Factory
  console.log("Deploying BANKRFactory...");
  const Factory = await hre.ethers.getContractFactory("BANKRFactory");
  const factory = await Factory.deploy(BANKR_TOKEN_ADDRESS, PLATFORM_WALLET);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("✅ BANKRFactory deployed to:", factoryAddress);

  // Verify on Basescan (wait a few blocks first)
  if (hre.network.name !== "hardhat") {
    console.log("\nWaiting 10 blocks for Basescan indexing...");
    await new Promise(r => setTimeout(r, 15000));

    try {
      await hre.run("verify:verify", {
        address: factoryAddress,
        constructorArguments: [BANKR_TOKEN_ADDRESS, PLATFORM_WALLET],
      });
      console.log("✅ Contract verified on Basescan");
    } catch (e) {
      console.log("⚠️  Verification failed (may already be verified):", e.message);
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Factory Address:", factoryAddress);
  console.log("\nNext steps:");
  console.log("1. Copy FACTORY_ADDRESS to your .env");
  console.log("2. Start the backend API: cd api && npm run dev");
  console.log("3. Set NEXT_PUBLIC_FACTORY_ADDRESS in frontend/.env");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
