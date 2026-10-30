import type {User} from "@distopic/protocol";
import {useState} from "react";
import {useStore,EMPTY_ACTIVITIES} from "../store.ts";
import {canViewActivity} from "../features/activity/access.ts";
import {ActivityStack} from "../features/activity/ActivityCard.tsx";
import {useProfileDetails} from "../features/profile/use-profile.ts";
import {PROFILE_LABELS,ProfileFieldIcon} from "../features/profile/fields.tsx";
import {Dialog,DialogContent,DialogTitle,DialogTrigger,DialogDescription} from "./ui/dialog.tsx";
import {Button} from "./ui/button.tsx";
import {Avatar,Icon} from "./ui.tsx";

export function FullProfileButton({accountId,user}:{accountId:string;user:User}) {
  const [open,setOpen]=useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="secondary" size="sm"><Icon name="users" size={16}/>Ver perfil completo</Button></DialogTrigger>{open&&<FullProfile accountId={accountId} user={user}/>}</Dialog>;
}
function FullProfile({accountId,user}:{accountId:string;user:User}) {
  const {details,error,unavailable,loading,supported,connected,retry}=useProfileDetails(accountId,user.id);
  const instance=useStore(s=>s.instances[accountId]);
  const presence=instance?.presences[user.id]??"offline";
  const relationship=instance?.relationships.find(item=>item.user.id===user.id);
  const activities=canViewActivity(instance,user.id)?instance?.activities[user.id]??EMPTY_ACTIVITIES:EMPTY_ACTIVITIES;
  const identity=details?.user??user;
  return <DialogContent className="full-profile"><DialogTitle>Perfil de {relationship?.nickname||identity.displayName}</DialogTitle><DialogDescription>Informações compartilhadas nesta instância.</DialogDescription>
    <div className="full-profile-identity"><Avatar user={identity} presence={presence} size={72}/><div><h2>{relationship?.nickname||identity.displayName}</h2><p className="muted">@{identity.username}</p><span>{presence==="online"?"Online":presence==="idle"?"Ausente":presence==="dnd"?"Não incomodar":"Offline"}</span></div></div>
    {identity.bio&&<section><h3>Sobre mim</h3><p className="full-profile-bio">{identity.bio}</p></section>}
    {activities.length>0&&<section><h3>Agora</h3><ActivityStack activities={activities}/></section>}
    {!connected?<p role="status">Sem conexão. Reconecte para consultar os detalhes atuais.</p>:!supported?<p role="status">Atualize o Annoy.Server e reconecte para consultar contatos e histórico.</p>:loading?<p role="status">Carregando detalhes do perfil…</p>:unavailable?<p role="status">Este perfil não está mais disponível.</p>:error?<div role="alert"><p>{error}</p><Button variant="secondary" onClick={retry}>Tentar novamente</Button></div>:details&&<>
      <section><h3>Redes e contatos</h3>{details.fields.length>0?<ul className="profile-contact-list">{details.fields.map(field=><li key={field.kind}><ProfileFieldIcon kind={field.kind}/><div><strong>{PROFILE_LABELS[field.kind]}</strong>{["email","phone"].includes(field.kind)?<span>{field.value}{field.kind==="email"&&<small className="muted">Contato não verificado</small>}</span>:<a href={field.value} target="_blank" rel="noreferrer">{field.value}<Icon name="external" size={13}/></a>}</div></li>)}</ul>:<p className="muted">{details.hasPrivateFields?"Os contatos deste perfil são privados para você.":"Nenhum contato ou rede adicionado."}</p>}{details.hasPrivateFields&&details.fields.length>0&&<p className="muted small">Outros campos são privados para você.</p>}</section>
      <section><h3>Histórico de atividades</h3>{details.history.visibility==="disabled"?<p className="muted">O histórico está desativado.</p>:details.history.visibility==="private"?<p className="muted">Histórico disponível apenas para amigos e membros de comunidades em comum.</p>:details.history.entries.length===0?<p className="muted">Nenhuma sessão encerrada nos últimos 30 dias.</p>:<ol className="activity-history-list">{details.history.entries.map(entry=><li key={entry.id}><strong>{entry.name}</strong><span className="muted">{new Date(entry.startedAt).toLocaleString()} · {entry.endedAt?`${Math.max(0,Math.floor((Date.parse(entry.endedAt)-Date.parse(entry.startedAt))/60_000))} min observados`:"Duração indisponível; encerramento não confirmado"}</span></li>)}</ol>}<p className="muted small">Até três sessões encerradas, por até 30 dias. O registro começa somente após consentimento.</p></section>
    </>}
  </DialogContent>;
}
