import "reflect-metadata";
import { X509Certificate, randomBytes, randomUUID, createPrivateKey, createPublicKey, verify, timingSafeEqual, webcrypto } from "node:crypto";
import { fields, identifier, deviceName, sha, fail, HASH } from "./lan-wire.cjs";
export interface Peer { id: string; name: string; cert: string; fingerprint: string }
export interface Identity extends Peer { key: string; peers: Peer[] }
export function dns(id: string) { identifier(id); return "gm-" + id + ".local"; }
export function certificate(pem: unknown, id: string) {
  identifier(id);
  if (typeof pem !== "string" || pem.length > 4096 || !pem.startsWith("-----BEGIN CERTIFICATE-----")) fail("CERTIFICATE");
  const c = new X509Certificate(pem);
  if (c.publicKey.asymmetricKeyType !== "ec" || c.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
    !c.verify(c.publicKey) || Date.parse(c.validFrom) > Date.now() || Date.parse(c.validTo) < Date.now() ||
    c.subject !== "CN=" + dns(id)) fail("CERTIFICATE");
  return c;
}
export function peer(value: unknown): Peer {
  fields(value,["id","name","cert","fingerprint"]);
  identifier(value.id); const name = deviceName(value.name), c = certificate(value.cert,value.id);
  if (typeof value.fingerprint !== "string" || !HASH.test(value.fingerprint) || sha(c.raw) !== value.fingerprint) fail("CERTIFICATE");
  return {id:value.id,name,cert:value.cert as string,fingerprint:value.fingerprint};
}
export function identity(value: unknown): Identity {
  fields(value,["id","name","cert","fingerprint","key","peers"]);
  const p = peer(Object.fromEntries(["id","name","cert","fingerprint"].map(k=>[k,value[k]])));
  if (typeof value.key !== "string" || value.key.length > 4096 || !Array.isArray(value.peers) || value.peers.length > 20) fail("VAULT");
  const privateKey = createPrivateKey(value.key), publicKey = createPublicKey(privateKey);
  if (!certificate(p.cert,p.id).publicKey.export({format:"der",type:"spki"}).equals(publicKey.export({format:"der",type:"spki"}))) fail("VAULT");
  const peers = value.peers.map(peer);
  if (new Set(peers.map(p=>p.id)).size !== peers.length || peers.some(x=>x.id===p.id)) fail("VAULT");
  return {...p,key:value.key,peers};
}
export async function createIdentity(name: string): Promise<Identity> {
  const id = randomUUID(), x = await import("@peculiar/x509");
  x.cryptoProvider.set(webcrypto as unknown as Crypto);
  const algorithm = {name:"ECDSA",namedCurve:"P-256",hash:"SHA-256"};
  const keys = await webcrypto.subtle.generateKey(algorithm,true,["sign","verify"]) as webcrypto.CryptoKeyPair;
  const cert = await x.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(16).toString("hex"), name:"CN="+dns(id),
    notBefore:new Date(Date.now()-86400000),notAfter:new Date(Date.now()+10*365*86400000),
    signingAlgorithm:algorithm, keys: keys as unknown as CryptoKeyPair,
    extensions:[new x.BasicConstraintsExtension(false,undefined,true),
      new x.KeyUsagesExtension(x.KeyUsageFlags.digitalSignature,true),
      new x.ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1","1.3.6.1.5.5.7.3.2"],false),
      new x.SubjectAlternativeNameExtension([{type:"dns",value:dns(id)}])],
  });
  const der = await webcrypto.subtle.exportKey("pkcs8",keys.privateKey);
  const key = "-----BEGIN PRIVATE KEY-----\n"+Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n")+"\n-----END PRIVATE KEY-----\n";
  const pem = cert.toString("pem"); return identity({id,name:deviceName(name),cert:pem,key,peers:[],fingerprint:sha(new X509Certificate(pem).raw)});
}
export const publicPeer = (p: Peer) => ({id:p.id,name:p.name,fingerprint:p.fingerprint});
export function transcript(ticket:string,serverId:string,p:Peer) {
  return Buffer.from(["GM011A-PAIR-v1",ticket,serverId,p.id,p.fingerprint,p.name].join("\n"),"utf8");
}
export function proof(ticket:string,serverId:string,p:Peer,signature:unknown) {
  if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{64,160}={0,2}$/.test(signature) ||
    !verify("sha256",transcript(ticket,serverId,p),certificate(p.cert,p.id).publicKey,Buffer.from(signature,"base64"))) fail("CERTIFICATE");
}
export function pairingCode(ticket:string,serverId:string,p:Peer) {
  return String(parseInt(sha(transcript(ticket,serverId,p)).slice(0,8),16)%100000000).padStart(8,"0");
}
export function secretEqual(a:unknown,b:string) {
  if (typeof a!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(a) || a.length!==b.length) return false;
  return timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
