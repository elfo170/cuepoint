import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
  webcrypto,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

export interface Keys {
  /** Chave de assinatura das requisições (ECDSA P-256). */
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** SPKI DER em base64 (formato trocado no pareamento e usado pelo Android). */
  publicKeyB64: string;
  /** Certificado TLS autoassinado (PEM) e chave (PEM) do servidor HTTPS. */
  certPem: string;
  keyPem: string;
  /** SHA-256 (hex) da chave pública do certificado — fixado pelos pares. */
  certFp: string;
}

export function spkiFingerprint(pemOrDer: string | Buffer): string {
  const cert = new X509Certificate(pemOrDer);
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return createHash('sha256').update(spki).digest('hex');
}

/** Carrega (ou gera na primeira execução) as chaves do aparelho em `dir`. */
export async function loadOrCreateKeys(dir: string, commonName: string): Promise<Keys> {
  mkdirSync(dir, { recursive: true });
  const keyFile = join(dir, 'device-key.pem');
  const certFile = join(dir, 'tls-cert.pem');
  if (!existsSync(keyFile) || !existsSync(certFile)) {
    const pair = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: Date.now().toString(16),
      name: `CN=${commonName.replace(/[,=+<>#;"\\]/g, ' ')}`,
      notBefore: new Date(Date.now() - 24 * 3600 * 1000),
      notAfter: new Date(Date.now() + 20 * 365 * 24 * 3600 * 1000),
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      keys: pair,
    });
    const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8
      .toString('base64')
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END PRIVATE KEY-----\n`;
    writeFileSync(keyFile, pem, { mode: 0o600 });
    writeFileSync(certFile, cert.toString('pem'));
  }
  const keyPem = readFileSync(keyFile, 'utf8');
  const certPem = readFileSync(certFile, 'utf8');
  const privateKey = createPrivateKey(keyPem);
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyB64: (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'),
    certPem,
    keyPem,
    certFp: spkiFingerprint(certPem),
  };
}

export function signText(key: KeyObject, text: string): string {
  return nodeSign('sha256', Buffer.from(text), key).toString('base64');
}

export function verifyText(publicKeyB64: string, text: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return nodeVerify('sha256', Buffer.from(text), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
