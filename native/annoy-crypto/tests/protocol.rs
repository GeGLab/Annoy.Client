use annoy_crypto::Device;

fn pair() -> (Device,Device) {
    let a=Device::new("instance:alice:device-a").unwrap();
    let b=Device::new("instance:bob:device-b").unwrap();
    a.create("conversation").unwrap();
    let (_,welcome)=a.add("conversation",&b.key_package().unwrap(),"instance:bob:device-b",&b.public_key()).unwrap();
    b.join("conversation",&welcome,&a.members("conversation").unwrap()).unwrap();
    (a,b)
}
#[test]
fn asynchronous_delivery_out_of_order_replay_and_tamper() {
    let (a,b)=pair();
    let first=a.send("conversation","primeira").unwrap();
    let second=a.send("conversation","segunda").unwrap();
    assert_eq!(b.receive("conversation",&second).unwrap().plaintext.as_deref(),Some("segunda"));
    assert_eq!(b.receive("conversation",&first).unwrap().plaintext.as_deref(),Some("primeira"));
    assert!(b.receive("conversation",&first).is_err());
    let wire=a.send("conversation","autenticada").unwrap();
    let mut bad=wire.as_bytes().to_vec(); let index=bad.len()/2;bad[index]=if bad[index]==b'A'{b'B'}else{b'A'};
    assert!(b.receive("conversation",&String::from_utf8(bad).unwrap()).is_err());
    let restored=Device::restore(&b.snapshot().unwrap()).unwrap();
    assert!(restored.receive("conversation",&first).is_err());
}
#[test]
fn forward_secrecy_current_state_cannot_open_consumed_messages() {
    let (a,b)=pair();
    let wire=a.send("conversation","segredo antigo").unwrap();
    assert!(b.receive("conversation",&wire).is_ok());
    let compromised=Device::restore(&b.snapshot().unwrap()).unwrap();
    assert!(compromised.receive("conversation",&wire).is_err());
    let update=a.update("conversation").unwrap();
    b.accept_commit("conversation",&update,&a.members("conversation").unwrap()).unwrap();
    assert!(Device::restore(&b.snapshot().unwrap()).unwrap().receive("conversation",&wire).is_err());
}
#[test]
fn post_compromise_security_after_honest_update_by_compromised_member() {
    let (a,b)=pair();
    let compromised=Device::restore(&b.snapshot().unwrap()).unwrap();
    let update=b.update("conversation").unwrap();
    a.accept_commit("conversation",&update,&b.members("conversation").unwrap()).unwrap();
    let future=a.send("conversation","novo segredo").unwrap();
    assert_eq!(b.receive("conversation",&future).unwrap().plaintext.as_deref(),Some("novo segredo"));
    // Learning the published update does not give the old Bob clone Bob's new leaf secret.
    assert!(compromised.accept_commit("conversation",&update,&b.members("conversation").unwrap()).is_err());
    assert!(compromised.receive("conversation",&future).is_err());
}
#[test]
fn removal_excludes_old_member_even_if_commit_delivery_is_withheld() {
    let (a,b)=pair();
    let commit=a.remove("conversation",1).unwrap();
    let future=a.send("conversation","depois da saída").unwrap();
    assert!(b.receive("conversation",&future).is_err());
    b.accept_commit("conversation",&commit,&a.members("conversation").unwrap()).unwrap();
    assert!(b.send("conversation","intrusão").is_err());
    assert!(b.receive("conversation",&future).is_err());
}
#[test]
fn key_substitution_and_wrong_welcome_members_are_rejected() {
    let a=Device::new("a").unwrap();let b=Device::new("b").unwrap();let fake=Device::new("b").unwrap();
    a.create("g").unwrap();
    assert!(a.add("g",&fake.key_package().unwrap(),"b",&b.public_key()).is_err());
    let (_,welcome)=a.add("g",&b.key_package().unwrap(),"b",&b.public_key()).unwrap();
    assert!(b.join("g",&welcome,&[]).is_err());
}
#[test]
fn restored_state_can_continue_within_an_epoch_and_rejects_duplicate_group_creation() {
    let (a,b)=pair();
    let a=Device::restore(&a.snapshot().unwrap()).unwrap();
    let b=Device::restore(&b.snapshot().unwrap()).unwrap();
    let wire=a.send("conversation","após reinício").unwrap();
    assert!(b.receive("conversation",&wire).is_ok());
    assert!(a.create("conversation").is_err());
    assert!(b.receive("other-instance",&wire).is_err());
}

