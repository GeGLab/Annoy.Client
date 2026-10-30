import type { Message } from "@distopic/protocol";

export const CHANNEL_MESSAGE_LIMIT=500;
export const TOTAL_MESSAGE_LIMIT=5000;
export function mergeMessageWindow(previous:readonly Message[],incoming:readonly Message[],direction:"before"|"after"|"replace") {
  const byId=new Map((direction==="replace"?[]:previous).map(message=>[message.id,message]));
  for(const message of incoming) byId.set(message.id,message);
  const sorted=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const overflow=sorted.length>CHANNEL_MESSAGE_LIMIT;
  return {items:direction==="before"?sorted.slice(0,CHANNEL_MESSAGE_LIMIT):sorted.slice(-CHANNEL_MESSAGE_LIMIT),evictedBefore:overflow&&direction!=="before",evictedAfter:overflow&&direction==="before"};
}
