//! SFrame (RFC 9605) session for one call, keyed by an MLS media group (section 5.2).
//! Compiled to WebAssembly for the encoded-transform worker of the renderer.
//! The base keys arrive from the trusted main process; this crate never sees MLS state.
use sframe::{
    error::SframeError,
    frame::{EncryptedFrameView, MediaFrameView, MonotonicCounter, validation::{ReplayAttackProtectionStore, Tolerance}},
    header::KeyId,
    key::{DecryptionKey, EncryptionKey},
    mls::{MlsExporter, MlsKeyId, MlsKeyIdBitRange},
    CipherSuite,
};
use std::collections::HashMap;
use zeroize::Zeroizing;

pub const SUITE: CipherSuite = CipherSuite::AesGcm256Sha512;
/// E: low epoch bits on the wire, the window of epochs a receiver can tell apart.
pub const EPOCH_BITS: u8 = 8;
/// S: member index bits. Rosters are limited to 256 devices, 16 bits leave room for blank leaves.
pub const INDEX_BITS: u8 = 16;
/// Contexts identify one outbound stream of a sender (mic, camera, screen, screen audio).
pub const MAX_CONTEXT: u64 = 15;
/// Epochs kept for receiving while late members catch up with a commit.
pub const RETAINED_EPOCHS: usize = 3;
const MAX_DECRYPTION_KEYS: usize = 4096;
const REPLAY_TOLERANCE: usize = 128;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Error { NoKey, InvalidKey, InvalidContext, StaleEpoch, Malformed, Rejected, Replay, Exhausted }

impl Error {
    pub fn code(self) -> i32 {
        match self { Error::NoKey => -1, Error::InvalidKey => -2, Error::InvalidContext => -3, Error::StaleEpoch => -4, Error::Malformed => -5, Error::Rejected => -6, Error::Replay => -7, Error::Exhausted => -8 }
    }
}

struct BaseKey<'a>(&'a [u8]);
#[derive(Debug)]
struct WrongExport;
impl std::fmt::Display for WrongExport { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("unexpected exporter request") } }
impl std::error::Error for WrongExport {}
impl MlsExporter for BaseKey<'_> {
    type BaseKey = Zeroizing<Vec<u8>>;
    type Error = WrongExport;
    /// The main process already ran the exporter with exactly these arguments.
    fn export_secret(&self, label: &str, context: &[u8], key_length: usize) -> Result<Self::BaseKey, WrongExport> {
        if label != "SFrame 1.0 Base Key" || !context.is_empty() || key_length != self.0.len() { return Err(WrongExport); }
        Ok(Zeroizing::new(self.0.to_vec()))
    }
}

struct Epoch { epoch: u64, base: Zeroizing<Vec<u8>> }
struct Sender { key: EncryptionKey, counter: MonotonicCounter }

pub fn bit_range() -> MlsKeyIdBitRange { MlsKeyIdBitRange::new(EPOCH_BITS, INDEX_BITS) }
fn epoch_mask() -> u64 { (1u64 << EPOCH_BITS) - 1 }

/// One call. Counters live as long as the session, so a key id never repeats a nonce,
/// even when a stream stops and starts again within an epoch.
#[derive(Default)]
pub struct Session {
    own_index: Option<u64>,
    epochs: Vec<Epoch>,
    senders: HashMap<KeyId, Sender>,
    receivers: HashMap<KeyId, DecryptionKey>,
    replay: Option<ReplayAttackProtectionStore>,
}

impl Session {
    pub fn new() -> Self { Self { replay: Some(ReplayAttackProtectionStore::new(Tolerance::new(REPLAY_TOLERANCE))), ..Default::default() } }

    /// Installs the base key of a new MLS epoch and makes it current for sending.
    /// Epochs only move forward; an older or repeated epoch is refused.
    pub fn set_epoch(&mut self, epoch: u64, own_index: u32, base_key: &[u8]) -> Result<(), Error> {
        if base_key.len() != SUITE.key_len() { return Err(Error::InvalidKey); }
        if u64::from(own_index) >= 1 << INDEX_BITS { return Err(Error::InvalidKey); }
        if self.epochs.last().is_some_and(|e| e.epoch >= epoch) { return Err(Error::StaleEpoch); }
        // RFC 9605 5.2: drop an old epoch when a new one with the same low bits arrives.
        self.epochs.retain(|e| (e.epoch & epoch_mask()) != (epoch & epoch_mask()));
        self.epochs.push(Epoch { epoch, base: Zeroizing::new(base_key.to_vec()) });
        while self.epochs.len() > RETAINED_EPOCHS { self.epochs.remove(0); }
        self.own_index = Some(u64::from(own_index));
        self.prune();
        Ok(())
    }

