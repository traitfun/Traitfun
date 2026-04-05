# ⚡ BANKRMINT — AI NFT Launchpad on Base

> Creator writes prompt → pays $BANKR → AI generates 1,000 unique NFTs → buyers mint with tiered pricing

---

## 🏗️ Architecture

```
bankrmint/
├── contracts/
│   ├── BANKRFactory.sol      ← Creator deploys collections here (pays 60 $BANKR)
│   └── BANKRCollection.sol   ← Each collection: 1000 NFTs, price +1 $BANKR per mint
├── scripts/
│   └── deploy.js             ← Deploy factory to Base
├── api/
│   └── server.js             ← Backend: AI generation + IPFS upload + reveal
├── frontend/
│   └── bankrmint-dapp.html   ← Full Web3 UI
└── .env.example
```

---

## 🔄 Full Flow

```
CREATOR FLOW:
  1. Creator connects wallet (Base network)
  2. Writes AI prompt (e.g. "cyberpunk samurai in neon Tokyo")
  3. Sets collection name + royalty %
  4. Approves 60 $BANKR → calls factory.deployCollection()
  5. Factory deploys BANKRCollection contract
  6. Backend detects CollectionDeployed event
  7. Backend calls Replicate API → generates 1000 unique images
  8. Images + metadata uploaded to IPFS via Pinata
  9. Backend calls revealMetadata() on contract with IPFS CID
  10. Collection goes live for buyers!

BUYER FLOW:
  1. Buyer browses collections
  2. Connects wallet, approves currentPrice() $BANKR
  3. Calls collection.mint()
  4. Gets NFT — price increases by 1 $BANKR for next buyer
  5. Creator earns 95% of mint price, platform takes 5%
```

---

## 🚀 Setup & Deploy

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values
```

Required .env values:
| Key | Where to get |
|-----|-------------|
| `DEPLOYER_PRIVATE_KEY` | Your wallet private key |
| `PLATFORM_WALLET` | Your fee-receiving wallet address |
| `BANKR_TOKEN_ADDRESS` | $BANKR token on Base (ask BANKR team) |
| `REPLICATE_API_TOKEN` | https://replicate.com |
| `PINATA_API_KEY` + `PINATA_SECRET_KEY` | https://app.pinata.cloud |
| `BASESCAN_API_KEY` | https://basescan.org/myapikey |

### 3. Deploy to Base Sepolia (testnet first!)
```bash
npm run deploy:testnet
```

### 4. Deploy to Base Mainnet
```bash
npm run deploy:mainnet
```

### 5. Copy factory address to .env
```
FACTORY_ADDRESS=0xYourDeployedFactoryAddress
```

### 6. Start backend API
```bash
npm run api
# or for dev with auto-reload:
npm run api:dev
```

### 7. Open frontend
Open `frontend/bankrmint-dapp.html` in browser  
*(or host it on Vercel/Netlify)*

Update these constants in the frontend HTML:
```js
const FACTORY_ADDRESS = "0xYourFactory";
const BANKR_TOKEN_ADDRESS = "0xBANKRToken";
const API_BASE_URL = "https://your-api.com";
```

---

## 💰 Economics

| Action | Cost |
|--------|------|
| Creator launches collection | 60 $BANKR |
| NFT #1 mint price | 1 $BANKR |
| NFT #500 mint price | 500 $BANKR |
| NFT #1000 mint price | 1,000 $BANKR |
| Total if all 1000 minted | 500,500 $BANKR |
| Platform fee per mint | 5% |
| Creator earnings (if all minted) | ~475,475 $BANKR |
| AI generation cost (Replicate) | ~$2.30 per collection |

---

## 🔑 Smart Contract Functions

### BANKRFactory
```solidity
deployCollection(name, symbol, prompt, royaltyBps) → address
totalCollections() → uint256
getCollections(offset, limit) → address[]
```

### BANKRCollection
```solidity
mint() external                         // buyer calls this
currentPrice() view → uint256           // price in $BANKR (18 decimals)
totalMinted() view → uint256
revealMetadata(baseURI) external        // platform calls after AI gen
```

---

## 🌐 API Endpoints

```
POST /api/generate
  Body: { collectionAddress, prompt }
  Returns: { jobId }

GET /api/status/:jobId
  Returns: { status, progress, total, ipfsCID }

GET /api/collections?limit=20&offset=0
  Returns: { total, collections[] }

GET /api/collection/:address
  Returns: collection detail object
```

---

## 🔒 Security Notes

- Platform private key should be a dedicated hot wallet, not your main wallet
- Consider using a multisig (Safe) for the platform wallet
- Add rate limiting to the API before going to production
- The `revealMetadata` function can only be called once, by the platform wallet
- Consider adding a time delay before reveal to prevent front-running

---

## 📦 Tech Stack

| Layer | Tech |
|-------|------|
| Blockchain | Base (L2 on Ethereum) |
| Smart Contracts | Solidity 0.8.20 + OpenZeppelin |
| Dev Framework | Hardhat |
| AI Generation | Replicate (SDXL) |
| IPFS Storage | Pinata |
| Backend API | Node.js + Express |
| Frontend | Vanilla JS + ethers.js v6 |
| Token | $BANKR (ERC-20 on Base) |
