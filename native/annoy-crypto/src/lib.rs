//! Local-only adapter: all MLS cryptography is performed by OpenMLS.
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use openmls_traits::storage::StorageProvider;
use std::{cell::RefCell,time::{SystemTime,UNIX_EPOCH}};
use serde::{Deserialize, Serialize};
use tls_codec::{Deserialize as _, Serialize as _};
use zeroize::{Zeroize,Zeroizing};

pub type Result<T> = std::result::Result<T, &'static str>;
pub const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
pub const MAX_WIRE: usize = 1024 * 1024;
pub const MEDIA_GROUP_PREFIX: &str = "annoy/media/v1/";
pub const MEDIA_CIPHER_SUITE: u16 = 0x0005; // RFC 9605 AES_256_GCM_SHA512

#[derive(Clone,Copy,Default,Debug,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum DeviceDomain { #[default] Messages, Media }

fn media_group_id(id:&str)->bool {
    let Some(rest)=id.strip_prefix(MEDIA_GROUP_PREFIX) else{return false};
    let Some((instance,call))=rest.split_once('/') else{return false};
    [instance,call].iter().all(|part|!part.is_empty()&&part.len()<=64&&part.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'))
}

#[derive(Clone,Serialize,Deserialize)]
struct PackageRecord {reference:KeyPackageRef,expires:u64}
#[derive(Serialize, Deserialize)]
struct Snapshot {
    version: u8,
    #[serde(default)]
    domain: DeviceDomain,
    #[serde(default)]
    media_group: Option<String>,
    identity: Vec<u8>,
    signer: SignatureKeyPair,
    storage: Vec<(Vec<u8>, Vec<u8>)>,
    #[serde(default)]
    packages:Vec<PackageRecord>,
}

pub struct Device {
    domain: DeviceDomain,
    media_group: RefCell<Option<String>>,
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    identity: Vec<u8>,
    packages:RefCell<Vec<PackageRecord>>,
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct MemberInfo {
    pub index: u32,
    pub identity: String,
    pub signature_key: String,
}
/// A device admitted to a call. The trusted main process verified its media binding first.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct MediaAdd { pub package: String, pub identity: String, pub key: String }
#[derive(Serialize, Debug)]
pub struct Received {
    pub kind: &'static str,
    pub plaintext: Option<String>,
    pub sender: String,
}
const POLICY_EXTENSION:u16=0xff00;
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GroupPolicy {pub version:u8,pub owner:String,pub history:String}
fn capabilities()->Capabilities {
    let mut extensions=Capabilities::default().extensions().to_vec();extensions.push(ExtensionType::Unknown(POLICY_EXTENSION));
    Capabilities::new(None,Some(&[SUITE]),Some(&extensions),None,None)
}
fn policy_of(group:&MlsGroup)->Result<GroupPolicy>{
    if let Some(bytes)=group.extensions().unknown(POLICY_EXTENSION){
        let policy:GroupPolicy=serde_json::from_slice(&bytes.0).map_err(|_|"invalid_group_policy")?;
        if policy.version!=1||policy.owner.len()>512||!["since_join","share_permanent"].contains(&policy.history.as_str()){return Err("invalid_group_policy");}
        if !group.members().any(|m|identity(&m.credential).map(|id|principal(&id)==policy.owner).unwrap_or(false)){return Err("membership_owner_missing");}
        return Ok(policy);
    }
    Err("missing_authenticated_group_policy")
}
fn config(policy:Option<GroupPolicy>) -> Result<MlsGroupCreateConfig> {
    let mut builder=MlsGroupCreateConfig::builder()
        .ciphersuite(SUITE)
        .capabilities(capabilities())
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .use_ratchet_tree_extension(true)
        // No old epoch secrets survive commits. Offline delivery must preserve order.
        .max_past_epochs(0)
        .sender_ratchet_configuration(SenderRatchetConfiguration::new(128, 1024));
    if let Some(policy)=policy {
        let bytes=serde_json::to_vec(&policy).map_err(|_|"invalid_group_policy")?;
        let extensions=Extensions::from_vec(vec![Extension::RequiredCapabilities(RequiredCapabilitiesExtension::new(&[ExtensionType::Unknown(POLICY_EXTENSION)],&[],&[])),Extension::Unknown(POLICY_EXTENSION,UnknownExtension(bytes))]).map_err(|_|"invalid_group_policy")?;
        builder=builder.with_group_context_extensions(extensions);
    }
    Ok(builder.build())
}
fn decode(wire: &str) -> Result<Vec<u8>> {
    if wire.len() > MAX_WIRE * 2 { return Err("size_limit"); }
    let bytes = B64.decode(wire).map_err(|_| "invalid_encoding")?;
    if bytes.len() > MAX_WIRE { return Err("size_limit"); }
    Ok(bytes)
}
fn encode(msg: MlsMessageOut) -> Result<String> {
    Ok(B64.encode(msg.tls_serialize_detached().map_err(|_| "serialize_failed")?))
}
fn identity(credential: &Credential) -> Result<String> {
    let basic = BasicCredential::try_from(credential.clone()).map_err(|_| "credential_type")?;
    String::from_utf8(basic.identity().to_vec()).map_err(|_| "invalid_identity")
}
fn principal(value:&str)->String {
    serde_json::from_str::<serde_json::Value>(value).ok().and_then(|v|{
        let a=v.as_array()?;Some(format!("{}:{}",a.first()?.as_str()?,a.get(1)?.as_str()?))
    }).unwrap_or_else(||value.to_owned())
}
fn owner(group:&MlsGroup)->Result<String>{Ok(policy_of(group)?.owner)}
impl Device {
    pub fn new(identity: &str) -> Result<Self> {
        Self::new_in_domain(identity,DeviceDomain::Messages)
    }
    pub fn new_media(identity:&str)->Result<Self>{Self::new_in_domain(identity,DeviceDomain::Media)}
    fn new_in_domain(identity:&str,domain:DeviceDomain)->Result<Self>{
        if identity.is_empty() || identity.len() > 512 { return Err("invalid_identity"); }
        let signer = SignatureKeyPair::new(SUITE.signature_algorithm()).map_err(|_| "key_generation")?;
        let provider = OpenMlsRustCrypto::default();
        signer.store(provider.storage()).map_err(|_| "storage_failed")?;
        Ok(Self {domain,media_group:RefCell::new(None),provider, signer, identity: identity.as_bytes().to_vec(),packages:RefCell::new(Vec::new())})
    }
    pub fn domain(&self)->DeviceDomain{self.domain}
    fn credential(&self) -> CredentialWithKey {
        CredentialWithKey {credential: BasicCredential::new(self.identity.clone()).into(), signature_key:self.signer.to_public_vec().into()}
    }
    pub fn public_key(&self) -> String { B64.encode(self.signer.to_public_vec()) }
    /// Secret snapshot: only the trusted local vault may access it. Never expose through renderer IPC.
    pub fn snapshot(&self) -> Result<Zeroizing<Vec<u8>>> {
        let storage = self.provider.storage().values.read().map_err(|_| "storage_failed")?;
        let mut snapshot = Snapshot {version:if self.domain==DeviceDomain::Media{2}else{1},domain:self.domain,media_group:self.media_group.borrow().clone(), identity:self.identity.clone(), signer:self.signer.clone(), storage: storage.iter().map(|(k,v)|(k.clone(),v.clone())).collect(),packages:self.packages.borrow().clone()};
        let encoded=serde_json::to_vec(&snapshot);
        for (key,value) in &mut snapshot.storage {key.zeroize();value.zeroize();}
        Ok(Zeroizing::new(encoded.map_err(|_| "serialize_failed")?))
    }
    pub fn restore(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > 64 * MAX_WIRE {return Err("size_limit");}
        let s:Snapshot=serde_json::from_slice(bytes).map_err(|_| "invalid_snapshot")?;
        if !matches!((s.version,s.domain),(1,DeviceDomain::Messages)|(2,DeviceDomain::Media)) || s.identity.is_empty() || s.identity.len()>512 {return Err("snapshot_version");}
        if s.media_group.as_ref().is_some_and(|id|s.domain!=DeviceDomain::Media||!media_group_id(id)){return Err("invalid_media_group");}
        let provider=OpenMlsRustCrypto::default();
        *provider.storage().values.write().map_err(|_| "storage_failed")?=s.storage.into_iter().collect();
        Ok(Self {domain:s.domain,media_group:RefCell::new(s.media_group),provider,signer:s.signer,identity:s.identity,packages:RefCell::new(s.packages)})
    }
    fn group(&self, id:&str) -> Result<MlsGroup> {
        if id.is_empty() || id.len()>256 {return Err("invalid_group");}
        MlsGroup::load(self.provider.storage(), &GroupId::from_slice(id.as_bytes())).map_err(|_| "storage_failed")?.ok_or("unknown_group")
    }
    pub fn key_package(&self) -> Result<String> {
        let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"invalid_clock")?.as_secs();
        let mut packages=self.packages.borrow_mut();let mut retained=Vec::new();
        for package in packages.iter(){
            if package.expires<=now {self.provider.storage().delete_key_package(&package.reference).map_err(|_|"storage_failed")?;}
            else {let stored:Option<KeyPackageBundle>=self.provider.storage().key_package(&package.reference).map_err(|_|"storage_failed")?;if stored.is_some(){retained.push(package.clone());}}
        }*packages=retained;
        if packages.len()>=1000{return Err("key_package_limit");}
        let lifetime=Lifetime::new(30*86400);
        let bundle=KeyPackage::builder().key_package_lifetime(lifetime.clone()).leaf_node_capabilities(capabilities()).build(SUITE,&self.provider,&self.signer,self.credential()).map_err(|_| "key_package_failed")?;
        packages.push(PackageRecord{reference:bundle.key_package().hash_ref(self.provider.crypto()).map_err(|_|"key_package_failed")?,expires:lifetime.not_after()});
        Ok(B64.encode(bundle.key_package().tls_serialize_detached().map_err(|_| "serialize_failed")?))
    }
    pub fn create(&self,id:&str) -> Result<()> {
        if self.domain!=DeviceDomain::Messages||id.starts_with(MEDIA_GROUP_PREFIX){return Err("group_domain_mismatch");}
        self.create_group(id)
    }
    pub fn create_media(&self,id:&str)->Result<()> {
        if self.domain!=DeviceDomain::Media||!media_group_id(id){return Err("group_domain_mismatch");}
        if self.media_group.borrow().is_some(){return Err("media_group_exists");}
        // A call outlives whoever started it: no owner policy, the voice service sequences
        // membership and every leaf must still be a device binding the main process verified.
        self.create_group_with(id,None)?;*self.media_group.borrow_mut()=Some(id.into());Ok(())
    }
    fn create_group(&self,id:&str)->Result<()> {
        let owner=principal(std::str::from_utf8(&self.identity).map_err(|_|"invalid_identity")?);
        self.create_group_with(id,Some(GroupPolicy{version:1,owner,history:"since_join".into()}))
    }
    fn create_group_with(&self,id:&str,policy:Option<GroupPolicy>)->Result<()> {
        if id.is_empty() || id.len()>256 {return Err("invalid_group");}
        if self.group(id).is_ok() {return Err("group_exists");}
        MlsGroup::new_with_group_id(&self.provider,&self.signer,&config(policy)?,GroupId::from_slice(id.as_bytes()),self.credential()).map_err(|_| "create_failed")?;
        Ok(())
    }
    fn media_only(&self,id:&str)->Result<()> {
        if self.domain!=DeviceDomain::Media||self.media_group.borrow().as_deref()!=Some(id){return Err("group_domain_mismatch");}Ok(())
    }
    fn messages_only(&self,id:&str)->Result<()> {
        if self.domain!=DeviceDomain::Messages||id.starts_with(MEDIA_GROUP_PREFIX){return Err("group_domain_mismatch");}Ok(())
    }
    /// One commit with every pending join and leave of a call, sequenced by the voice service.
    /// Added devices must match the identity and key whose binding the caller verified.
    pub fn media_commit(&self,id:&str,adds:&[MediaAdd],removes:&[u32])->Result<(String,Option<String>)> {
        self.media_only(id)?;
        if adds.is_empty()&&removes.is_empty(){return Err("empty_commit");}
        if adds.len()>256||removes.len()>256{return Err("member_limit");}
        let mut group=self.group(id)?;
        let mut packages=Vec::new();
        for add in adds {
            let kp=KeyPackageIn::tls_deserialize_exact(decode(&add.package)?).map_err(|_|"invalid_key_package")?.validate(self.provider.crypto(),ProtocolVersion::Mls10).map_err(|_|"invalid_key_package")?;
            if kp.ciphersuite()!=SUITE{return Err("unsupported_ciphersuite");}
            if identity(kp.leaf_node().credential())?!=add.identity||B64.encode(kp.leaf_node().signature_key().as_slice())!=add.key{return Err("identity_changed");}
            if group.members().any(|m|identity(&m.credential).as_deref()==Ok(add.identity.as_str()))||adds.iter().filter(|a|a.identity==add.identity).count()>1{return Err("duplicate_device");}
            packages.push(kp);
        }
        let own=group.own_leaf_index().u32();
        if removes.iter().any(|i|*i==own||!group.members().any(|m|m.index.u32()==*i)){return Err("invalid_removal");}
        if group.members().count()-removes.len()+packages.len()>256{return Err("member_limit");}
        let bundle=group.commit_builder().propose_removals(removes.iter().map(|i|LeafNodeIndex::new(*i))).propose_adds(packages)
            .load_psks(self.provider.storage()).map_err(|_|"commit_failed")?
            .build(self.provider.rand(),self.provider.crypto(),&self.signer,|_|true).map_err(|_|"commit_failed")?
            .stage_commit(&self.provider).map_err(|_|"commit_failed")?;
        let (commit,welcome,_)=bundle.into_contents();
        // The caller keeps the previous snapshot and rolls back if the service sequenced another commit.
        group.merge_pending_commit(&self.provider).map_err(|_|"commit_failed")?;
        let welcome=match welcome {Some(w)=>Some(encode(MlsMessageOut::from_welcome(w,ProtocolVersion::Mls10))?),None=>None};
        Ok((encode(commit)?,welcome))
    }
    /// Applies a call commit from any current member. Every resulting leaf must be trusted.
    pub fn media_accept(&self,id:&str,wire:&str,trusted:&[MemberInfo])->Result<()> {
        self.media_only(id)?;
        if trusted.len()>256{return Err("member_limit");}
        let is_trusted=|identity:&str,key:&[u8]|trusted.iter().any(|t|t.identity==identity&&t.signature_key==B64.encode(key));
        let mut group=self.group(id)?;
        let msg=MlsMessageIn::tls_deserialize_exact(decode(wire)?).map_err(|_|"invalid_message")?.try_into_protocol_message().map_err(|_|"invalid_message")?;
        let processed=group.process_message(&self.provider,msg).map_err(|_|"reject_commit")?;
        let sender=identity(processed.credential())?;
        if !group.members().any(|m|identity(&m.credential).ok().as_deref()==Some(sender.as_str())&&is_trusted(&sender,&m.signature_key)){return Err("unauthorized_commit");}
        let ProcessedMessageContent::StagedCommitMessage(commit)=processed.into_content() else {return Err("expected_commit")};
        for add in commit.add_proposals() {
            let leaf=add.add_proposal().key_package().leaf_node();
            if !is_trusted(&identity(leaf.credential())?,leaf.signature_key().as_slice()){return Err("untrusted_addition");}
        }
        // Removed from the call: the next epoch is never derived here, the caller retires the engine.
        if commit.remove_proposals().any(|p|p.remove_proposal().removed()==group.own_leaf_index()){return Err("removed_from_call");}
        group.merge_staged_commit(&self.provider,*commit).map_err(|_|"commit_failed")?;
        if group.members().count()>256{return Err("member_limit");}
        for member in group.members() {
            if !is_trusted(&identity(&member.credential)?,&member.signature_key){return Err("untrusted_members");}
        }
        Ok(())
    }
    pub fn add(&self,id:&str,package:&str,expected_identity:&str,expected_key:&str) -> Result<(String,String)> {
        self.messages_only(id)?;
        let bytes=decode(package)?;
        let kp=KeyPackageIn::tls_deserialize_exact(bytes).map_err(|_| "invalid_key_package")?.validate(self.provider.crypto(), ProtocolVersion::Mls10).map_err(|_| "invalid_key_package")?;
        if kp.ciphersuite()!=SUITE{return Err("unsupported_ciphersuite");}
        if identity(kp.leaf_node().credential())? != expected_identity || B64.encode(kp.leaf_node().signature_key().as_slice()) != expected_key {return Err("identity_changed");}
        let mut group=self.group(id)?;
        if group.members().any(|m|identity(&m.credential).as_deref()==Ok(expected_identity)){return Err("duplicate_device");}
        let added_principal=principal(expected_identity);
        let existing_user=group.members().any(|m|identity(&m.credential).map(|id|principal(&id)==added_principal).unwrap_or(false));
        if !existing_user && owner(&group)?!=principal(std::str::from_utf8(&self.identity).map_err(|_|"invalid_identity")?) {return Err("membership_owner_required");}
        if group.members().count() >= 256 {return Err("member_limit");}
        let (commit,welcome,_)=group.add_members(&self.provider,&self.signer,&[kp]).map_err(|_| "add_failed")?;
        // The caller must persist and reliably enqueue this result before publishing further messages.
        group.merge_pending_commit(&self.provider).map_err(|_| "commit_failed")?;
        Ok((encode(commit)?,encode(welcome)?))
    }
    /// Replace revoked devices of an existing principal atomically. The trusted main
    /// process must validate the replacement device's recovery endorsement first.
    pub fn replace(&self,id:&str,package:&str,expected_identity:&str,expected_key:&str,indices:&[u32])->Result<(String,String)>{
        if indices.is_empty()||indices.len()>255{return Err("invalid_removal");}
        let kp=KeyPackageIn::tls_deserialize_exact(decode(package)?).map_err(|_|"invalid_key_package")?.validate(self.provider.crypto(),ProtocolVersion::Mls10).map_err(|_|"invalid_key_package")?;
        if kp.ciphersuite()!=SUITE{return Err("unsupported_ciphersuite");}
        if identity(kp.leaf_node().credential())?!=expected_identity||B64.encode(kp.leaf_node().signature_key().as_slice())!=expected_key{return Err("identity_changed");}
        let mut group=self.group(id)?;
        if group.members().any(|m|identity(&m.credential).as_deref()==Ok(expected_identity)){return Err("duplicate_device");}
        for i in indices {let member=group.members().find(|m|m.index.u32()==*i).ok_or("invalid_removal")?;
            if principal(&identity(&member.credential)?)!=principal(expected_identity){return Err("replacement_principal_mismatch");}}
        let bundle=group.commit_builder().propose_removals(indices.iter().map(|i|LeafNodeIndex::new(*i))).propose_adds([kp])
            .load_psks(self.provider.storage()).map_err(|_|"replacement_failed")?
            .build(self.provider.rand(),self.provider.crypto(),&self.signer,|_|true).map_err(|_|"replacement_failed")?
            .stage_commit(&self.provider).map_err(|_|"replacement_failed")?;
        let (commit,welcome,_)=bundle.into_contents();
        group.merge_pending_commit(&self.provider).map_err(|_|"commit_failed")?;
        Ok((encode(commit)?,encode(MlsMessageOut::from_welcome(welcome.ok_or("replacement_failed")?,ProtocolVersion::Mls10))?))
    }
    pub fn join(&self,id:&str,wire:&str,expected:&[MemberInfo]) -> Result<()> {
        self.messages_only(id)?;
        self.join_group(id,wire,expected)
    }
    pub fn join_media(&self,id:&str,wire:&str,expected:&[MemberInfo])->Result<()> {
        if self.domain!=DeviceDomain::Media||!media_group_id(id){return Err("group_domain_mismatch");}
        if self.media_group.borrow().is_some(){return Err("media_group_exists");}
        self.join_group(id,wire,expected)?;*self.media_group.borrow_mut()=Some(id.into());Ok(())
    }
    fn join_group(&self,id:&str,wire:&str,expected:&[MemberInfo])->Result<()> {
        if expected.len()>256{return Err("member_limit");}
        if self.group(id).is_ok() {return Err("group_exists");}
        let welcome=match MlsMessageIn::tls_deserialize_exact(decode(wire)?).map_err(|_| "invalid_message")?.extract() {
            MlsMessageBodyIn::Welcome(w)=>w,
            _=>return Err("expected_welcome"),
        };
        if welcome.ciphersuite()!=SUITE{return Err("unsupported_ciphersuite");}
        let staged=StagedWelcome::new_from_welcome(&self.provider, config(None)?.join_config(), welcome, None).map_err(|_| "welcome_failed")?;
        let actual:Vec<MemberInfo>=staged.members().map(|m|Ok(MemberInfo{index:m.index.u32(),identity:identity(&m.credential)?,signature_key:B64.encode(m.signature_key)})).collect::<Result<_>>()?;
        if actual.len()!=expected.len() || actual.iter().any(|m|!expected.iter().any(|e|e.identity==m.identity&&e.signature_key==m.signature_key)) {return Err("untrusted_members");}
        let mut group=staged.into_group(&self.provider).map_err(|_| "join_failed")?;
        if self.domain==DeviceDomain::Messages {policy_of(&group)?;}
        if group.group_id().as_slice() != id.as_bytes() {group.delete(self.provider.storage()).map_err(|_| "storage_failed")?;return Err("wrong_group");}
        Ok(())
    }
    pub fn epoch(&self,id:&str) -> Result<u64> {Ok(self.group(id)?.epoch().as_u64())}
    /// RFC 9605 section 5.2. Only the current epoch of one dedicated call engine.
    /// Never expose this secret through renderer IPC or an application backup.
    pub fn media_base_key(&self,id:&str,expected_epoch:u64)->Result<Zeroizing<Vec<u8>>> {
        self.media_only(id)?;
        let group=self.group(id)?;
        if group.epoch().as_u64()!=expected_epoch{return Err("stale_media_epoch");}
        let secret=group.export_secret(self.provider.crypto(),"SFrame 1.0 Base Key",b"",32).map_err(|_|"media_export_failed")?;
        Ok(Zeroizing::new(secret))
    }
    pub fn own_index(&self,id:&str)->Result<u32>{Ok(self.group(id)?.own_leaf_index().u32())}
    pub fn members(&self,id:&str) -> Result<Vec<MemberInfo>> {
        self.group(id)?.members().map(|m|Ok(MemberInfo{index:m.index.u32(),identity:identity(&m.credential)?,signature_key:B64.encode(m.signature_key)})).collect()
    }
    pub fn send(&self,id:&str,plaintext:&str) -> Result<String> {
        if plaintext.len()>64*1024 {return Err("size_limit");}
        let mut group=self.group(id)?;
        encode(group.create_message(&self.provider,&self.signer,plaintext.as_bytes()).map_err(|_| "encrypt_failed")?)
    }
    pub fn receive(&self,id:&str,wire:&str) -> Result<Received> {
        let mut group=self.group(id)?;
        let msg=MlsMessageIn::tls_deserialize_exact(decode(wire)?).map_err(|_| "invalid_message")?.try_into_protocol_message().map_err(|_| "invalid_message")?;
        let processed=group.process_message(&self.provider,msg).map_err(|_| "reject_message")?;
        let sender=identity(processed.credential())?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(m) => Ok(Received{kind:"application",plaintext:Some(String::from_utf8(m.into_bytes()).map_err(|_| "invalid_payload")?),sender}),
            // Membership commits need application authorization; explicit accept_commit handles them.
            _ => Err("expected_application"),
        }
    }
    pub fn accept_commit(&self,id:&str,wire:&str,trusted:&[MemberInfo]) -> Result<()> {
        if trusted.len()>256{return Err("member_limit");}
        self.messages_only(id)?;
        let mut group=self.group(id)?;
        let msg=MlsMessageIn::tls_deserialize_exact(decode(wire)?).map_err(|_| "invalid_message")?.try_into_protocol_message().map_err(|_| "invalid_message")?;
        let processed=group.process_message(&self.provider,msg).map_err(|_| "reject_commit")?;
        let sender=identity(processed.credential())?;
        let authorized=group.members().any(|m|identity(&m.credential).ok().as_ref()==Some(&sender) && trusted.iter().any(|t|t.identity==sender && t.signature_key==B64.encode(&m.signature_key)));
        if !authorized {return Err("unauthorized_commit");}
        if let ProcessedMessageContent::StagedCommitMessage(commit)=processed.into_content() {
            let previous_policy=policy_of(&group)?;
            let existing:Vec<String>=group.members().filter_map(|m|identity(&m.credential).ok().map(|id|principal(&id))).collect();
            let new_user=commit.add_proposals().any(|p|identity(p.add_proposal().key_package().leaf_node().credential()).map(|id|!existing.contains(&principal(&id))).unwrap_or(true));
            let replaced:Vec<String>=commit.add_proposals().filter_map(|p|identity(p.add_proposal().key_package().leaf_node().credential()).ok().map(|id|principal(&id))).collect();
            let removing_other=commit.remove_proposals().any(|p|group.members().find(|m|m.index==p.remove_proposal().removed()).and_then(|m|identity(&m.credential).ok()).map(|id|principal(&id)!=principal(&sender)&&!replaced.contains(&principal(&id))).unwrap_or(true));
            if (new_user || removing_other) && owner(&group)?!=principal(&sender) {return Err("membership_owner_required");}
            // Do not allow additions without checking their signing keys against the trusted directory.
            let existing_devices:Vec<String>=group.members().filter_map(|m|identity(&m.credential).ok()).collect();
            for add in commit.add_proposals() {
                let key=add.add_proposal().key_package().leaf_node();
                let added=identity(key.credential())?;
                if existing_devices.contains(&added){return Err("duplicate_device");}
                if !trusted.iter().any(|t|t.identity==added && t.signature_key==B64.encode(key.signature_key().as_slice())) {return Err("untrusted_addition");}
            }
            group.merge_staged_commit(&self.provider,*commit).map_err(|_| "commit_failed")?;
            if group.members().count()>256{return Err("member_limit");}
            let policy=policy_of(&group)?;
            if policy!=previous_policy && previous_policy.owner!=principal(&sender){return Err("membership_owner_required");}
            if !group.members().any(|m|identity(&m.credential).map(|id|principal(&id)==policy.owner).unwrap_or(false)){return Err("membership_owner_missing");}
            for member in group.members() {
                let member_identity=identity(&member.credential)?;
                if !trusted.iter().any(|t|t.identity==member_identity && t.signature_key==B64.encode(&member.signature_key)) {return Err("untrusted_members");}
            }
            Ok(())
        } else {Err("expected_commit")}
    }

    pub fn policy(&self,id:&str)->Result<GroupPolicy>{policy_of(&self.group(id)?)}
    pub fn set_policy(&self,id:&str,history:&str,new_owner:Option<&str>)->Result<String>{
        let mut group=self.group(id)?;let mut policy=policy_of(&group)?;
        if policy.owner!=principal(std::str::from_utf8(&self.identity).map_err(|_|"invalid_identity")?){return Err("membership_owner_required");}
        if !["since_join","share_permanent"].contains(&history){return Err("invalid_group_policy");}
        policy.history=history.into();
        if let Some(owner)=new_owner {if !group.members().any(|m|identity(&m.credential).map(|id|principal(&id)==owner).unwrap_or(false)){return Err("new_owner_not_member");}policy.owner=owner.into();}
        let mut extensions:Vec<Extension>=group.extensions().iter().filter(|e|e.extension_type()!=ExtensionType::Unknown(POLICY_EXTENSION)).cloned().collect();
        extensions.push(Extension::Unknown(POLICY_EXTENSION,UnknownExtension(serde_json::to_vec(&policy).map_err(|_|"invalid_group_policy")?)));
        let extensions=Extensions::from_vec(extensions).map_err(|_|"invalid_group_policy")?;
        let (commit,_,_)=group.update_group_context_extensions(&self.provider,extensions,&self.signer).map_err(|_|"policy_update_failed")?;
        group.merge_pending_commit(&self.provider).map_err(|_|"commit_failed")?;encode(commit)
    }
    pub fn update(&self,id:&str) -> Result<String> {
        let mut group=self.group(id)?;
        let commit=group.self_update(&self.provider,&self.signer,LeafNodeParameters::default()).map_err(|_| "update_failed")?.into_commit();
        group.merge_pending_commit(&self.provider).map_err(|_| "commit_failed")?;
        encode(commit)
    }
    pub fn remove(&self,id:&str,index:u32) -> Result<String> {
        self.remove_many(id,&[index])
    }
    pub fn remove_many(&self,id:&str,indices:&[u32]) -> Result<String> {
        if indices.is_empty() || indices.len()>255{return Err("invalid_removal");}
        self.messages_only(id)?;
        let mut group=self.group(id)?;
        let me=principal(std::str::from_utf8(&self.identity).map_err(|_|"invalid_identity")?);
        if indices.iter().any(|i|!group.members().any(|m|m.index.u32()==*i))||group.members().any(|m|indices.contains(&m.index.u32())&&m.credential==self.credential().credential){return Err("invalid_removal");}
        let owner=owner(&group)?;
        if !group.members().filter(|m|!indices.contains(&m.index.u32())).any(|m|identity(&m.credential).map(|id|principal(&id)==owner).unwrap_or(false)){return Err("membership_owner_missing");}
        let removes_other=group.members().filter(|m|indices.contains(&m.index.u32())).any(|m|identity(&m.credential).map(|id|principal(&id)!=me).unwrap_or(true));
        if removes_other && owner!=me {return Err("membership_owner_required");}
        let indices:Vec<LeafNodeIndex>=indices.iter().map(|i|LeafNodeIndex::new(*i)).collect();
        let (commit,_,_)=group.remove_members(&self.provider,&self.signer,&indices).map_err(|_| "remove_failed")?;
        group.merge_pending_commit(&self.provider).map_err(|_| "commit_failed")?;
        encode(commit)
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        self.identity.zeroize();
        if let Ok(mut storage)=self.provider.storage().values.write() {
            for (mut key,mut value) in storage.drain() {key.zeroize();value.zeroize();}
        }
    }
}
