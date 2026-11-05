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
  return <div className="news-view"><aside className="news-sidebar"><Brand size={40} wordmark /><button className="channel active">{rich("common.7135be092dc0",{p0:(<Icon name="home" />)})}</button><button className="channel" onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}>{rich("common.5c8ab513644c",{p0:(<Icon name="users" />)})}</button><div className="spacer" /><UserPanel /></aside><section className="news-content"><header><Brand size={56} /><div><h1>{translate("common.e9e2484c356c")}</h1>{version && <p className="muted">{translate("news.version",{p0:version})}</p>}</div></header><article className="news-feature"><Icon name="phone" size={32} /><h2>{translate("common.ab6b727d1ac4")}</h2><p>{translate("common.b0603e3234cc")}</p></article><div className="news-details"><article><Icon name="monitor" /><h3>{translate("common.d1a31257925f")}</h3><p>{translate("common.eb0aad72b197")}</p></article><article><Icon name="code" /><h3>{translate("common.8c765aa8c878")}</h3><p>{translate("common.1f7569f74ec0")}</p></article><article><Icon name="bell" /><h3>{translate("common.73b9be322c42")}</h3><p>{translate("common.0573290296e3")}</p></article></div><div className="form-actions"><Button onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}>{rich("common.22a62136cec8",{p0:(<Icon name="right" />)})}</Button><Button variant="secondary" onClick={() => openModal({ kind: "userSettings" })}>{translate("common.6706dbe8b723")}</Button></div></section></div>;
}


