import { useEffect } from "react";
import type { UpdateState } from "../../../shared/update.ts";
import { setState, useStore } from "../store.ts";
import { Icon } from "./ui.tsx";

export const BANNER_HEIGHT = 40;

const updates = () => window.distopic?.updates;

/** Mirrors the main process's update state into the store. */
export function useUpdateState(): void {
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
  return update.status === "downloading" || update.status === "ready";
}

export function UpdateBanner() {
  const update = useStore((s) => s.update);
  const visible = useBannerVisible();
  if (!visible || !update || !("version" in update)) return null;
  const api = updates();

  return (
    <div className="update-banner" role="status" style={{ height: BANNER_HEIGHT }}>
      <Icon name="refresh" size={16} />
      {update.status === "available" && (
        <>
          <span>
            <strong>Distopic {update.version}</strong> está disponível (você usa a {update.currentVersion}).
          </span>
          <a href={update.releaseUrl} target="_blank" rel="noreferrer">
            Novidades
          </a>
          <span className="spacer" />
          <button className="btn btn-small" onClick={() => void api?.download()}>
            Atualizar
          </button>
          <button
            className="btn btn-small btn-ghost"
            onClick={() =>
              setState((s) => {
                s.updateDismissed = update.version;
              })
            }
          >
            Depois
          </button>
        </>
      )}
      {update.status === "downloading" && (
        <>
          <span>Baixando Distopic {update.version}…</span>
          <div className="update-progress">
            <div style={{ width: `${update.percent}%` }} />
          </div>
          <span className="muted small">{update.percent}%</span>
        </>
      )}
      {update.status === "ready" && (
        <>
          <span>
            <strong>Distopic {update.version}</strong> foi baixado. Ele também é instalado quando você fechar o app.
          </span>
          <span className="spacer" />
          <button className="btn btn-small" onClick={() => void api?.install()}>
            Reiniciar e atualizar
          </button>
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
          <h2 id="mandatory-title">Atualização de segurança obrigatória</h2>
          <p>
            Foi encontrada uma vulnerabilidade crítica na versão {update.currentVersion}. Para proteger você e seus servidores, o Distopic precisa ser
            atualizado antes de continuar.
          </p>
          {advisory && (
            <div className="advisory">
              <strong>{advisory.id}</strong>: {advisory.summary}
              {advisory.url && (
                <>
                  {" "}
                  <a href={advisory.url} target="_blank" rel="noreferrer">
                    Detalhes
                  </a>
                </>
              )}
            </div>
          )}
          {update.status === "available" && <p className="muted">Preparando o download…</p>}
          {update.status === "downloading" && (
            <>
              <div className="update-progress large">
                <div style={{ width: `${update.percent}%` }} />
              </div>
              <p className="muted small">Baixando {update.version}: {update.percent}%</p>
            </>
          )}
          {update.status === "ready" && (
            <button className="btn" onClick={() => void api?.install()}>
              Reiniciar e atualizar para {update.version}
            </button>
          )}
          {update.status === "error" && (
            <>
              <p className="error">Não foi possível baixar a atualização: {update.message}</p>
              <div className="form-actions">
                <a className="btn btn-ghost" href={update.releaseUrl} target="_blank" rel="noreferrer">
                  Baixar manualmente
                </a>
                <button className="btn" onClick={() => void api?.check()}>
                  Tentar de novo
                </button>
              </div>
            </>
          )}
          {update.status === "blocked" && (
            <>
              <p className="muted">A versão corrigida ainda não está disponível para atualização automática. Baixe-a na página de versões.</p>
              <div className="form-actions">
                <a className="btn" href={update.releaseUrl} target="_blank" rel="noreferrer">
                  Abrir página de versões
                </a>
                <button className="btn btn-ghost" onClick={() => void api?.check()}>
                  Verificar de novo
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_TEXT: Partial<Record<UpdateState["status"], string>> = {
  idle: "",
  checking: "Verificando…",
  none: "Você está na versão mais recente.",
  disabled: "Atualização automática indisponível nesta instalação (build de desenvolvimento).",
};

/** Version line and manual check, for the settings screen. */
export function UpdateSettings() {
  const update = useStore((s) => s.update);
  const api = updates();
  if (!update) return <p className="muted small">Atualizações disponíveis apenas no app instalado.</p>;
  const busy = update.status === "checking" || update.status === "downloading";
  const text =
    STATUS_TEXT[update.status] ??
    (update.status === "available"
      ? `Versão ${update.version} disponível.`
      : update.status === "downloading"
        ? `Baixando ${update.version}: ${update.percent}%`
        : update.status === "ready"
          ? `Versão ${update.version} pronta para instalar.`
          : update.status === "error"
            ? `Erro: ${update.message}`
            : "");
  return (
    <div className="update-settings">
      <div>
        <strong>Distopic {update.currentVersion}</strong>
        {text && <div className="muted small">{text}</div>}
      </div>
      {update.status === "available" && (
        <button className="btn" onClick={() => void api?.download()}>
          Atualizar
        </button>
      )}
      {update.status === "ready" && (
        <button className="btn" onClick={() => void api?.install()}>
          Reiniciar e atualizar
        </button>
      )}
      {update.status !== "disabled" && update.status !== "available" && update.status !== "ready" && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => void api?.check()}>
          <Icon name="refresh" size={16} /> Verificar atualizações
        </button>
      )}
    </div>
  );
}
