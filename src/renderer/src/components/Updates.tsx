import {requestNavigation} from "../lib/navigation-guard.ts";
import {flushChatState} from "../chat-state.ts";
import {toast} from "../store.ts";
import {t as translate,onLocalizationChange} from "../../../shared/localization/index.ts";
import { useEffect } from "react";
import type { UpdateState } from "../../../shared/update.ts";
import { setState, useStore } from "../store.ts";
import { Icon } from "./ui.tsx";

export const BANNER_HEIGHT = 40;

const updates = () => window.distopic?.updates;
const install=()=>requestNavigation(()=>{flushChatState();void updates()?.install().catch(()=>toast(translate("update.installError")));});

/** Mirrors the main process's update state into the store. */
export function useUpdateState(): void {
  const notifications=useStore(s=>s.settings.notifications);
  useEffect(()=>{void updates()?.configure({notifications}).catch(()=>{});},[notifications]);
  useEffect(() => {
    const api = updates();
    if (!api) return;
    const apply = (update: UpdateState) =>
      setState((s) => {
        s.update = update;
      });
    void api.get().then(apply);
    return api.onState(apply);
  }, []);
}

/** Critical advisories block the app; everything else is an optional banner. */
export function isBlocking(update: UpdateState | null): boolean {
  if (!update) return false;
  if (update.status === "blocked") return true;
  return (update.status === "available" || update.status === "downloading" || update.status === "ready" || update.status === "error") && update.mandatory;
}

export function useBannerVisible(): boolean {
  const update = useStore((s) => s.update);
  const dismissed = useStore((s) => s.updateDismissed);
  if (!update || isBlocking(update)) return false;
  if (update.status === "available") return dismissed !== update.version;
  return update.status === "downloading" || update.status === "ready" || update.status === "error";
}

export function UpdateBanner() {
  const update = useStore((s) => s.update);
  const visible = useBannerVisible();
  if (!visible || !update) return null;
  const api = updates();

  return (
    <div className="update-banner" role="status" style={{ height: BANNER_HEIGHT }}>
      <Icon name="refresh" size={16} />
      {update.status==="error"&&<><span role="alert">{update.message}</span><button className="btn btn-small" onClick={()=>void api?.check()}>{translate("common.6bb3150b9757")}</button></>}
      {update.status === "available" && (
        <>
          <span>
            <strong>{translate("common.6e91c30b997b")}{update.version}</strong>{translate("common.1a11f46b854a")}{update.currentVersion}).
          </span>
          <a href={update.releaseUrl} target="_blank" rel="noreferrer">{translate("common.2d0576acd91e")}</a>
          <span className="spacer" />
          <button className="btn btn-small" onClick={() => void api?.download()}>{translate("common.dafb59613e12")}</button>
          <button
            className="btn btn-small btn-ghost"
            onClick={() =>
              setState((s) => {
                s.updateDismissed = update.version;
              })
            }
          >{translate("common.b8db71c3cce7")}</button>
        </>
      )}
      {update.status === "downloading" && (
        <>
          <span>{translate("common.2bdff6f3d08d")}{update.version}…</span>
          <div className="update-progress">
            <div style={{ width: `${update.percent}%` }} />
          </div>
          <span className="muted small">{update.percent}%</span>
        </>
      )}
      {update.status === "ready" && (
        <>
          <span>
            <strong>{translate("common.6e91c30b997b")}{update.version}</strong>{translate("common.92bf5b469978")}</span>
          <span className="spacer" />
          <button className="btn btn-small" onClick={install}>{translate("common.5f7d7589a60e")}</button>
        </>
      )}
    </div>
  );
}

