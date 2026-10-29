import { Search } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "../../store.ts";
import { openModal } from "../../components/ui.tsx";
export function SearchButton() {
  const view = useStore((s) => s.view),
    accounts = useStore((s) => s.accounts),
    modal = useStore((s) => s.modal);
  const accountId = "accountId" in view ? view.accountId : accounts[0]?.id;
  const open = () => {
    if (accountId) openModal({ kind: "search", accountId, ...(view.kind === "server" ? { serverId: view.serverId } : {}) });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !modal && view.kind !== "discord") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [accountId, view, modal]);
  return accountId && view.kind !== "discord" ? (
    <button className="titlebar-search" onClick={open} aria-label="Buscar mensagens (Ctrl+K)">
      <Search size={14} />
      <span>{view.kind === "server" ? "Buscar no servidor" : "Buscar mensagens"}</span>
      <kbd>Ctrl K</kbd>
    </button>
  ) : null;
}
