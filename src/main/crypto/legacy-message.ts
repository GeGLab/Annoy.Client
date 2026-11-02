import {t as translate} from "../../shared/localization/index.ts";
import {z} from 'zod';
import type {Message} from '@distopic/protocol';
const id=z.string().min(1).max(100),date=z.string().max(50).refine(v=>Number.isFinite(Date.parse(v))).transform(v=>new Date(v).toISOString());
const schema=z.object({id,channelId:id,author:z.object({id,username:z.string().max(100),displayName:z.string().max(200)}),content:z.string().max(4000),createdAt:date,editedAt:date.nullable(),replyToId:id.nullable(),attachments:z.array(z.object({id:z.string().regex(/^[a-f0-9]{32}$/),filename:z.string().min(1).max(200),contentType:z.string().max(120),size:z.number().int().min(0).max(500*1024*1024)})).max(10),mentionIds:z.array(id).max(256).default([]),mentionsEveryone:z.boolean().default(false),reactions:z.array(z.object({emoji:z.string().max(32),userIds:z.array(id).max(256)})).max(20).optional()});
export function parseLegacyMessage(raw:unknown,channel:string):Message {
 const parsed=schema.safeParse(raw);if(!parsed.success||parsed.data.channelId!==channel)throw new Error(translate("common.7667a614c619"));
 return {...parsed.data,protection:'legacy_plaintext',author:{...parsed.data.author,avatarUrl:null},attachments:parsed.data.attachments.map(f=>({...f,url:'annoy-archive:'+f.id}))};
}
