import { useStore } from "../store.ts";
import { navigate } from "../client.ts";
import { Brand } from "./Brand.tsx";
import { Icon, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { UserPanel } from "./TopBar.tsx";

export function News() {
  const version = useStore((s) => s.update?.currentVersion);
  const account = useStore((s) => s.accounts[0]);
  return <div className="news-view"><aside className="news-sidebar"><Brand size={40} wordmark /><button className="channel active"><Icon name="home" />Novidades</button><button className="channel" onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}><Icon name="users" />Amigos e conversas</button><div className="spacer" /><UserPanel /></aside><section className="news-content"><header><Brand size={56} /><div><h1>Novidades do Annoy</h1><p className="muted">Seu espaço para conversar, agora mais próximo de você.{version ? ` · Versão ${version}` : ""}</p></div></header><article className="news-feature"><Icon name="phone" size={32} /><h2>Converse de perto</h2><p>Chamadas privadas de áudio e vídeo entre amigos, com convite e aviso sonoro. Os novos recursos sociais precisam da instância atualizada.</p></article><div className="news-details"><article><Icon name="monitor" /><h3>Compartilhe no seu ritmo</h3><p>Escolha resolução e FPS ao transmitir sua tela, com a qualidade selecionada visível para a sala.</p></article><article><Icon name="code" /><h3>Mostre o que está fazendo</h3><p>Jogos, músicas e projetos de programação podem aparecer na sua atividade para amigos e pessoas dos mesmos servidores.</p></article><article><Icon name="bell" /><h3>Deixe do seu jeito</h3><p>Personalize o perfil, organize as preferências e silencie os canais que precisam de menos atenção.</p></article></div><div className="form-actions"><Button onClick={() => navigate({ kind: "home", accountId: account?.id ?? null, dmId: null })}>Abrir conversas<Icon name="right" /></Button><Button variant="secondary" onClick={() => openModal({ kind: "userSettings" })}>Preferências</Button></div></section></div>;
}
