/**
 * BANKRMINT Backend API
 * 
 * Handles:
 *  POST /api/generate    — trigger AI image generation for a new collection
 *  GET  /api/collections — list all collections with on-chain data
 *  GET  /api/collection/:address — get single collection detail
 *  GET  /api/status/:jobId — check generation job status
 * 
 * Stack: Express · Replicate (AI) · Pinata (IPFS) · ethers.js
 */

const express     = require("express");
const cors        = require("cors");
const multer      = require("multer");
const { ethers }  = require("ethers");
const Replicate   = require("replicate");
const pinataSDK   = require("@pinata/sdk");
const fs          = require("fs");
const path        = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app    = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

// ─── Clients ──────────────────────────────────────────────────────────────────
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const pinata    = new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY);

// ─── Blockchain ───────────────────────────────────────────────────────────────
const provider  = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || "https://mainnet.base.org");
const wallet    = new ethers.Wallet(process.env.PLATFORM_PRIVATE_KEY, provider);

const FACTORY_ABI = [
  "function isCollection(address) view returns (bool)",
  "function allCollections(uint256) view returns (address)",
  "function totalCollections() view returns (uint256)",
  "event CollectionDeployed(address indexed collection, address indexed creator, string name, string prompt)",
];

const COLLECTION_ABI = [
  "function collectionName() view returns (string)",
  "function prompt() view returns (string)",
  "function creator() view returns (address)",
  "function totalMinted() view returns (uint256)",
  "function currentPrice() view returns (uint256)",
  "function royaltyBps() view returns (uint256)",
  "function metadataRevealed() view returns (bool)",
  "function revealMetadata(string calldata baseURI) external",
];

const factory = new ethers.Contract(
  process.env.FACTORY_ADDRESS,
  FACTORY_ABI,
  wallet
);

// ─── In-memory job store (use Redis in production) ───────────────────────────
const jobs = new Map();

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/generate
 * Body: { collectionAddress, prompt, referenceImageBase64? }
 * 
 * 1. Verifies collection is from our factory
 * 2. Queues background job to generate 1000 images
 * 3. Returns jobId immediately
 */
