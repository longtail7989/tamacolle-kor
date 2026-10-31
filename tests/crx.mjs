import assert from 'node:assert/strict';
import {constants, createHash, createPublicKey, createVerify, generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {createCrx} from '../scripts/crx.mjs';

// A complete empty ZIP archive. The CRX payload must preserve even its exact bytes.
const zip = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
const first = generateKeyPairSync('rsa', {modulusLength: 2048});
const second = generateKeyPairSync('rsa', {modulusLength: 2048});
const pem = key => key.export({type: 'pkcs8', format: 'pem'});

// Consumer-side protobuf decoder, deliberately independent of the build encoder.
function fields(bytes) {
  let offset = 0;
  function unsigned() {
    let value = 0, multiplier = 1;
    for (let i = 0; i < 5; i++) {
      assert.ok(offset < bytes.length, 'truncated protobuf varint');
      const byte = bytes[offset++];
      value += (byte & 127) * multiplier;
      if (!(byte & 128)) return value;
      multiplier *= 128;
    }
    assert.fail('oversized protobuf varint');
  }
  const result = [];
  while (offset < bytes.length) {
    const tag = unsigned();
    assert.equal(tag % 8, 2, 'CRX messages contain length-delimited fields only');
    const number = Math.floor(tag / 8), size = unsigned();
    assert.ok(number > 0 && offset + size <= bytes.length, 'invalid protobuf field');
    result.push({number, value: bytes.subarray(offset, offset + size)});
    offset += size;
  }
  return result;
}

function decode(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'Cr24');
  assert.equal(bytes.readUInt32LE(4), 3);
  const end = 12 + bytes.readUInt32LE(8);
  assert.ok(end <= bytes.length, 'CRX header exceeds file');
  const header = fields(bytes.subarray(12, end));
  assert.deepEqual(header.map(field => field.number), [2, 10000]);
  const proof = fields(header[0].value), signed = fields(header[1].value);
  assert.deepEqual(proof.map(field => field.number), [1, 2]);
  assert.deepEqual(signed.map(field => field.number), [1]);
  return {publicKey: proof[0].value, signature: proof[1].value, signedHeader: header[1].value, crxId: signed[0].value, zip: bytes.subarray(end)};
}

function verifies(parsed) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(parsed.signedHeader.length);
  const verifier = createVerify('sha256');
  verifier.update('CRX3 SignedData\0', 'utf8');
  verifier.update(size);
  verifier.update(parsed.signedHeader);
  verifier.update(parsed.zip);
  return verifier.verify({key: createPublicKey({key: parsed.publicKey, type: 'spki', format: 'der'}), padding: constants.RSA_PKCS1_PADDING}, parsed.signature);
}

await test('CRX3 independently decodes and verifies its RSA proof, ID and exact ZIP payload', () => {
  const result = createCrx(zip, pem(first.privateKey)), parsed = decode(result.bytes);
  assert.deepEqual(parsed.publicKey, first.publicKey.export({type: 'spki', format: 'der'}));
  assert.deepEqual(parsed.crxId, createHash('sha256').update(parsed.publicKey).digest().subarray(0, 16));
  assert.equal(parsed.crxId.length, 16);
  const id = parsed.crxId.toString('hex').replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
  assert.equal(result.id, id);
  assert.match(result.id, /^[a-p]{32}$/);
  assert.deepEqual(parsed.zip, zip);
  assert.equal(verifies(parsed), true);
});

await test('the same ZIP and stable key produce deterministic CRX bytes and identity', () => {
  const original = createCrx(zip, pem(first.privateKey));
  assert.deepEqual(createCrx(zip, pem(first.privateKey)), original);
  assert.deepEqual(createCrx(zip, first.privateKey.export({type: 'pkcs1', format: 'pem'})), original);
  assert.deepEqual(createCrx(zip, Buffer.from(pem(first.privateKey))), original);
  const differentKey = createCrx(zip, pem(second.privateKey));
  assert.notEqual(differentKey.id, original.id);
  assert.notDeepEqual(differentKey.bytes, original.bytes);
  assert.equal(verifies(decode(differentKey.bytes)), true);
  const changedZip = Buffer.from(zip);
  changedZip[changedZip.length - 1] ^= 1;
  const changed = createCrx(changedZip, pem(first.privateKey));
  assert.equal(changed.id, original.id);
  assert.notDeepEqual(changed.bytes, original.bytes);
  assert.equal(verifies(decode(changed.bytes)), true);
});

await test('tampering with the archive or signature fails independent signature verification', () => {
  const original = createCrx(zip, pem(first.privateKey));
  const archiveTampered = decode(Buffer.from(original.bytes));
  archiveTampered.zip[archiveTampered.zip.length - 1] ^= 1;
  assert.equal(verifies(archiveTampered), false);
  const signatureTampered = decode(Buffer.from(original.bytes));
  signatureTampered.signature[0] ^= 1;
  assert.equal(verifies(signatureTampered), false);
  const headerTampered = decode(Buffer.from(original.bytes));
  headerTampered.crxId[0] ^= 1;
  assert.equal(verifies(headerTampered), false);
});

await test('signing rejects weak, non-RSA, invalid, public-only and encrypted keys', () => {
  const weak = generateKeyPairSync('rsa', {modulusLength: 1024});
  const ec = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const pss = generateKeyPairSync('rsa-pss', {modulusLength: 2048});
  assert.throws(() => createCrx(zip, pem(weak.privateKey)), /at least 2048 bits/);
  assert.throws(() => createCrx(zip, pem(ec.privateKey)), /must be RSA/);
  assert.throws(() => createCrx(zip, pem(pss.privateKey)), /must be RSA/);
  for (const invalid of [undefined, '', 'not a private key', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', first.publicKey.export({type: 'spki', format: 'pem'}), first.privateKey.export({type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'test-only'})]) {
    assert.throws(() => createCrx(zip, invalid), /CRX signing key/);
  }
  assert.throws(() => createCrx('not a ZIP Buffer', pem(first.privateKey)), /ZIP must be a Buffer/);
});
