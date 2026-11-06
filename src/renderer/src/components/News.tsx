import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import { useStore } from "../store.ts";
import { navigate } from "../client.ts";
import { Brand } from "./Brand.tsx";
import { Icon, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { UserPanel } from "./TopBar.tsx";

export function News() {
  const version = useStore((s) => s.update?.currentVersion);
  const account = useStore((s) => s.accounts[0]);
  return <div className="news-view"><aside className="news-sidebar"><Brand size={40} wordmark /><button className="channel active">{rich("common.7135be092dc0",{p0:(<Icon name="home" />)})}</button><button className="channel" onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}>{rich("common.5c8ab513644c",{p0:(<Icon name="users" />)})}</button><div className="spacer" /><UserPanel /></aside><section className="news-content"><header><Brand size={56} /><div><h1>{translate("common.e9e2484c356c")}</h1>{version && <p className="muted">{translate("news.version",{p0:version})}</p>}</div></header><article className="news-feature"><Icon name="globe" size={32} /><h2>{translate("news.social.title")}</h2><p>{translate("news.social.body")}</p></article><div className="news-details"><article><Icon name="mic" /><h3>{translate("news.login.title")}</h3><p>{translate("news.login.body")}</p></article><article><Icon name="smile" /><h3>{translate("news.voice.title")}</h3><p>{translate("news.voice.body")}</p></article><article><Icon name="palette" /><h3>{translate("news.settings.title")}</h3><p>{translate("news.settings.body")}</p></article><article><Icon name="refresh" /><h3>{translate("news.updates.title")}</h3><p>{translate("news.updates.body")}</p></article></div><div className="form-actions"><Button onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}>{rich("common.22a62136cec8",{p0:(<Icon name="right" />)})}</Button><Button variant="secondary" onClick={() => openModal({ kind: "userSettings" })}>{translate("common.6706dbe8b723")}</Button></div></section></div>;
}


