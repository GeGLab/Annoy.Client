import { lazy, Suspense, useEffect } from "react";
import { LazyMotion, MotionConfig } from "framer-motion";
import { applyTheme } from "./lib/theme.ts";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { ChatSkeleton } from "./components/ui/skeleton.tsx";
import { TitleBar } from "./components/TitleBar.tsx";
import { ConnectionOverlay, useConnectionBlocked } from "./components/ConnectionOverlay.tsx";
import { VoiceStatusBar, VOICE_BAR_HEIGHT } from "./components/VoiceStatusBar.tsx";
import { SettingsGuard } from "./components/settings/SettingsGuard.tsx";
import { useDesktopActivity } from "./features/activity/use-activity.ts";
import { ActionDialogHost } from "./components/ui/action-dialog.tsx";
import { connectAll, navigate, setPushToTalk } from "./client.ts";
import { getState, setState, useStore } from "./store.ts";
import { Home } from "./components/Home.tsx";
import { ServerView } from "./components/ServerView.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { ScreenPickerModal } from "./components/VoiceStage.tsx";
import { BANNER_HEIGHT, isBlocking, MandatoryUpdate, UpdateBanner, useBannerVisible, useUpdateState } from "./components/Updates.tsx";

const AddAccountModal = lazy(() => import("./components/AccountModals.tsx").then(m => ({ default: m.AddAccountModal })));
const CreateServerModal = lazy(() => import("./components/AccountModals.tsx").then(m => ({ default: m.CreateServerModal })));
const ImportDiscordModal = lazy(() => import("./components/ImportModal.tsx").then(m => ({ default: m.ImportDiscordModal })));
const DeleteAccountModal = lazy(() => import("./components/InstanceAdmin.tsx").then(m => ({ default: m.DeleteAccountModal })));
const InstanceAdminModal = lazy(() => import("./components/InstanceAdmin.tsx").then(m => ({ default: m.InstanceAdminModal })));
const UserSettingsModal = lazy(() => import("./components/Settings.tsx").then(m => ({ default: m.UserSettingsModal })));
const ServerSettingsModal = lazy(() => import("./components/Settings.tsx").then(m => ({ default: m.ServerSettingsModal })));
const ChannelSettingsModal = lazy(() => import("./components/Settings.tsx").then(m => ({ default: m.ChannelSettingsModal })));
const CreateChannelModal = lazy(() => import("./components/Settings.tsx").then(m => ({ default: m.CreateChannelModal })));
const InviteModal = lazy(() => import("./components/Settings.tsx").then(m => ({ default: m.InviteModal })));
const motionFeatures = () => import("./lib/motion-features.ts").then(m => m.default);
const Marketplace = lazy(() => import("./features/bots/Marketplace.tsx"));
const SearchDialog = lazy(() => import("./features/search/SearchDialog.tsx"));

function Modals() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case "search": return <SearchDialog accountId={modal.accountId} serverId={modal.serverId} channelId={modal.channelId}/>;
    case "addAccount":
      return <AddAccountModal />;
    case "createServer":
      return <CreateServerModal accountId={modal.accountId} />;
    case "serverSettings":
      return <SettingsGuard><ServerSettingsModal accountId={modal.accountId} serverId={modal.serverId} /></SettingsGuard>;
    case "channelSettings":
      return <SettingsGuard><ChannelSettingsModal accountId={modal.accountId} serverId={modal.serverId} channelId={modal.channelId} /></SettingsGuard>;
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
  const theme = useStore(s => s.settings.theme);
  const accentColor = useStore(s => s.settings.accentColor);
  const surfaceColor = useStore(s => s.settings.surfaceColor);
  const connectionBlocked = useConnectionBlocked();
  const inVoice = useStore(s => s.voice !== null);
  useUpdateState();
  useDesktopActivity();

  useEffect(() => {
    applyTheme(theme, { accentColor, surfaceColor });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => applyTheme(theme, { accentColor, surfaceColor });
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [theme, accentColor, surfaceColor]);

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
    if (modalOpen || blocking || connectionBlocked) window.distopic?.hideDiscord();
    else window.distopic?.showDiscord();
  }, [modalOpen, blocking, connectionBlocked, view.kind]);

  // Keep the update banner visible above the Discord view.
  useEffect(() => {
    window.distopic?.setDiscordTopInset((bannerVisible ? BANNER_HEIGHT : 0) + (inVoice ? VOICE_BAR_HEIGHT : 0));
  }, [bannerVisible, inVoice]);

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
    <MotionConfig reducedMotion="user"><LazyMotion features={motionFeatures} strict><TooltipProvider delayDuration={300}>
    <div className="app">
      <TitleBar />
      <div className="workspace">
      <TopBar />
      <div className="content">
      <UpdateBanner />
      <VoiceStatusBar />
      <main className="main">
        {view.kind === "discord" ? (
          <div className="discord-placeholder">
            <ChatSkeleton />
          </div>
        ) : view.kind === "marketplace" ? (
          <Suspense fallback={<ChatSkeleton />}><Marketplace accountId={view.accountId} serverId={view.serverId} /></Suspense>
        ) : view.kind === "server" ? (
          <ServerView accountId={view.accountId} serverId={view.serverId} channelId={view.channelId} />
        ) : (
          <Home accountId={view.accountId} dmId={view.dmId} />
        )}
      </main>
      </div>
      </div>
      <Suspense fallback={<div className="overlay-loading" role="status">Abrindo…</div>}><Modals /></Suspense>
      <MandatoryUpdate />
      <ActionDialogHost />
      {!blocking && <ConnectionOverlay blocked={connectionBlocked} />}
      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.text}
        </div>
      )}
    </div>
    </TooltipProvider></LazyMotion></MotionConfig>
  );
}
