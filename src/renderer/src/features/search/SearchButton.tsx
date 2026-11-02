import {t as translate} from "../../../../shared/localization/index.ts";
import { Search } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "../../store.ts";
import { openModal } from "../../components/ui.tsx";
export function SearchButton({ placement = "titlebar" }: { placement?: "titlebar" | "members" }) {
  const view = useStore((s) => s.view),
    accounts = useStore((s) => s.accounts),
    modal = useStore((s) => s.modal);
  const accountId = "accountId" in view ? view.accountId : accounts[0]?.id;
  const open = () => {
    if (accountId) openModal({ kind: "search", accountId, ...(view.kind === "server" ? { serverId: view.serverId } : {}) });
  };
  useEffect(() => {
    if (placement !== "titlebar") return;
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !modal && view.kind !== "service") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [accountId, view, modal, placement]);
  return accountId && view.kind !== "service" && (placement === "members" ? view.kind === "server" : view.kind !== "server") ? (
    <button className="titlebar-search" onClick={open} aria-label={translate("common.fd3cfa0ab6b4")}>
      <Search size={14} />
      <span>{view.kind === "server" ? translate("common.f995fa5ca4fd") : translate("common.a85a80ba87f5")}</span>
      <kbd>{translate("common.854f7b248f9d")}</kbd>
    </button>
  ) : null;
}


