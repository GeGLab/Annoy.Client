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
  return <div className="news-view"><aside className="news-sidebar"><Brand size={40} wordmark /><button className="channel active">{rich("common.7135be092dc0",{p0:(<Icon name="home" />)})}</button><button className="channel" onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}>{rich("common.5c8ab513644c",{p0:(<Icon name="users" />)})}</button><div className="spacer" /><UserPanel /></aside><section className="news-content"><header><Brand size={56} /><div><h1>{translate("common.e9e2484c356c")}</h1>{version && <p className="muted">{translate("news.version",{p0:version})}</p>}</div></header><article className="news-feature"><Icon name="users" size={32} /><h2>{translate("news.profile.title")}</h2><p>{translate("news.profile.body")}</p></article><div className="news-details"><article><Icon name="bell" /><h3>{translate("news.announcements.title")}</h3><p>{translate("news.announcements.body")}</p></article><article><Icon name="listOrdered" /><h3>{translate("news.polls.title")}</h3><p>{translate("news.polls.body")}</p></article><article><Icon name="song" /><h3>{translate("news.playlists.title")}</h3><p>{translate("news.playlists.body")}</p></article><article><Icon name="shield" /><h3>{translate("news.terms.title")}</h3><p>{translate("news.terms.body")}</p></article></div><div className="form-actions"><Button onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}>{rich("common.22a62136cec8",{p0:(<Icon name="right" />)})}</Button><Button variant="secondary" onClick={() => openModal({ kind: "userSettings" })}>{translate("common.6706dbe8b723")}</Button></div></section></div>;
}


