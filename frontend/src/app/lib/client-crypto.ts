import { SignJWT, exportJWK, JWK } from "jose";

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

export async function createClientProof(
  method: string,
  url: string
): Promise<string> {
  const { privateKey, publicJwk } = await getOrCreateClientKey();

  const jti = crypto.randomUUID();
  const iat = Math.floor(Date.now() / 1000);

  const proof = await new SignJWT({
    jti: jti,
    htm: method,
    htu: url,
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
