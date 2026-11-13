import {t as translate} from "../../../shared/localization/index.ts";
import { useEffect, useState } from "react";
import { useStore } from "../store.ts";
import { Brand } from "./Brand.tsx";
import { SearchButton } from "../features/search/SearchButton.tsx";
import { Icon } from "./ui.tsx";

export function TitleBar() {
  const view = useStore((s) => s.view);
  const server = useStore((s) => (view.kind === "server" ? s.instances[view.accountId]?.serverStates[view.serverId] : undefined));
  const service = useStore((s) => (view.kind === "service" ? s.services.find((sv) => sv.id === view.serviceId) : undefined));
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void window.annoy?.window.isMaximized().then(setMaximized);
    return window.annoy?.window.onMaximized(setMaximized);
  }, []);
  const channel = view.kind === "server" ? server?.channels.find((c) => c.id === view.channelId) : null;
  const title =
    view.kind === "marketplace"
      ? translate("integrations.store")
      : view.kind === "service"
        ? (service?.name ?? "Annoy")
        : view.kind === "home"
          ? translate("titlebar.home")
          : [server?.server.name, channel?.name].filter(Boolean).join(" / ") || "Annoy";
  return (
    <header className={`titlebar${window.annoy?.platform === "darwin" ? " titlebar-mac" : ""}`}>
      <Brand size={24} wordmark />
      <span className="titlebar-context truncate">{title}</span>
      <SearchButton />
      <div className="window-controls">
        <a
          className="window-control window-help"
          href="https://github.com/GeGLab/annoy-client#readme"
          target="_blank"
          rel="noreferrer"
          aria-label={translate("common.7709ab721533")}
          title={translate("common.7709ab721533")}
        >
          <Icon name="info" size={15} />
        </a>
        {window.annoy?.platform !== "darwin" && window.annoy && (
          <>
            <button className="window-control" onClick={() => window.annoy?.window.minimize()} aria-label={translate("common.3fc5f90b27f1")}>
              <Icon name="minus" size={14} />
            </button>
            <button
              className="window-control"
              onClick={() => window.annoy?.window.maximize()}
              aria-label={maximized ? translate("common.d2a6ab8b615f") : translate("common.092b9ccfbf63")}
            >
              <Icon name={maximized ? "restore" : "square"} size={12} />
            </button>
            <button className="window-control window-close" onClick={() => window.annoy?.window.close()} aria-label={translate("common.23ab80ae9880")}>
              <Icon name="x" size={16} />
            </button>
          </>
        )}
      </div>
    </header>
  );
}




