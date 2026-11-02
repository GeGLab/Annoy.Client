use annoy_sframe::{Error, Session, EPOCH_BITS, INDEX_BITS, RETAINED_EPOCHS, SUITE};
use sframe::{frame::{MediaFrameView, SingleUseCounter}, key::EncryptionKey, CipherSuite};

fn hex(s: &str) -> Vec<u8> { hex::decode(s.split_whitespace().collect::<String>()).unwrap() }

/// RFC 9605 Appendix C.3, cipher_suite 0x0005 (AES_256_GCM_SHA512_128), verbatim.
#[test]
fn library_matches_rfc9605_vector_for_the_selected_suite() {
    assert_eq!(SUITE, CipherSuite::AesGcm256Sha512);
    let key = EncryptionKey::derive_from(SUITE, 0x123u64, hex("000102030405060708090a0b0c0d0e0f")).unwrap();
    let metadata = hex("4945544620534672616d65205747");
    let plaintext = hex("64726166742d696574662d736672616d 652d656e63");
    let mut counter = SingleUseCounter::new(0x4567);
    let frame = MediaFrameView::try_with_meta_data(&mut counter, &plaintext, &metadata).unwrap();
    let mut buffer = Vec::new();
    let encrypted = frame.encrypt_into(&key, &mut buffer).unwrap();
    assert_eq!(encrypted.sframe_cipher_text(), hex("990123456794f509d36e9beacb0e261d 99c7d1e972f1fed787d4049f17ca2135 3c1cc24d56ceabced279").as_slice());
}

fn pair(epoch: u64) -> (Session, Session, Vec<u8>) {
    let base = vec![7u8; 32];
    let (mut a, mut b) = (Session::new(), Session::new());
    a.set_epoch(epoch, 0, &base).unwrap();
    b.set_epoch(epoch, 1, &base).unwrap();
    (a, b, base)
}

#[test]
fn members_exchange_frames_and_keep_the_packetizer_prefix_authenticated() {
    let (mut a, mut b, _) = pair(5);
    let frame = b"\x10\x02\x00\x9d\x01\x2a\x80\x02\xe0\x01 video plaintext canary".to_vec();
    let (mut sealed, mut opened) = (Vec::new(), Vec::new());
    a.encrypt(1, &frame, 10, &mut sealed).unwrap();
    assert_eq!(&sealed[..10], &frame[..10]);
    assert!(!sealed.windows(9).any(|w| w == b"plaintext"));
    b.decrypt(&sealed, 10, &mut opened).unwrap();
    assert_eq!(opened, frame);
    // RFC 9605 5.2 KID: context << (S+E) | index << E | epoch mod 2^E, here 1, 0, 5.
    let mut header = Vec::new();
    a.encrypt(1, b"x", 0, &mut header).unwrap();
    let kid = (1u64 << (INDEX_BITS + EPOCH_BITS)) | 5;
    assert_eq!(header[0] >> 4 & 0b111, 3, "KID length minus one in the config byte");
    assert_eq!(header[0] >> 7, 1, "extended KID");
    assert_eq!(u64::from_be_bytes([0, 0, 0, 0, header[1], header[2], header[3], header[4]]), kid);
    // Bob sends with his own leaf index, Alice opens it.
    let mut reply = Vec::new();
    b.encrypt(0, b"opus frame", 0, &mut reply).unwrap();
    a.decrypt(&reply, 0, &mut opened).unwrap();
    assert_eq!(opened, b"opus frame");
}

#[test]
fn replays_tampering_and_unknown_epochs_are_rejected() {
    let (mut a, mut b, _) = pair(1);
    let (mut sealed, mut out) = (Vec::new(), Vec::new());
    a.encrypt(0, b"\x10\x02\x00 frame", 3, &mut sealed).unwrap();
    b.decrypt(&sealed, 3, &mut out).unwrap();
    assert_eq!(b.decrypt(&sealed, 3, &mut out), Err(Error::Replay));
    a.encrypt(0, b"\x10\x02\x00 frame", 3, &mut sealed).unwrap();
    let mut prefix = sealed.clone(); prefix[0] ^= 1;
    assert_eq!(b.decrypt(&prefix, 3, &mut out), Err(Error::Rejected));
    let mut body = sealed.clone(); *body.last_mut().unwrap() ^= 1;
    assert_eq!(b.decrypt(&body, 3, &mut out), Err(Error::Rejected));
    // A failed frame is not recorded, the authentic one still opens once.
    b.decrypt(&sealed, 3, &mut out).unwrap();
    let mut outsider = Session::new();
    outsider.set_epoch(1, 2, &[8u8; 32]).unwrap();
    a.encrypt(0, b"frame", 0, &mut sealed).unwrap();
    assert_eq!(outsider.decrypt(&sealed, 0, &mut out), Err(Error::Rejected));
    let mut other_epoch = Session::new();
    other_epoch.set_epoch(2, 2, &[7u8; 32]).unwrap();
    assert_eq!(other_epoch.decrypt(&sealed, 0, &mut out), Err(Error::StaleEpoch));
    assert_eq!(b.decrypt(&[0xff, 1, 2], 0, &mut out), Err(Error::Malformed));
}

