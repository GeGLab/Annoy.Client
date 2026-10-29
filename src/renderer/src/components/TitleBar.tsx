import { useEffect, useState } from "react";
import { useStore } from "../store.ts";
import { Brand } from "./Brand.tsx";
import { SearchButton } from "../features/search/SearchButton.tsx";
import { Icon } from "./ui.tsx";

export function TitleBar() {
  const view = useStore((s) => s.view);
  const server = useStore((s) => (view.kind === "server" ? s.instances[view.accountId]?.serverStates[view.serverId] : undefined));
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void window.distopic?.window.isMaximized().then(setMaximized);
    return window.distopic?.window.onMaximized(setMaximized);
  }, []);
  const channel = view.kind === "server" ? server?.channels.find((c) => c.id === view.channelId) : null;
  const title =
    view.kind === "marketplace"
      ? "Loja de bots · Annoy"
      : view.kind === "discord"
        ? "Discord"
        : view.kind === "home"
          ? "Seu espaço para conversar"
          : [server?.server.name, channel?.name].filter(Boolean).join(" / ") || "Annoy";
  return (
    <header className={`titlebar${window.distopic?.platform === "darwin" ? " titlebar-mac" : ""}`}>
      <Brand size={18} wordmark />
      <span className="titlebar-context truncate">{title}</span>
      <SearchButton />
      <div className="window-controls">
        <a
          className="window-control window-help"
          href="https://github.com/GeGLab/annoy-client#readme"
          target="_blank"
          rel="noreferrer"
          aria-label="Ajuda do Annoy"
          title="Ajuda do Annoy"
        >
          <Icon name="info" size={15} />
        </a>
        {window.distopic?.platform !== "darwin" && window.distopic && (
          <>
            <button className="window-control" onClick={() => window.distopic?.window.minimize()} aria-label="Minimizar">
              <Icon name="minus" size={14} />
            </button>
            <button
              className="window-control"
              onClick={() => window.distopic?.window.maximize()}
              aria-label={maximized ? "Restaurar janela" : "Maximizar"}
            >
              <Icon name={maximized ? "restore" : "square"} size={12} />
            </button>
            <button className="window-control window-close" onClick={() => window.distopic?.window.close()} aria-label="Fechar janela">
              <Icon name="x" size={16} />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