    /// Stops accepting frames of every epoch before `epoch`.
    pub fn retire_before(&mut self, epoch: u64) {
        self.epochs.retain(|e| e.epoch >= epoch);
        self.prune();
    }

    fn prune(&mut self) {
        let live: Vec<u64> = self.epochs.iter().map(|e| e.epoch & epoch_mask()).collect();
        let current = self.epochs.last().map(|e| e.epoch & epoch_mask());
        let range = bit_range();
        let keep = |kid: &KeyId| live.contains(&MlsKeyId::from_key_id(*kid, range).epoch_lsb());
        self.receivers.retain(|kid, _| keep(kid));
        self.senders.retain(|kid, _| Some(MlsKeyId::from_key_id(*kid, range).epoch_lsb()) == current);
        if let Some(replay) = self.replay.as_mut() { replay.retain(|kid| keep(&kid)); }
    }

    pub fn current_epoch(&self) -> Option<u64> { self.epochs.last().map(|e| e.epoch) }

    /// Writes `clear || SFrame(header, ciphertext, tag)` to `out`. The first `clear` bytes of
    /// `frame` stay readable for the packetizer and are authenticated as SFrame metadata.
    pub fn encrypt(&mut self, context: u64, frame: &[u8], clear: usize, out: &mut Vec<u8>) -> Result<(), Error> {
        if context > MAX_CONTEXT { return Err(Error::InvalidContext); }
        if clear > frame.len() { return Err(Error::Malformed); }
        let epoch = self.epochs.last().ok_or(Error::NoKey)?;
        let index = self.own_index.ok_or(Error::NoKey)?;
        let kid = MlsKeyId::try_new(context, epoch.epoch, index, bit_range()).map_err(|_| Error::InvalidContext)?;
        let id: KeyId = kid.into();
        if !self.senders.contains_key(&id) {
            let key = EncryptionKey::derive_from_mls(SUITE, &BaseKey(&epoch.base), kid).map_err(|_| Error::InvalidKey)?;
            self.senders.insert(id, Sender { key, counter: MonotonicCounter::default() });
        }
        let sender = self.senders.get_mut(&id).expect("sender inserted above");
        let (meta, payload) = frame.split_at(clear);
        let view = MediaFrameView::try_with_meta_data(&mut sender.counter, payload, meta).map_err(|_| Error::Exhausted)?;
        out.clear();
        let encrypted = view.encrypt_into(&sender.key, out).map_err(|_| Error::Rejected)?;
        let len = encrypted.meta_data().len() + encrypted.sframe_cipher_text().len();
        out.truncate(len);
        Ok(())
    }

    /// Opens a frame produced by `encrypt`, rejecting unknown epochs, forged key ids and replays.
    pub fn decrypt(&mut self, frame: &[u8], clear: usize, out: &mut Vec<u8>) -> Result<(), Error> {
        if clear > frame.len() { return Err(Error::Malformed); }
        let (meta, data) = frame.split_at(clear);
        let view = EncryptedFrameView::try_with_meta_data(data, meta).map_err(|_| Error::Malformed)?;
        let id = view.header().key_id();
        let kid = MlsKeyId::from_key_id(id, bit_range());
        if kid.context_id() > MAX_CONTEXT { return Err(Error::InvalidContext); }
        let replay = self.replay.as_mut().expect("session created with replay protection");
        out.clear();
        let result = if let Some(key) = self.receivers.get(&id) {
            view.validated_decrypt_into(key, out, replay).map(|_| None)
        } else {
            let epoch = self.epochs.iter().find(|e| e.epoch & epoch_mask() == kid.epoch_lsb()).ok_or(Error::StaleEpoch)?;
            let full = MlsKeyId::try_new(kid.context_id(), epoch.epoch, kid.member_index(), bit_range()).map_err(|_| Error::Malformed)?;
            let key = DecryptionKey::derive_from_mls(SUITE, &BaseKey(&epoch.base), full).map_err(|_| Error::InvalidKey)?;
            // A key id is attacker controlled until its frame authenticates; keep only keys that did.
            view.validated_decrypt_into(&key, out, replay).map(|_| Some(key))
        };
        match result {
            Ok(derived) => {
                if let Some(key) = derived { if self.receivers.len() < MAX_DECRYPTION_KEYS { self.receivers.insert(id, key); } }
                Ok(())
            }
            Err(SframeError::FrameValidationFailed(_)) => Err(Error::Replay),
            Err(_) => Err(Error::Rejected),
        }
    }

