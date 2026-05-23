/**
 * DPoP Signature Verification Benchmark
 * Tests: How much CPU load does verifying 1000 ECDSA signatures take?
 * 
 * Uses ONLY Node.js built-in crypto — zero external dependencies.
 */

const crypto = require('crypto');

const TOTAL_REQUESTS = 1000;

function generateKeyPair() {
  return crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function signPayload(privateKey, payload) {
  const sign = crypto.createSign('SHA256');
  sign.update(payload);
  return sign.sign(privateKey);
}

function verifySignature(publicKey, payload, signature) {
  const verify = crypto.createVerify('SHA256');
  verify.update(payload);
  return verify.verify(publicKey, signature);
}

function runBenchmark() {
  console.log(`\n🔐 ECDSA P-256 Signature Verification Benchmark`);
  console.log(`   Simulating ${TOTAL_REQUESTS} concurrent DPoP verifications...\n`);

  // Step 1: Generate unique key pairs (simulating different devices)
  console.log(`⏳ Generating ${TOTAL_REQUESTS} unique device key pairs...`);
  const genStart = performance.now();
  const keys = [];
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    keys.push(generateKeyPair());
  }
  const genTime = performance.now() - genStart;
  console.log(`✅ Key generation: ${genTime.toFixed(1)}ms total (${(genTime / TOTAL_REQUESTS).toFixed(3)}ms per key)\n`);

  // Step 2: Sign payloads (simulating clients creating DPoP proofs)
  console.log(`⏳ Signing ${TOTAL_REQUESTS} payloads...`);
  const payloads = [];
  const signatures = [];
  const signStart = performance.now();
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const payload = JSON.stringify({
      jti: crypto.randomUUID(),
      htm: 'POST',
      htu: 'http://localhost:5083/graphql',
      iat: Math.floor(Date.now() / 1000),
    });
    payloads.push(payload);
    signatures.push(signPayload(keys[i].privateKey, payload));
  }
  const signTime = performance.now() - signStart;
  console.log(`✅ Signing: ${signTime.toFixed(1)}ms total (${(signTime / TOTAL_REQUESTS).toFixed(3)}ms per sign)\n`);

  // Step 3: Verify all 1000 signatures (THIS is what the middleware does on every request)
  console.log(`⏳ Verifying ${TOTAL_REQUESTS} ECDSA signatures (simulating middleware under load)...`);
  const cpuBefore = process.cpuUsage();
  const verifyStart = performance.now();

  let allValid = true;
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const valid = verifySignature(keys[i].publicKey, payloads[i], signatures[i]);
    if (!valid) allValid = false;
  }

  const verifyTime = performance.now() - verifyStart;
  const cpuAfter = process.cpuUsage(cpuBefore);

  console.log(`\n${'='.repeat(55)}`);
  console.log(`  RESULTS: ${TOTAL_REQUESTS} ECDSA P-256 Signature Verifications`);
  console.log(`${'='.repeat(55)}`);
  console.log(`  All Signatures Valid: ${allValid ? '✅ YES' : '❌ NO'}`);
  console.log(`  Total Wall Time:      ${verifyTime.toFixed(1)}ms`);
  console.log(`  Per Request:          ${(verifyTime / TOTAL_REQUESTS).toFixed(3)}ms`);
  console.log(`  CPU User Time:        ${(cpuAfter.user / 1000).toFixed(1)}ms`);
  console.log(`  CPU System Time:      ${(cpuAfter.system / 1000).toFixed(1)}ms`);
  console.log(`  Throughput:           ~${Math.round(TOTAL_REQUESTS / (verifyTime / 1000))} verifications/sec`);
  console.log(`${'='.repeat(55)}\n`);
}

runBenchmark();
