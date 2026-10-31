import {constants, createHash, createPrivateKey, createPublicKey, createSign} from 'node:crypto';

// CRX3 protobuf schema and signed-byte layout:
// https://chromium.googlesource.com/chromium/src.git/+/62.0.3202.58/components/crx_file/crx3.proto
function varint(value) {
  const bytes = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}

function bytesField(number, bytes) {
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}

// Build-only API. The caller owns key storage; this module never generates or writes a key.
// id is Chromium's 32-character a-p extension ID, not the raw 16-byte crx_id.
export function createCrx(zip, privateKeyPem) {
  if (!Buffer.isBuffer(zip)) throw new TypeError('CRX ZIP must be a Buffer.');
  const pem = Buffer.isBuffer(privateKeyPem) ? privateKeyPem.toString('utf8') : privateKeyPem;
  if (typeof pem !== 'string' || !/^\s*-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1-----\s*$/.test(pem)) {
    throw new Error('CRX signing key must be an unencrypted PEM private RSA key.');
  }
  let key;
  try {
    key = createPrivateKey({key: pem, format: 'pem'});
  } catch {
    throw new Error('CRX signing key is not a valid unencrypted PEM private key.');
  }
  if (key.asymmetricKeyType !== 'rsa') throw new Error('CRX signing key must be RSA (not RSA-PSS or another algorithm).');
  if (!(key.asymmetricKeyDetails?.modulusLength >= 2048)) throw new Error('CRX signing key must be RSA with at least 2048 bits.');

  const publicKey = createPublicKey(key).export({type: 'spki', format: 'der'});
  const crxId = createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const id = Array.from(crxId, byte => String.fromCharCode(97 + (byte >>> 4), 97 + (byte & 15))).join('');
  const signedHeader = bytesField(1, crxId);
  const signedHeaderSize = Buffer.alloc(4);
  signedHeaderSize.writeUInt32LE(signedHeader.length);
  const signer = createSign('sha256');
  signer.update(Buffer.from('CRX3 SignedData\0', 'utf8'));
  signer.update(signedHeaderSize);
  signer.update(signedHeader);
  signer.update(zip);
  const signature = signer.sign({key, padding: constants.RSA_PKCS1_PADDING});
  const proof = Buffer.concat([bytesField(1, publicKey), bytesField(2, signature)]);
  const header = Buffer.concat([bytesField(2, proof), bytesField(10000, signedHeader)]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'ascii');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return {bytes: Buffer.concat([prefix, header, zip]), id};
}