    pub fn clear(&mut self) { *self = Self::new(); }
}

/// C ABI for the worker: one session per WebAssembly instance, buffers owned by the module.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::cell::RefCell;
    use zeroize::Zeroize;
    thread_local! {
        static SESSION: RefCell<Session> = RefCell::new(Session::new());
        static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }
    #[no_mangle]
    pub extern "C" fn sf_alloc(len: usize) -> *mut u8 {
        let mut buffer = Vec::<u8>::with_capacity(len.max(1));
        let ptr = buffer.as_mut_ptr();
        std::mem::forget(buffer);
        ptr
    }
    /// # Safety
    /// `ptr`/`len` must come from `sf_alloc`. The buffer is wiped before release.
    #[no_mangle]
    pub unsafe extern "C" fn sf_free(ptr: *mut u8, len: usize) {
        let mut buffer = Vec::from_raw_parts(ptr, len, len.max(1));
        buffer.zeroize();
    }
    /// # Safety
    /// `key` must point to `len` readable bytes; they are wiped after the copy.
    #[no_mangle]
    pub unsafe extern "C" fn sf_set_epoch(epoch_hi: u32, epoch_lo: u32, own_index: u32, key: *mut u8, len: usize) -> i32 {
        let bytes = std::slice::from_raw_parts_mut(key, len);
        let epoch = (u64::from(epoch_hi) << 32) | u64::from(epoch_lo);
        let result = SESSION.with(|s| s.borrow_mut().set_epoch(epoch, own_index, bytes));
        bytes.zeroize();
        match result { Ok(()) => 0, Err(e) => e.code() }
    }
    #[no_mangle]
    pub extern "C" fn sf_retire_before(epoch_hi: u32, epoch_lo: u32) {
        SESSION.with(|s| s.borrow_mut().retire_before((u64::from(epoch_hi) << 32) | u64::from(epoch_lo)));
    }
    /// Returns the output length (read it at `sf_output`) or a negative error code.
    /// # Safety
    /// `frame` must point to `len` readable bytes.
    #[no_mangle]
    pub unsafe extern "C" fn sf_encrypt(context: u32, frame: *const u8, len: usize, clear: usize) -> i32 {
        let input = std::slice::from_raw_parts(frame, len);
        OUTPUT.with(|o| {
            let mut out = o.borrow_mut();
            out.zeroize();
            match SESSION.with(|s| s.borrow_mut().encrypt(u64::from(context), input, clear, &mut out)) {
                Ok(()) => i32::try_from(out.len()).unwrap_or(Error::Malformed.code()),
                Err(e) => e.code(),
            }
        })
    }
    /// # Safety
    /// `frame` must point to `len` readable bytes.
    #[no_mangle]
    pub unsafe extern "C" fn sf_decrypt(frame: *const u8, len: usize, clear: usize) -> i32 {
        let input = std::slice::from_raw_parts(frame, len);
        OUTPUT.with(|o| {
            let mut out = o.borrow_mut();
            out.zeroize();
            match SESSION.with(|s| s.borrow_mut().decrypt(input, clear, &mut out)) {
                Ok(()) => i32::try_from(out.len()).unwrap_or(Error::Malformed.code()),
                Err(e) => e.code(),
            }
        })
    }
    #[no_mangle]
    pub extern "C" fn sf_output() -> *const u8 { OUTPUT.with(|o| o.borrow().as_ptr()) }
    /// Wipes the last output once the worker copied it out.
    #[no_mangle]
    pub extern "C" fn sf_wipe_output() { OUTPUT.with(|o| o.borrow_mut().zeroize()); }
    #[no_mangle]
    pub extern "C" fn sf_clear() {
        SESSION.with(|s| s.borrow_mut().clear());
        OUTPUT.with(|o| o.borrow_mut().zeroize());
    }
}