/** Full-screen notice for a critical security fix. It can't be dismissed. */
export function MandatoryUpdate() {
  const update = useStore((s) => s.update);
  if (!isBlocking(update) || !update) return null;
  const api = updates();
  const advisory = "advisory" in update ? update.advisory : null;

  return (
    <div className="modal-backdrop mandatory" role="alertdialog" aria-modal="true" aria-labelledby="mandatory-title">
      <div className="modal">
        <div className="modal-body mandatory-body">
          <div className="mandatory-icon">
            <Icon name="lock" size={28} />
          </div>
          <h2 id="mandatory-title">{translate("common.dd5560a13e62")}</h2>
          <p>{translate("common.3daeff6994cf")}{update.currentVersion}{translate("common.d139397d0763")}</p>
          {advisory && (
            <div className="advisory">
              <strong>{advisory.id}</strong>: {advisory.summary}
              {advisory.url && (
                <>
                  {" "}
                  <a href={advisory.url} target="_blank" rel="noreferrer">{translate("common.62c95076dbeb")}</a>
                </>
              )}
            </div>
          )}
          {update.status === "available" && <p className="muted">{translate("common.5d36096dc751")}</p>}
          {update.status === "downloading" && (
            <>
              <div className="update-progress large">
                <div style={{ width: `${update.percent}%` }} />
              </div>
              <p className="muted small">{translate("common.a69f254c7c8b")}{update.version}: {update.percent}%</p>
            </>
          )}
          {update.status === "ready" && <p>{translate("common.b0f0090c205b")}{update.version}{translate("common.4bee2b63581a")}</p>}
          {update.status === "error" && (
            <>
              <p className="error">{translate("common.1d353ab6e336")}{update.message}</p>
              <div className="form-actions">
                <a className="btn btn-ghost" href={update.releaseUrl} target="_blank" rel="noreferrer">{translate("common.1cc3470af5d1")}</a>
                <button className="btn" onClick={() => void api?.check()}>{translate("common.6bb3150b9757")}</button>
              </div>
            </>
          )}
          {update.status === "blocked" && (
            <>
              <p className="muted">{translate("common.00b2a796ba62")}</p>
              <div className="form-actions">
                <a className="btn" href={update.releaseUrl} target="_blank" rel="noreferrer">{translate("common.6ddfa8d2f151")}</a>
                <button className="btn btn-ghost" onClick={() => void api?.check()}>{translate("common.c60993e713f8")}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

let STATUS_TEXT: Partial<Record<UpdateState["status"], string>> = {
  idle: "",
  checking: translate("update.checking"),
  none: translate("common.a12a64faa955"),
  disabled: translate("update.disabled"),
};

/** Version line and manual check, for the settings screen. */
export function UpdateSettings() {
  const update = useStore((s) => s.update);
  const api = updates();
  if (!update) return <p className="muted small">{translate("common.0817096f3c05")}</p>;
  const busy = update.status === "checking" || update.status === "downloading";
  const text =
    STATUS_TEXT[update.status] ??
    (update.status === "available"
      ? translate("common.36ec7f4ced03",{p0:(update.version)})
      : update.status === "downloading"
        ? `Baixando ${update.version}: ${update.percent}%`
        : update.status === "ready"
          ? translate("common.8aa8a29d55ec",{p0:(update.version)})
          : update.status === "error"
            ? `Erro: ${update.message}`
            : "");
  return (
    <div className="update-settings">
      <div>
        <strong>{translate("common.6e91c30b997b")}{update.currentVersion}</strong>
        {text && <div className="muted small">{text}</div>}
      </div>
      {update.status === "available" && (
        <button className="btn" onClick={() => void api?.download()}>{translate("common.dafb59613e12")}</button>
      )}
      {update.status === "ready" && (
        <button className="btn" onClick={install}>{translate("common.5f7d7589a60e")}</button>
      )}
      {update.status !== "disabled" && update.status !== "available" && update.status !== "ready" && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => void api?.check()}>
          <Icon name="refresh" size={16} />{translate("common.2262334984e2")}</button>
      )}
    </div>
  );
}

onLocalizationChange(()=>{STATUS_TEXT={
  idle: "",
  checking: translate("update.checking"),
  none: translate("common.a12a64faa955"),
  disabled: translate("update.disabled"),
};});
