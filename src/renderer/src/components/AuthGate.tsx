import {t as translate} from "../../../shared/localization/index.ts";
import {useState} from 'react';
import {LocalHistory} from './LocalHistory.tsx';
import {promptText} from "./ui/action-dialog.tsx";
import {toast} from "../store.ts";
import { GlobalSignIn } from "./GlobalSignIn.tsx";
import { Brand } from "./Brand.tsx";
import { Button } from "./ui/button.tsx";
import { openModal } from "./ui.tsx";

export function AuthGate() {
  const [local,setLocal]=useState(false);
  return <main className="auth-gate" aria-labelledby="auth-gate-title">
    <section className="auth-gate-card">
      <Brand size={52} wordmark />
      <h1 id="auth-gate-title">{translate("common.87fa6f65b17e")}</h1>
      <p>{translate("common.d3fde689cbf2")}</p>
      <GlobalSignIn />
      <Button variant="ghost" onClick={()=>void(async()=>{const password=await promptText(translate("common.e9df160310cf"),'',{secret:true});if(!password)return;try{await window.distopic?.crypto.unlock(password);toast('Cofre desbloqueado. Entre na conta.');}catch(error){toast((error as Error).message);}})()}>{translate("common.ed4dd823ab26")}</Button>
      <Button variant="ghost" onClick={()=>setLocal(v=>!v)}>{translate("common.fa22d17afd3d")}</Button>{local&&<LocalHistory/>}
      <div className="or"><span>{translate("common.69eb14f15555")}</span></div>
      <p className="muted small">{translate("common.676d78f05d40")}</p>
      <Button variant="secondary" onClick={() => openModal({ kind: "addAccount" })}>{translate("common.970cfa322bb7")}</Button>
    </section>
  </main>;
}