#[test]
fn authenticated_group_policy_controls_history_and_owner_handover() {
 let (a,b)=pair();
 assert_eq!(a.policy("conversation").unwrap().history,"since_join");
 let policy=a.set_policy("conversation","share_permanent",None).unwrap();
 b.accept_commit("conversation",&policy,&a.members("conversation").unwrap()).unwrap();
 assert_eq!(b.policy("conversation").unwrap().history,"share_permanent");
 assert!(b.set_policy("conversation","since_join",None).is_err());
 let handover=a.set_policy("conversation","share_permanent",Some("instance:bob:device-b")).unwrap();
 b.accept_commit("conversation",&handover,&a.members("conversation").unwrap()).unwrap();
 let own_policy=b.set_policy("conversation","since_join",None).unwrap();
 a.accept_commit("conversation",&own_policy,&b.members("conversation").unwrap()).unwrap();
 assert_eq!(a.policy("conversation").unwrap().owner,"instance:bob:device-b");
 let c=Device::new("instance:charlie:device-c").unwrap();
 assert!(a.add("conversation",&c.key_package().unwrap(),"instance:charlie:device-c",&c.public_key()).is_err());
 let (_,welcome)=b.add("conversation",&c.key_package().unwrap(),"instance:charlie:device-c",&c.public_key()).unwrap();
 c.join("conversation",&welcome,&b.members("conversation").unwrap()).unwrap();
 assert_eq!(c.policy("conversation").unwrap().owner,"instance:bob:device-b");
}

#[test]
fn recovery_replaces_only_devices_of_the_same_principal_and_excludes_the_old_device(){
 let ai="[\"instance\",\"alice\",\"a1\"]";let bi="[\"instance\",\"bob\",\"b1\"]";let a2i="[\"instance\",\"alice\",\"a2\"]";
 let a=Device::new(ai).unwrap();let b=Device::new(bi).unwrap();let a2=Device::new(a2i).unwrap();
 a.create("g").unwrap();let(_,welcome)=a.add("g",&b.key_package().unwrap(),bi,&b.public_key()).unwrap();b.join("g",&welcome,&a.members("g").unwrap()).unwrap();
 assert!(a.remove("g",0).is_err());
 let outsider=Device::new("[\"instance\",\"mallory\",\"m1\"]").unwrap();
 assert!(b.add("g",&outsider.key_package().unwrap(),"[\"instance\",\"mallory\",\"m1\"]",&outsider.public_key()).is_err());
 assert!(b.replace("g",&outsider.key_package().unwrap(),"[\"instance\",\"mallory\",\"m1\"]",&outsider.public_key(),&[0]).is_err());
 let(_,welcome)=b.replace("g",&a2.key_package().unwrap(),a2i,&a2.public_key(),&[0]).unwrap();
 a2.join("g",&welcome,&b.members("g").unwrap()).unwrap();
 assert_eq!(a2.policy("g").unwrap().owner,"instance:alice");
 let wire=b.send("g","after recovery").unwrap();assert!(a.receive("g",&wire).is_err());assert!(a2.receive("g",&wire).is_ok());
 let update=a2.set_policy("g","share_permanent",None).unwrap();b.accept_commit("g",&update,&a2.members("g").unwrap()).unwrap();
 assert_eq!(b.policy("g").unwrap().history,"share_permanent");
}
