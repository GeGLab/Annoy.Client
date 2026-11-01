/** Public Ed25519 SPKI keys bundled with the client, reviewed before release.
 * Empty intentionally: no production signer was provided or authorized.
 * Never load trust keys from the update server, renderer or downloaded manifest.
 */
export const UPDATE_TRUST:Readonly<Record<string,string>>=Object.freeze({});
