import type {UpdateChannel} from '../shared/update-channels.ts';
/** Public Ed25519 SPKI keys bundled with the client, reviewed before release.
 * The private key never leaves the release machine (offline signing with scripts/sign-update.mjs).
 * Never load trust keys from the update server, renderer or downloaded manifest.
 */
export const UPDATE_TRUST:Readonly<Record<string,string>>=Object.freeze({
 'annoy-release-2026':'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA5VC9PbppucvSiGeXuMgkB1IBN9lxVIEFiYPIo9PHcaY=\n-----END PUBLIC KEY-----\n',
 // CI key of channel-build.yml (secret ANNOY_CHANNEL_SIGNING_KEY); limited below to nightly/unstable.
 'annoy-channels':'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAcAvE1yxK5UOH7MWx7CFg67DEkOMNgpYHoMrlQ+jGV7o=\n-----END PUBLIC KEY-----\n',
});
/** Keys limited to some channels. A key missing here signs every channel.
 * A CI key for nightly/unstable builds goes here (and in UPDATE_TRUST) when
 * those channels launch, so it can never sign an alpha, beta or stable release.
 */
export const UPDATE_KEY_CHANNELS:Readonly<Record<string,readonly UpdateChannel[]>>=Object.freeze({'annoy-channels':['nightly','unstable']});
