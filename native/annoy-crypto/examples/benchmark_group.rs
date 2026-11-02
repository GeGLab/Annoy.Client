//! Bounded synthetic MLS capacity probe. Never writes or prints protocol secrets.
//! This measures a coordinator and the newest receiver, not N online clients.
use annoy_crypto::Device;
use std::time::Instant;

fn main(){
    let args:Vec<String>=std::env::args().skip(1).collect();
    let members=args.first().map(|x|x.parse::<usize>().expect("invalid member count")).unwrap_or(32);
    let count=args.get(1).map(|x|x.parse::<usize>().expect("invalid message count")).unwrap_or(100);
    assert!(args.len()<=2&&(2..=256).contains(&members)&&(1..=1000).contains(&count),"bounded probe: 2..256 members, 1..1000 messages");
    let group="annoy/media/v1/synthetic-benchmark/call-a";
    let start=Instant::now();let a=Device::new_media("coordinator").expect("device");a.create_media(group).expect("group");
    let mut receiver=None;let mut max_welcome=0;let mut max_commit=0;
    for index in 1..members{
        let identity=format!("synthetic-device-{index}");let b=Device::new_media(&identity).expect("device");
        let (commit,welcome)=a.add(group,&b.key_package().expect("package"),&identity,&b.public_key()).expect("add");
        max_welcome=max_welcome.max(welcome.len());max_commit=max_commit.max(commit.len());
        // Earlier recipients remain offline in this probe. Keep only the latest
        // joiner; this intentionally does not measure all-member catch-up.
        if index==members-1{b.join_media(group,&welcome,&a.members(group).expect("members")).expect("join");receiver=Some(b);}
    }
    let setup_ms=start.elapsed().as_secs_f64()*1000.;let b=receiver.expect("receiver");
    let snapshot_bytes=a.snapshot().expect("snapshot").len();let mut times=Vec::with_capacity(count);let mut total_wire=0;
    for index in 0..count{
        let plaintext=format!("synthetic bounded probe message {index}");let tick=Instant::now();
        let wire=a.send(group,&plaintext).expect("send");total_wire+=wire.len();
        let received=b.receive(group,&wire).expect("receive");assert!(received.plaintext.as_deref()==Some(plaintext.as_str()),"content mismatch");
        times.push(tick.elapsed().as_secs_f64()*1000.);
    }
    times.sort_by(f64::total_cmp);
    let rss=std::fs::read_to_string("/proc/self/status").ok().and_then(|text|text.lines().find(|line|line.starts_with("VmHWM:")).and_then(|line|line.split_whitespace().nth(1)).and_then(|n|n.parse::<u64>().ok()));
    println!("{}",serde_json::json!({"format":1,"scope":"native MLS coordinator plus newest receiver; other leaves offline; no SFU, HTTP, Electron, vault, frame encryption or all-member synchronization",
        "members":members,"messages":count,"setupMs":setup_ms,"p50Ms":times[(count-1)/2],"p95Ms":times[(count-1)*95/100],"coordinatorSnapshotBytes":snapshot_bytes,
        "maxWelcomeBase64Bytes":max_welcome,"maxCommitBase64Bytes":max_commit,"meanApplicationBase64Bytes":total_wire/count,"peakRssKiB":rss}));
}