app.post("/api/generate", upload.single("referenceImage"), async (req, res) => {
  try {
    const { collectionAddress, prompt } = req.body;

    if (!collectionAddress || !prompt) {
      return res.status(400).json({ error: "collectionAddress and prompt required" });
    }

    // Verify it's a legit collection from our factory
    const isValid = await factory.isCollection(collectionAddress);
    if (!isValid) {
      return res.status(403).json({ error: "Collection not from BANKRFactory" });
    }

    // Check not already revealed
    const col = new ethers.Contract(collectionAddress, COLLECTION_ABI, provider);
    const revealed = await col.metadataRevealed();
    if (revealed) {
      return res.status(400).json({ error: "Metadata already revealed" });
    }

    // Create job
    const jobId = uuidv4();
    jobs.set(jobId, {
      status: "pending",
      collectionAddress,
      prompt,
      progress: 0,
      total: 1000,
      ipfsCID: null,
      error: null,
      createdAt: Date.now(),
    });

    // Fire and forget — run generation in background
    generateCollection(jobId, collectionAddress, prompt, req.file).catch(err => {
      const job = jobs.get(jobId);
      if (job) { job.status = "failed"; job.error = err.message; }
      console.error("Generation failed:", err);
    });

    res.json({ jobId, message: "Generation started" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/status/:jobId
 * Returns job status and progress
 */
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

/**
 * GET /api/collections
 * Returns all collections with on-chain metadata
 */
app.get("/api/collections", async (req, res) => {
  try {
    const total = Number(await factory.totalCollections());
    const limit  = Math.min(parseInt(req.query.limit  || 20), 50);
    const offset = parseInt(req.query.offset || 0);

    const collections = [];
    for (let i = offset; i < Math.min(offset + limit, total); i++) {
      const addr = await factory.allCollections(i);
      try {
        const data = await getCollectionData(addr);
        collections.push(data);
      } catch (e) {
        console.error(`Failed to fetch collection ${addr}:`, e.message);
      }
    }

    res.json({ total, collections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/collection/:address
 */
app.get("/api/collection/:address", async (req, res) => {
  try {
    const data = await getCollectionData(req.params.address);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Core: AI Generation Pipeline ────────────────────────────────────────────

async function generateCollection(jobId, collectionAddress, prompt, referenceFile) {
  const job = jobs.get(jobId);
  job.status = "generating";

  const outputDir = path.join(__dirname, "tmp", jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const metadataDir = path.join(outputDir, "metadata");
  fs.mkdirSync(metadataDir, { recursive: true });

  const imagesDir = path.join(outputDir, "images");
  fs.mkdirSync(imagesDir, { recursive: true });

  console.log(`[${jobId}] Starting generation of 1000 images for: "${prompt}"`);

  // ── Step 1: Generate images in batches ──────────────────────────
  // Replicate SDXL can do 1 image per call.
  // In production: use batch APIs or parallel workers for speed.
  // For cost: ~$0.0023/image × 1000 = ~$2.30 per collection.

  const traits = generateTraitVariations(1000); // Generate unique traits per NFT

  for (let i = 1; i <= 1000; i++) {
    const trait = traits[i - 1];
    const enhancedPrompt = `${prompt}, ${trait.style}, ${trait.mood}, high quality, detailed, 4k`;

    try {
      // Call Replicate SDXL
      const output = await replicate.run(
        "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        {
          input: {
            prompt: enhancedPrompt,
            negative_prompt: "blurry, low quality, watermark, text, ugly",
            width: 1024,
            height: 1024,
            num_inference_steps: 25,
            guidance_scale: 7.5,
            seed: i * 42, // deterministic seed per token
          },
        }
      );

      // Download image
      const imageUrl  = Array.isArray(output) ? output[0] : output;
      const response  = await fetch(imageUrl);
      const buffer    = Buffer.from(await response.arrayBuffer());
      const imagePath = path.join(imagesDir, `${i}.png`);
      fs.writeFileSync(imagePath, buffer);

      // Write ERC-721 metadata JSON
      const metadata = {
        name:        `#${i}`,
        description: `${prompt} — NFT #${i} of 1000`,
        image:       `PLACEHOLDER_${i}`, // replaced after IPFS image upload
        attributes: [
          { trait_type: "Style",    value: trait.style },
          { trait_type: "Mood",     value: trait.mood },
          { trait_type: "Rarity",   value: trait.rarity },
          { trait_type: "Edition",  value: i },
        ],
      };
      fs.writeFileSync(
        path.join(metadataDir, `${i}.json`),
        JSON.stringify(metadata, null, 2)
      );

      job.progress = i;
      console.log(`[${jobId}] Generated ${i}/1000`);

    } catch (err) {
      console.error(`[${jobId}] Failed image ${i}:`, err.message);
      // Use placeholder on failure (don't stop whole job)
      job.progress = i;
    }

    // Small delay to avoid rate limiting
    if (i % 10 === 0) await sleep(500);
  }

  // ── Step 2: Upload images folder to IPFS via Pinata ─────────────
  job.status = "uploading_images";
  console.log(`[${jobId}] Uploading images to IPFS...`);

  const imagesCID = await pinata.pinFromFS(imagesDir, {
    pinataMetadata: { name: `bankrmint-${collectionAddress}-images` },
  });

  console.log(`[${jobId}] Images CID: ${imagesCID.IpfsHash}`);

  // ── Step 3: Update metadata JSONs with real IPFS image URLs ─────
  for (let i = 1; i <= 1000; i++) {
    const metaPath = path.join(metadataDir, `${i}.json`);
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath));
    meta.image = `ipfs://${imagesCID.IpfsHash}/${i}.png`;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  // ── Step 4: Upload metadata folder to IPFS ──────────────────────
  job.status = "uploading_metadata";
  console.log(`[${jobId}] Uploading metadata to IPFS...`);

  const metaCID = await pinata.pinFromFS(metadataDir, {
    pinataMetadata: { name: `bankrmint-${collectionAddress}-metadata` },
  });

  const baseURI = `ipfs://${metaCID.IpfsHash}/`;
  console.log(`[${jobId}] Metadata CID: ${metaCID.IpfsHash}`);

  // ── Step 5: Call revealMetadata on the smart contract ───────────
  job.status = "revealing";
  console.log(`[${jobId}] Calling revealMetadata on contract...`);

  const col = new ethers.Contract(collectionAddress, COLLECTION_ABI, wallet);
  const tx  = await col.revealMetadata(baseURI);
  await tx.wait();

  console.log(`[${jobId}] ✅ Metadata revealed! TX: ${tx.hash}`);

  // ── Cleanup ─────────────────────────────────────────────────────
  fs.rmSync(outputDir, { recursive: true, force: true });

  job.status   = "complete";
  job.ipfsCID  = metaCID.IpfsHash;
  job.progress = 1000;
  job.txHash   = tx.hash;
}

// ─── Trait Generation ────────────────────────────────────────────────────────

function generateTraitVariations(count) {
  const styles = [
    "cinematic lighting", "golden hour", "neon glow", "dark atmosphere",
    "vibrant colors", "pastel palette", "monochromatic", "iridescent",
    "holographic", "oil painting style", "watercolor", "digital art",
    "comic book style", "photorealistic", "surrealist", "minimalist",
  ];
  const moods = [
    "epic", "mysterious", "playful", "serene", "fierce", "ethereal",
    "nostalgic", "futuristic", "ancient", "cosmic", "chaotic", "peaceful",
    "menacing", "joyful", "melancholic", "triumphant",
  ];
  const rarities = ["Common", "Common", "Common", "Common",
                    "Uncommon", "Uncommon", "Uncommon",
                    "Rare", "Rare", "Epic", "Legendary"];

  return Array.from({ length: count }, (_, i) => ({
    style:  styles[Math.floor(Math.random() * styles.length)],
    mood:   moods[Math.floor(Math.random() * moods.length)],
    rarity: rarities[Math.floor(Math.random() * rarities.length)],
  }));
}

// ─── Collection Data Helper ───────────────────────────────────────────────────

async function getCollectionData(address) {
  const col = new ethers.Contract(address, COLLECTION_ABI, provider);
  const [name, prompt, creator, totalMinted, currentPrice, royaltyBps, metadataRevealed] =
    await Promise.all([
      col.collectionName(),
      col.prompt(),
      col.creator(),
      col.totalMinted(),
      col.currentPrice(),
      col.royaltyBps(),
      col.metadataRevealed(),
    ]);

  return {
    address,
    name,
    prompt,
    creator,
    totalMinted:      Number(totalMinted),
    currentPrice:     ethers.formatEther(currentPrice),
    royaltyPercent:   Number(royaltyBps) / 100,
    metadataRevealed,
    supply:           1000,
    remaining:        1000 - Number(totalMinted),
  };
}

// ─── Utils ────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 BANKRMINT API running on port ${PORT}`);
  console.log(`   Factory: ${process.env.FACTORY_ADDRESS || "NOT SET"}`);
  console.log(`   Network: ${process.env.BASE_RPC_URL || "https://mainnet.base.org"}\n`);
});

module.exports = app;
