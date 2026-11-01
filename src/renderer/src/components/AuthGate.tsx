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
      <h1 id="auth-gate-title">Entre no Annoy</h1>
      <p>Uma conta autenticada é necessária para acessar o navegador, os serviços e suas comunidades.</p>
      <GlobalSignIn />
      <Button variant="ghost" onClick={()=>void(async()=>{const password=await promptText('Informe a senha local do cofre criptográfico.','',{secret:true});if(!password)return;try{await window.distopic?.crypto.unlock(password);toast('Cofre desbloqueado. Entre na conta.');}catch(error){toast((error as Error).message);}})()}>Desbloquear cofre local</Button>
      <Button variant="ghost" onClick={()=>setLocal(v=>!v)}>Histórico e backup locais</Button>{local&&<LocalHistory/>}
      <div className="or"><span>Servidor com contas locais</span></div>
      <p className="muted small">Acesso com conta local somente quando o administrador do servidor habilita esse modo.</p>
      <Button variant="secondary" onClick={() => openModal({ kind: "addAccount" })}>Conectar a um servidor</Button>
    </section>
  </main>;
}
