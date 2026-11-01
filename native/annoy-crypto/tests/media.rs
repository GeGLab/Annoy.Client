use annoy_crypto::{Device,DeviceDomain,MediaAdd,MemberInfo,MEDIA_CIPHER_SUITE};

const CALL:&str="annoy/media/v1/instance-a/call-a";
fn admit(d:&Device)->MediaAdd{MediaAdd{package:d.key_package().unwrap(),identity:String::from_utf8(identity_of(d)).unwrap(),key:d.public_key()}}
fn identity_of(d:&Device)->Vec<u8>{serde_json::from_slice::<serde_json::Value>(&d.snapshot().unwrap()).unwrap()["identity"].as_array().unwrap().iter().map(|b|b.as_u64().unwrap() as u8).collect()}
fn trusted(devices:&[&Device])->Vec<MemberInfo>{devices.iter().enumerate().map(|(index,d)|MemberInfo{index:index as u32,identity:String::from_utf8(identity_of(d)).unwrap(),signature_key:d.public_key()}).collect()}
fn pair(group:&str)->(Device,Device){
    let a=Device::new_media("alice").unwrap();
    let b=Device::new_media("bob").unwrap();
    a.create_media(group).unwrap();
    let (_,welcome)=a.media_commit(group,&[admit(&b)],&[]).unwrap();
    b.join_media(group,&welcome.unwrap(),&a.members(group).unwrap()).unwrap();
    (a,b)
}

#[test]
fn rfc9605_exporter_agrees_per_epoch_and_isolates_calls_and_message_domains(){
    let (a,b)=pair(CALL);let epoch=a.epoch(CALL).unwrap();
    let key=a.media_base_key(CALL,epoch).unwrap();
    assert!(key.len()==32&&MEDIA_CIPHER_SUITE==0x0005);
    assert!(key==b.media_base_key(CALL,epoch).unwrap());
    assert!(a.own_index(CALL).unwrap()!=b.own_index(CALL).unwrap());
    let other="annoy/media/v1/instance-a/call-b";
    let (c,_)=pair(other);
    assert!(key!=c.media_base_key(other,c.epoch(other).unwrap()).unwrap());
    let other_instance="annoy/media/v1/instance-b/call-a";
    let (d,_)=pair(other_instance);
    assert!(key!=d.media_base_key(other_instance,d.epoch(other_instance).unwrap()).unwrap());
    assert!(a.media_base_key(other,epoch).is_err());
    assert!(a.create_media(other).is_err());
    assert!(a.create("conversation").is_err());
    let messages=Device::new("alice").unwrap();messages.create("conversation").unwrap();
    assert!(messages.create(CALL).is_err());
    assert!(messages.create_media(CALL).is_err());
    assert!(messages.media_base_key("conversation",0).is_err());
    assert_eq!(messages.media_commit("conversation",&[],&[0]),Err("group_domain_mismatch"));
    for id in ["annoy/media/v1/a/../call","annoy/media/v1//call","annoy/media/v1/a/", "ordinary-group"]{
        assert!(Device::new_media("alice").unwrap().create_media(id).is_err());
    }
    let oversized:Vec<MemberInfo>=(0..257).map(|index|MemberInfo{index,identity:"synthetic".into(),signature_key:"".into()}).collect();
    assert_eq!(Device::new_media("c").unwrap().join_media(CALL,"invalid",&oversized),Err("member_limit"));
    assert_eq!(a.media_accept(CALL,"invalid",&oversized),Err("member_limit"));
    // Conversation membership operations never apply to a call group.
    assert_eq!(a.add(CALL,&b.key_package().unwrap(),"bob",&b.public_key()),Err("group_domain_mismatch"));
    assert_eq!(a.remove(CALL,1),Err("group_domain_mismatch"));
    assert_eq!(a.accept_commit(CALL,"invalid",&[]),Err("group_domain_mismatch"));
}

#[test]
fn media_rotation_excludes_removed_devices_and_recovers_after_honest_update(){
    let (a,b)=pair(CALL);let epoch=a.epoch(CALL).unwrap();
    let old=b.media_base_key(CALL,epoch).unwrap();
    let compromised=Device::restore(&b.snapshot().unwrap()).unwrap();
    let update=b.update(CALL).unwrap();
    a.media_accept(CALL,&update,&trusted(&[&a,&b])).unwrap();
    let next=b.epoch(CALL).unwrap();
    assert!(old!=b.media_base_key(CALL,next).unwrap());
    assert!(a.media_base_key(CALL,next).unwrap()==b.media_base_key(CALL,next).unwrap());
    assert!(a.media_base_key(CALL,epoch).is_err());
    assert!(compromised.media_accept(CALL,&update,&trusted(&[&a,&b])).is_err());
    assert!(compromised.media_base_key(CALL,next).is_err());
    // An old complete device snapshot still possesses its old epoch secret.
    // It is never an exportable app backup or evidence of erasure of that copy.
    assert!(compromised.media_base_key(CALL,epoch).unwrap()==old);
    let (removed,welcome)=a.media_commit(CALL,&[],&[b.own_index(CALL).unwrap()]).unwrap();
    assert!(welcome.is_none());
    let after_removal=a.epoch(CALL).unwrap();
    assert!(b.media_base_key(CALL,after_removal).is_err());
    assert_eq!(b.media_accept(CALL,&removed,&trusted(&[&a])),Err("removed_from_call"));
    assert!(b.media_base_key(CALL,after_removal).is_err());
    assert!(a.media_base_key(CALL,after_removal).is_ok());
}

