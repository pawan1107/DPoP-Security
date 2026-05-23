import { SignJWT, exportJWK, JWK } from "jose";
import { instantBotCheck, getBotSignal } from "./anti-bot";

const DB_NAME = "DPoP_Store";
const STORE_NAME = "keys";
const KEY_ID = "dpop_device_key";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getKeyPairFromDB(): Promise<{privateKey: CryptoKey, publicKey: CryptoKey} | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(KEY_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveKeyPairToDB(keys: {privateKey: CryptoKey, publicKey: CryptoKey}): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(keys, KEY_ID);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getOrCreateClientKey(): Promise<{
  privateKey: CryptoKey;
  publicJwk: JWK;
}> {
  // ⛔ GATE: Run instant bot checks BEFORE generating any cryptographic keys.
  // If a bot is detected, refuse to create a device identity.
  const botReasons = instantBotCheck();
  if (botReasons.length > 0) {
    throw new Error(`🚫 Bot detected (${botReasons.join(", ")}). Device key generation blocked.`);
  }

  let keys = await getKeyPairFromDB();

  if (!keys) {
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false, // non-extractable! The private key cannot physically leave the browser.
      ["sign", "verify"]
    );
    keys = { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
    await saveKeyPairToDB(keys);
  }

  // Export public key to JWK
  const jwk = await exportJWK(keys.publicKey);
  const publicJwk = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  
  return { privateKey: keys.privateKey, publicJwk };
}

async function generateProofOfWork(difficulty: number = 3): Promise<{ nonce: number; hash: string }> {
  // A simple Hashcash-style PoW. We find a nonce such that SHA-256(timestamp + nonce)
  // starts with `difficulty` number of zeros.
  const prefix = "0".repeat(difficulty);
  const timestamp = Date.now().toString();
  let nonce = 0;
  
  while (true) {
    const data = new TextEncoder().encode(`${timestamp}:${nonce}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (hashHex.startsWith(prefix)) {
      return { nonce, hash: hashHex };
    }
    nonce++;
  }
}

export async function createClientProof(
  method: string,
  url: string
): Promise<string> {
  const { privateKey, publicJwk } = await getOrCreateClientKey();

  const jti = crypto.randomUUID();
  const iat = Math.floor(Date.now() / 1000);

  // Covertly embed bot detection signal inside the signed JWT.
  // Claim names are intentionally innocuous ("_v" = version, "_c" = client config)
  // so a bot operator inspecting network traffic won't recognize them.
  // Since the JWT is signed, the bot cannot tamper with these values after signing.
  const botSignal = getBotSignal();

  // Generate a Proof of Work to burn botnet CPU cycles
  // In a real app, you might only require PoW on device registration or login
  const pow = await generateProofOfWork(3); // Require 3 leading zeros (takes ~1-50ms)

  const proof = await new SignJWT({
    jti: jti,
    htm: method,
    htu: url,
    _v: botSignal.score,   // 0 = clean human, >0 = suspicious
    _c: botSignal.flags,   // encoded detection reasons
    _pow: pow.nonce,       // The valid nonce the bot had to spend CPU cycles to find
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicJwk })
    .setIssuedAt(iat)
    .sign(privateKey);

  return proof;
}

export async function clearClientKey(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(KEY_ID);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
