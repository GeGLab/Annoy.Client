import {z} from 'zod';
import {LIMITS} from '@distopic/protocol';
const id=z.string().min(1).max(100);
const attachment=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),filename:z.string().min(1).max(200),size:z.number().int().min(0).max(64*1024*1024),contentType:z.string().max(120),url:z.string().max(100),fileKey:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().refine(f=>f.url==='annoy-encrypted:'+f.id);
export const messageSchema=z.object({id:z.uuid(),channelId:id,author:z.object({id,username:z.string().max(100),displayName:z.string().max(200),avatarUrl:z.null(),bio:z.string().max(1000).optional()}).strict(),content:z.string().max(LIMITS.messageMax),createdAt:z.iso.datetime(),editedAt:z.iso.datetime().nullable(),replyToId:id.nullable(),attachments:z.array(attachment).max(10),mentionIds:z.array(id).max(256),mentionsEveryone:z.boolean(),reactions:z.array(z.object({emoji:z.string().max(32),userIds:z.array(id).max(256)})).max(20).optional(),expiresAt:z.iso.datetime().nullable().optional(),protection:z.enum(['e2ee','legacy_plaintext']).optional(),sharedBy:id.optional()}).strict();
const base={v:z.literal(1),id:z.uuid(),authorId:id,at:z.iso.datetime(),expiresAt:z.iso.datetime().nullable()};
const schema=z.discriminatedUnion('kind',[
 z.object({v:z.literal(1),kind:z.literal('message'),message:messageSchema}).strict(),
 z.object({...base,kind:z.literal('edit'),targetId:z.uuid(),content:z.string().max(LIMITS.messageMax)}).strict(),
 z.object({...base,kind:z.literal('delete'),targetId:z.uuid()}).strict(),
 z.object({...base,kind:z.literal('reaction'),targetId:z.uuid(),emoji:z.string().min(1).max(32),add:z.boolean()}).strict(),
 z.object({...base,kind:z.literal('history'),messages:z.array(messageSchema).max(20)}).strict(),
]);
export type AppPayload=z.infer<typeof schema>;
export function parsePayload(text:string):AppPayload {
 try{const result=schema.safeParse(JSON.parse(text));if(result.success)return result.data;}catch{}
 throw new Error('Conteúdo de mensagem inválido');
}
