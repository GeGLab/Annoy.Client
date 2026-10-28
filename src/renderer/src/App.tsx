import { useEffect } from "react";
import { connectAll, navigate, setPushToTalk } from "./client.ts";
import { getState, setState, useStore } from "./store.ts";
import { AddAccountModal, CreateServerModal } from "./components/AccountModals.tsx";
import { Home } from "./components/Home.tsx";
import { ImportDiscordModal } from "./components/ImportModal.tsx";
import { DeleteAccountModal, InstanceAdminModal } from "./components/InstanceAdmin.tsx";
import { ServerView } from "./components/ServerView.tsx";
import { ChannelSettingsModal, CreateChannelModal, InviteModal, ServerSettingsModal, UserSettingsModal } from "./components/Settings.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { ScreenPickerModal } from "./components/VoiceStage.tsx";
import { BANNER_HEIGHT, isBlocking, MandatoryUpdate, UpdateBanner, useBannerVisible, useUpdateState } from "./components/Updates.tsx";

function Modals() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case "addAccount":
      return <AddAccountModal />;
    case "createServer":
      return <CreateServerModal accountId={modal.accountId} />;
    case "serverSettings":
      return <ServerSettingsModal accountId={modal.accountId} serverId={modal.serverId} />;
    case "channelSettings":
      return <ChannelSettingsModal accountId={modal.accountId} serverId={modal.serverId} channelId={modal.channelId} />;
    case "createChannel":
      return <CreateChannelModal accountId={modal.accountId} serverId={modal.serverId} parentId={modal.parentId} type={modal.type} />;
    case "invite":
      return <InviteModal accountId={modal.accountId} serverId={modal.serverId} />;
    case "userSettings":
      return <UserSettingsModal />;
    case "screenPicker":
      return <ScreenPickerModal />;
    case "instanceAdmin":
      return <InstanceAdminModal accountId={modal.accountId} />;
    case "deleteAccount":
      return <DeleteAccountModal accountId={modal.accountId} />;
    case "importDiscord":
      return <ImportDiscordModal accountId={modal.accountId} serverId={modal.serverId} />;
  }
}

const isTextTarget = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function App() {
  const view = useStore((s) => s.view);
  const modalOpen = useStore((s) => s.modal !== null);
  const toast = useStore((s) => s.toast);
  const blocking = useStore((s) => isBlocking(s.update));
  const bannerVisible = useBannerVisible();
  useUpdateState();

  useEffect(() => {
    connectAll();
    if (getState().view.kind === "discord") navigate(getState().view);
    else if (getState().view.kind === "server") navigate(getState().view);
    return window.distopic?.onDiscordBadge((badge) =>
      setState((s) => {
        s.discordBadge = badge;
      }),
    );
  }, []);

  // The Discord view is a native layer above the page; hide it while a modal is open.
  useEffect(() => {
    if (view.kind !== "discord") return;
    if (modalOpen || blocking) window.distopic?.hideDiscord();
    else window.distopic?.showDiscord();
  }, [modalOpen, blocking, view.kind]);

  // Keep the update banner visible above the Discord view.
  useEffect(() => {
    window.distopic?.setDiscordTopInset(bannerVisible ? BANNER_HEIGHT : 0);
  }, [bannerVisible]);

  // Push-to-talk while the window has focus.
  useEffect(() => {
    const matches = (e: KeyboardEvent) => {
      const s = getState().settings;
      return s.inputMode === "ptt" && e.code === s.pttKey && !isTextTarget(e.target);
    };
    const down = (e: KeyboardEvent) => {
      if (matches(e)) {
        e.preventDefault();
        setPushToTalk(true);
      }
    };
    const up = (e: KeyboardEvent) => matches(e) && setPushToTalk(false);
    const blur = () => setPushToTalk(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="content">
      <UpdateBanner />
      <main className="main">
        {view.kind === "discord" ? (
          <div className="discord-placeholder">
            <p>Carregando o Discord…</p>
          </div>
        ) : view.kind === "server" ? (
          <ServerView accountId={view.accountId} serverId={view.serverId} channelId={view.channelId} />
        ) : (
          <Home accountId={view.accountId} dmId={view.dmId} />
        )}
      </main>
      </div>
      <Modals />
      <MandatoryUpdate />
      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
