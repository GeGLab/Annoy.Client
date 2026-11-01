/** Public Ed25519 SPKI keys bundled with the client, reviewed before release.
 * The private key never leaves the release machine (offline signing with scripts/sign-update.mjs).
 * Never load trust keys from the update server, renderer or downloaded manifest.
 */
export const UPDATE_TRUST:Readonly<Record<string,string>>=Object.freeze({
 'annoy-release-2026':'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA5VC9PbppucvSiGeXuMgkB1IBN9lxVIEFiYPIo9PHcaY=\n-----END PUBLIC KEY-----\n',
});