#[test]
fn no_key_never_produces_output_and_epochs_only_move_forward() {
    let mut s = Session::new();
    let mut out = vec![1, 2, 3];
    assert_eq!(s.encrypt(0, b"must not leave in clear", 0, &mut out), Err(Error::NoKey));
    s.set_epoch(4, 0, &[1u8; 32]).unwrap();
    assert_eq!(s.set_epoch(4, 0, &[2u8; 32]), Err(Error::StaleEpoch));
    assert_eq!(s.set_epoch(3, 0, &[2u8; 32]), Err(Error::StaleEpoch));
    assert_eq!(s.set_epoch(5, 0, &[2u8; 16]), Err(Error::InvalidKey));
    assert_eq!(s.set_epoch(5, 1 << INDEX_BITS, &[2u8; 32]), Err(Error::InvalidKey));
    assert_eq!(s.encrypt(16, b"frame", 0, &mut out), Err(Error::InvalidContext));
    assert_eq!(s.encrypt(0, b"ab", 3, &mut out), Err(Error::Malformed));
    s.clear();
    assert_eq!(s.encrypt(0, b"frame", 0, &mut out), Err(Error::NoKey));
}

#[test]
fn counters_never_repeat_within_a_session_and_rotation_retires_old_epochs() {
    let (mut a, mut b, _) = pair(10);
    let mut seen = std::collections::HashSet::new();
    let mut sealed = Vec::new();
    for _ in 0..3 { a.encrypt(2, b"screen", 0, &mut sealed).unwrap(); assert!(seen.insert(sealed.clone())); }
    // The same context after a stream restarts continues the counter.
    a.encrypt(2, b"screen", 0, &mut sealed).unwrap();
    assert!(seen.insert(sealed.clone()));
    let old = sealed.clone();
    let next = vec![9u8; 32];
    a.set_epoch(11, 0, &next).unwrap();
    b.set_epoch(11, 1, &next).unwrap();
    let mut out = Vec::new();
    // A late frame of the previous epoch still opens while it is retained.
    b.decrypt(&old, 0, &mut out).unwrap();
    a.encrypt(2, b"screen", 0, &mut sealed).unwrap();
    b.decrypt(&sealed, 0, &mut out).unwrap();
    b.retire_before(11);
    a.set_epoch(12, 0, &[3u8; 32]).unwrap();
    let mut stale = Session::new();
    stale.set_epoch(10, 1, &[7u8; 32]).unwrap();
    a.encrypt(2, b"screen", 0, &mut sealed).unwrap();
    assert_eq!(stale.decrypt(&sealed, 0, &mut out), Err(Error::StaleEpoch));
    // Old epoch frames are refused once retired.
    let (mut c, mut d, _) = pair(20);
    c.encrypt(0, b"old", 0, &mut sealed).unwrap();
    d.set_epoch(21, 1, &[4u8; 32]).unwrap();
    d.retire_before(21);
    assert_eq!(d.decrypt(&sealed, 0, &mut out), Err(Error::StaleEpoch));
    // Only a bounded window of epochs is kept.
    for e in 22..22 + RETAINED_EPOCHS as u64 { d.set_epoch(e, 1, &[e as u8; 32]).unwrap(); }
    let mut e21 = Session::new();
    e21.set_epoch(21, 0, &[4u8; 32]).unwrap();
    e21.encrypt(0, b"too old", 0, &mut sealed).unwrap();
    assert_eq!(d.decrypt(&sealed, 0, &mut out), Err(Error::StaleEpoch));
}

#[test]
fn epochs_sharing_low_bits_replace_each_other() {
    let mut s = Session::new();
    s.set_epoch(1, 0, &[1u8; 32]).unwrap();
    let wrap = 1 + (1u64 << EPOCH_BITS);
    s.set_epoch(wrap, 0, &[2u8; 32]).unwrap();
    let mut old_sender = Session::new();
    old_sender.set_epoch(1, 1, &[1u8; 32]).unwrap();
    let (mut sealed, mut out) = (Vec::new(), Vec::new());
    old_sender.encrypt(0, b"frame", 0, &mut sealed).unwrap();
    assert_eq!(s.decrypt(&sealed, 0, &mut out), Err(Error::Rejected));
}
