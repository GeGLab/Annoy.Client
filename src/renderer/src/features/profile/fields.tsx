import type {ProfileFieldKind} from "@distopic/protocol";
import {Globe,Mail,Phone} from "lucide-react";
export const PROFILE_LABELS:Record<ProfileFieldKind,string>={linkedin:"LinkedIn",instagram:"Instagram",facebook:"Facebook",twitter:"X / Twitter",github:"GitHub",youtube:"YouTube",website:"Site pessoal",email:"E-mail de contato",phone:"Telefone"};
export const PROFILE_PLACEHOLDERS:Record<ProfileFieldKind,string>={linkedin:"https://www.linkedin.com/in/seu-perfil",instagram:"https://www.instagram.com/seu-perfil",facebook:"https://www.facebook.com/seu-perfil",twitter:"https://x.com/seu-perfil",github:"https://github.com/seu-perfil",youtube:"https://www.youtube.com/@seu-canal",website:"https://seusite.com",email:"voce@exemplo.com",phone:"+5511999999999"};
export const AUDIENCE_LABELS={self:"Somente eu",friends:"Amigos",community:"Amigos e comunidades em comum"};
/** Platform marks stay monochrome and inherit the existing theme. */
export function ProfileFieldIcon({kind}:{kind:ProfileFieldKind}) {
  if(kind==="website")return <Globe size={18} aria-hidden/>;
  if(kind==="email")return <Mail size={18} aria-hidden/>;
  if(kind==="phone")return <Phone size={18} aria-hidden/>;
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
    {kind==="linkedin"&&<><rect x="3" y="9" width="4" height="12" rx=".4"/><circle cx="5" cy="5" r="2.2"/><path d="M10 9h4v1.8c1-1.5 2-2.1 3.7-2.1 3 0 3.8 2 3.8 5V21h-4v-6.5c0-1.6-.4-2.5-1.7-2.5-1.4 0-1.8 1.1-1.8 2.7V21h-4z"/></>}
    {kind==="instagram"&&<><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2"/></>}
    {kind==="facebook"&&<path d="M14 22v-9h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.5c-.7-.1-1.8-.3-3-.3-3 0-5 1.9-5 5.3V9H7v4h3v9z"/>}
    {kind==="twitter"&&<path d="M3 3h5.4l4.6 6.2L18.4 3H21l-6.8 8 7.1 10h-5.4l-5-6.9L5 21H2.4l7.3-8.7zm3.2 2 10.7 14h1.4L7.7 5z"/>}
    {kind==="github"&&<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-2c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.4 2.2 1 2.9.8.1-.6.3-1 .6-1.3-2.3-.3-4.6-1.1-4.6-5A4 4 0 0 1 6.5 8c-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1a10 10 0 0 1 5.2 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a4 4 0 0 1 1.1 2.8c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.8V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/>}
    {kind==="youtube"&&<><rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 6 3-6 3z" fill="var(--bg-main)"/></>}
  </svg>;
}