#[test]
fn a_call_continues_after_its_creator_leaves_and_rejects_untrusted_or_concurrent_commits(){
    let (a,b)=pair(CALL);
    let c=Device::new_media("carol").unwrap();
    // A commit adding a device the main process did not verify is refused by members.
    let (commit,welcome)=b.media_commit(CALL,&[admit(&c)],&[]).unwrap();
    // The stdio service restores the previous snapshot after any rejection, as here.
    let saved=a.snapshot().unwrap();
    assert_eq!(a.media_accept(CALL,&commit,&trusted(&[&a,&b])),Err("untrusted_addition"));
    let a=Device::restore(&saved).unwrap();
    c.join_media(CALL,&welcome.unwrap(),&b.members(CALL).unwrap()).unwrap();
    a.media_accept(CALL,&commit,&trusted(&[&a,&b,&c])).unwrap();
    let epoch=a.epoch(CALL).unwrap();
    assert!(a.media_base_key(CALL,epoch).unwrap()==c.media_base_key(CALL,epoch).unwrap());
    // The creator leaves; a remaining member removes it without any owner policy.
    let (leave,_)=b.media_commit(CALL,&[],&[a.own_index(CALL).unwrap()]).unwrap();
    c.media_accept(CALL,&leave,&trusted(&[&b,&c])).unwrap();
    let epoch=b.epoch(CALL).unwrap();
    assert!(b.media_base_key(CALL,epoch).unwrap()==c.media_base_key(CALL,epoch).unwrap());
    assert_eq!(a.media_accept(CALL,&leave,&trusted(&[&b,&c])),Err("removed_from_call"));
    // Two members commit on the same epoch: the one not sequenced first is rejected by peers.
    let d=Device::new_media("dave").unwrap();
    let before=c.snapshot().unwrap();
    let (first,first_welcome)=b.media_commit(CALL,&[admit(&d)],&[]).unwrap();
    let (second,_)=c.media_commit(CALL,&[],&[b.own_index(CALL).unwrap()]).unwrap();
    assert!(b.media_accept(CALL,&second,&trusted(&[&b,&c,&d])).is_err());
    let c=Device::restore(&before).unwrap();
    c.media_accept(CALL,&first,&trusted(&[&b,&c,&d])).unwrap();
    d.join_media(CALL,&first_welcome.unwrap(),&b.members(CALL).unwrap()).unwrap();
    let epoch=b.epoch(CALL).unwrap();
    assert!(c.media_base_key(CALL,epoch).unwrap()==d.media_base_key(CALL,epoch).unwrap());
    assert_eq!(b.media_commit(CALL,&[],&[b.own_index(CALL).unwrap()]),Err("invalid_removal"));
    assert_eq!(b.media_commit(CALL,&[],&[]),Err("empty_commit"));
    assert_eq!(b.media_commit(CALL,&[admit(&d)],&[]),Err("duplicate_device"));
}

#[test]
fn media_snapshot_has_separate_version_and_legacy_message_snapshot_still_restores(){
    let (a,_)=pair(CALL);let epoch=a.epoch(CALL).unwrap();
    let bytes=a.snapshot().unwrap();
    let parsed:serde_json::Value=serde_json::from_slice(&bytes).unwrap();
    assert_eq!(parsed["version"],2);assert_eq!(parsed["domain"],"media");
    let restored=Device::restore(&bytes).unwrap();
    assert_eq!(restored.domain(),DeviceDomain::Media);
    assert!(a.media_base_key(CALL,epoch).unwrap()==restored.media_base_key(CALL,epoch).unwrap());
    let messages=Device::new("alice").unwrap();messages.create("conversation").unwrap();
    let mut old:serde_json::Value=serde_json::from_slice(&messages.snapshot().unwrap()).unwrap();
    old.as_object_mut().unwrap().remove("domain");old.as_object_mut().unwrap().remove("media_group");
    let restored=Device::restore(&serde_json::to_vec(&old).unwrap()).unwrap();
    assert_eq!(restored.domain(),DeviceDomain::Messages);
    assert!(restored.send("conversation","old snapshot continuity").is_ok());
    old["domain"]=serde_json::json!("media");assert!(Device::restore(&serde_json::to_vec(&old).unwrap()).is_err());
}
