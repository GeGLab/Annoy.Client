import type { ServiceKind } from "../../../shared/services.ts";
import discord from "../assets/services/discord.svg";
import teamspeak from "../assets/services/teamspeak.svg";
import whatsapp from "../assets/services/whatsapp.svg";
import telegram from "../assets/services/telegram.svg";
import element from "../assets/services/element.svg";
import slack from "../assets/services/slack.png";
const logos: Partial<Record<ServiceKind, string>> = { discord, teamspeak, whatsapp, telegram, element, slack };
export function ServiceLogo({ kind }: { kind: ServiceKind }) { return logos[kind] ? <img className="service-logo" src={logos[kind]} alt="" draggable={false} /> : null; }
