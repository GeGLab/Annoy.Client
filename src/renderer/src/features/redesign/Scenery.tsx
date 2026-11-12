import { useId } from "react";

/** Original vector art. Kept local so the prototype also works without internet. */
export function Scenery({ className = "", variant = "night" }: { className?: string; variant?: string }) {
  const id = useId().replace(/:/g, "");
  const green = variant === "green";
  const orange = variant === "orange";
  const sky = green ? ["#546e69", "#adbe94"] : orange ? ["#3b4e68", "#e8a078"] : ["#101c2d", "#263c51"];
  return <svg className={`scenery ${className}`} viewBox="0 0 900 330" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}sky`} x2="0" y2="1"><stop stopColor={sky[0]}/><stop offset="1" stopColor={sky[1]}/></linearGradient>
      <linearGradient id={`${id}water`} x2="0" y2="1"><stop stopColor={green ? "#899c86" : "#365166"}/><stop offset="1" stopColor={green ? "#526f69" : "#192d40"}/></linearGradient>
    </defs>
    <path fill={`url(#${id}sky)`} d="M0 0h900v330H0z"/>
    <circle cx="616" cy="94" r="43" fill={green ? "#e4dfb2" : "#c6dce8"}/>
    <circle cx="616" cy="94" r="61" stroke="#b5cfdf" strokeOpacity=".17"/>
    <circle cx="616" cy="94" r="84" stroke="#b5cfdf" strokeOpacity=".09"/>
    <path d="M0 190 110 103 191 163 310 76 459 199 560 147 647 188 764 95 900 169v161H0Z" fill={green ? "#698078" : "#293e52"}/>
    <path d="m256 121 54-45 48 40-33-8-14 14-18-18-14 15Z" fill="#bdd1df" fillOpacity=".45"/>
    <path d="M0 171 93 219 227 156 355 208 477 158 573 213 727 147 900 194v136H0Z" fill={green ? "#4d6b66" : "#1c3043"}/>
    <path d="M0 257c129-39 192-20 310-20 170 0 234-40 366-30s155 30 224 22v101H0Z" fill={`url(#${id}water)`}/>
    <path d="M414 247h222m-187 12h260m-195 14h169m-105 18h175" stroke="#a8c7db" strokeOpacity=".3" strokeWidth="2" strokeLinecap="round"/>
    <path d="M0 224c112 19 151 62 308 75 201 17 293-24 411-27 83-2 136 5 181 22v36H0Z" fill={green ? "#324e49" : "#112335"}/>
    <path d="M0 297c142-8 203 37 362 33H0Z" fill="#0d1c2b"/>
    {[28, 75, 123, 164, 820, 863, 895].map((x, i) => <g key={x} transform={`translate(${x} ${i < 4 ? 170 + i * 14 : 164 + (i % 3) * 13}) scale(${i % 2 ? 1.1 : 1.4})`} fill={green ? "#2e4742" : "#0d2031"}><path d="M0 0-15 29h8l-15 23h12l-15 24h50L10 52h12L7 29h8Z"/><path d="M-2 66h4v28h-4z"/></g>)}
    <path d="m715 284 31-54 39 54Z" fill="#c78b83"/><path d="m746 230 5 54h34Z" fill="#dfa18e"/><path d="m733 284 13-31 6 31Z" fill="#283c4c"/>
    <path d="m652 303 15-7m-14-1 14 8" stroke="#b89181" strokeWidth="4" strokeLinecap="round"/><path d="M660 297c-14-9 4-11 1-23 14 12 14 16 4 23Z" fill="#f1ba83"/><path d="M660 298c-6-6 2-8 3-12 4 7 5 10 0 12Z" fill="#f7dda3"/>
    {[{ x: 130, y: 49 }, { x: 425, y: 35 }, { x: 744, y: 35 }, { x: 833, y: 69 }, { x: 50, y: 84 }, { x: 505, y: 84 }].map(({ x, y }) => <path key={x} d={`M${x - 2} ${y}h4m-2-2v4`} stroke="#c9dce8" strokeOpacity=".65" strokeLinecap="round"/>)}
    <path d="m201 52 8-3 8 3m-15 8 5-2 5 2" stroke="#d4e1e9" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>;
}
