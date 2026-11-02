//! Private stdio protocol, consumed only by the trusted Electron main process.
//! Stdout contains secret snapshots. It must never be logged or forwarded to renderer.
use annoy_crypto::{Device,DeviceDomain,MediaAdd,MemberInfo,MEDIA_CIPHER_SUITE};
use base64::{engine::general_purpose::STANDARD as B64,Engine as _};
use serde::Deserialize;
use serde_json::{json,Value};
use std::io::{self,BufRead,Read,Write};
use zeroize::{Zeroize,Zeroizing};

#[derive(Deserialize)]
#[serde(tag="op",rename_all="snake_case",deny_unknown_fields)]
enum Command {
 Init{identity:String}, InitMedia{identity:String}, Restore{snapshot:String,#[serde(default)]domain:DeviceDomain}, KeyPackage, PublicKey,
 CreateMedia{group:String}, JoinMedia{group:String,wire:String,members:Vec<MemberInfo>}, MediaBaseKey{group:String,epoch:String},
 MediaCommit{group:String,adds:Vec<MediaAdd>,removes:Vec<u32>}, MediaAccept{group:String,wire:String,members:Vec<MemberInfo>},
 Create{group:String}, Members{group:String}, Info{group:String},
 Add{group:String,package:String,identity:String,key:String},
 Replace{group:String,package:String,identity:String,key:String,indices:Vec<u32>},
 Join{group:String,wire:String,members:Vec<MemberInfo>},
 Send{group:String,plaintext:String}, Receive{group:String,wire:String},
 Commit{group:String,wire:String,members:Vec<MemberInfo>},
 Update{group:String}, Policy{group:String,history:String,owner:Option<String>}, Remove{group:String,indices:Vec<u32>},
}
fn execute(device:&mut Option<Device>,cmd:Command)->Result<Value,&'static str> {
 match cmd {
  Command::Init{identity}=>{if device.is_some(){return Err("already_initialized");}*device=Some(Device::new(&identity)?);Ok(json!({"publicKey":device.as_ref().unwrap().public_key(),"domain":"messages"}))},
  Command::InitMedia{identity}=>{if device.is_some(){return Err("already_initialized");}*device=Some(Device::new_media(&identity)?);Ok(json!({"publicKey":device.as_ref().unwrap().public_key(),"domain":"media"}))},
  Command::Restore{snapshot,domain}=>{let snapshot=Zeroizing::new(snapshot);if device.is_some(){return Err("already_initialized");}let bytes=Zeroizing::new(B64.decode(&*snapshot).map_err(|_|"invalid_snapshot")?);let restored=Device::restore(&bytes)?;if restored.domain()!=domain{return Err("group_domain_mismatch");}*device=Some(restored);Ok(json!({"restored":true,"domain":domain}))},
  cmd=>{
   let d=device.as_ref().ok_or("not_initialized")?;
   match cmd {
    Command::PublicKey=>Ok(json!({"key":d.public_key()})),
    Command::KeyPackage=>Ok(json!({"package":d.key_package()?})),
    Command::Create{group}=>{d.create(&group)?;Ok(json!({"created":true}))},
    Command::CreateMedia{group}=>{d.create_media(&group)?;Ok(json!({"created":true,"epoch":d.epoch(&group)?.to_string(),"members":d.members(&group)?}))},
    Command::JoinMedia{group,wire,members}=>{d.join_media(&group,&wire,&members)?;Ok(json!({"joined":true,"epoch":d.epoch(&group)?.to_string(),"members":d.members(&group)?}))},
    Command::MediaCommit{group,adds,removes}=>{let(commit,welcome)=d.media_commit(&group,&adds,&removes)?;Ok(json!({"commit":commit,"welcome":welcome,"epoch":d.epoch(&group)?.to_string(),"members":d.members(&group)?}))},
    Command::MediaAccept{group,wire,members}=>{d.media_accept(&group,&wire,&members)?;Ok(json!({"committed":true,"epoch":d.epoch(&group)?.to_string(),"members":d.members(&group)?}))},
    Command::MediaBaseKey{group,epoch}=>{let expected=epoch.parse::<u64>().map_err(|_|"invalid_media_epoch")?;if expected.to_string()!=epoch{return Err("invalid_media_epoch");}let secret=d.media_base_key(&group,expected)?;Ok(json!({"version":1,"suite":MEDIA_CIPHER_SUITE,"epoch":epoch,"senderIndex":d.own_index(&group)?,"baseKey":B64.encode(&*secret)}))},
    Command::Info{group}=>Ok(json!({"epoch":d.epoch(&group)?,"members":d.members(&group)?,"policy":d.policy(&group)?})),
    Command::Members{group}=>Ok(json!(d.members(&group)?)),
    Command::Add{group,package,identity,key}=>{let (commit,welcome)=d.add(&group,&package,&identity,&key)?;Ok(json!({"commit":commit,"welcome":welcome,"epoch":d.epoch(&group)?,"members":d.members(&group)?}))},
    Command::Replace{group,package,identity,key,indices}=>{let(commit,welcome)=d.replace(&group,&package,&identity,&key,&indices)?;Ok(json!({"commit":commit,"welcome":welcome,"epoch":d.epoch(&group)?,"members":d.members(&group)?}))},
    Command::Join{group,wire,members}=>{d.join(&group,&wire,&members)?;Ok(json!({"joined":true}))},
    Command::Send{group,plaintext}=>{let plaintext=Zeroizing::new(plaintext);Ok(json!({"wire":d.send(&group,&plaintext)?,"epoch":d.epoch(&group)?,"members":d.members(&group)?}))},
    Command::Receive{group,wire}=>Ok(json!(d.receive(&group,&wire)?)),
    Command::Commit{group,wire,members}=>{d.accept_commit(&group,&wire,&members)?;Ok(json!({"committed":true}))},
    Command::Policy{group,history,owner}=>Ok(json!({"commit":d.set_policy(&group,&history,owner.as_deref())?,"epoch":d.epoch(&group)?,"members":d.members(&group)?})),
    Command::Update{group}=>Ok(json!({"commit":d.update(&group)?,"epoch":d.epoch(&group)?,"members":d.members(&group)?})),
    Command::Remove{group,indices}=>Ok(json!({"commit":d.remove_many(&group,&indices)?,"epoch":d.epoch(&group)?,"members":d.members(&group)?})),
    _=>Err("invalid_command"),
   }
  }
 }
}
fn wipe_response(value:&mut Value){
 match value {Value::String(s)=>s.zeroize(),Value::Array(a)=>a.iter_mut().for_each(wipe_response),Value::Object(o)=>o.values_mut().for_each(wipe_response),_=>{}}
}
fn main() {
 let stdin=io::stdin();let mut input=stdin.lock();let stdout=io::stdout();let mut output=stdout.lock();
 let mut device:Option<Device>=None;
 loop {
  let mut line=Zeroizing::new(Vec::new());
  let read=(&mut input).take(96*1024*1024+1).read_until(b'\n',&mut line);
  if read.is_err() || read.unwrap_or(0)==0 {break;}
  if line.len()>96*1024*1024 {break;}
  let previous=device.as_ref().and_then(|d|d.snapshot().ok());
  let result=serde_json::from_slice::<Command>(&line).map_err(|_|"invalid_command").and_then(|cmd|execute(&mut device,cmd));
  let mut response=match result {
   Ok(result)=>match device.as_ref().unwrap().snapshot() {
    Ok(snapshot)=>json!({"ok":true,"result":result,"snapshot":B64.encode(&*snapshot)}),
    Err(_)=>break,
   },
   Err(error)=>{
    // Failed parsing, authentication or authorization must not advance MLS state.
    if let Some(previous)=previous {match Device::restore(&previous){Ok(restored)=>device=Some(restored),Err(_)=>break}}
    json!({"ok":false,"error":error})
   }
  };
  let failed=serde_json::to_writer(&mut output,&response).is_err() || writeln!(output).is_err() || output.flush().is_err();
  wipe_response(&mut response);if failed {break;}
 }
}
