import { useEffect, useState, type ReactNode } from "react";
import { counted, date, t as translate, textForError } from "../../../../shared/localization/index.ts";
import { useLocalization } from "../../lib/localization.ts";
import { useStore } from "../../store.ts";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { RadioGroup } from "../../components/ui/radio-group.tsx";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog.tsx";
import {
  closeAnnouncements, fetchPoll, loadAnnouncements, localized, openAnnouncements, pollText, selectAnnouncement, sendVote, showDueAnnouncements,
  useAnnouncementDialog, useAnnouncements, type Announcement, type PollDef, type PollState,
} from "./announcements.ts";
import { HTTPS, IMAGE_URL, parseBlocks } from "./model.ts";

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\(https:\/\/[^)\s]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0], at = match.index ?? 0, k = `${key}-${i++}`;
    if (at > last) out.push(text.slice(last, at));
    if (token.startsWith("`")) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("__")) out.push(<u key={k}>{token.slice(2, -2)}</u>);
    else if (token.startsWith("~~")) out.push(<s key={k}>{token.slice(2, -2)}</s>);
    else if (token.startsWith("*")) out.push(<em key={k}>{token.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      out.push(<a key={k} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Paragraph({ text, id }: { text: string; id: string }) {
  const nodes: ReactNode[] = [];
  let list: { tag: "ul" | "ol"; items: ReactNode[] } | null = null;
  let lines: ReactNode[] = [];
  const flushLines = () => { if (lines.length) nodes.push(<p key={`${id}-p${nodes.length}`}>{lines}</p>); lines = []; };
  const flushList = () => { if (list) { const List = list.tag; nodes.push(<List key={`${id}-l${nodes.length}`}>{list.items}</List>); } list = null; };
  text.split("\n").forEach((line, index) => {
    const item = /^\s*[-*]\s+(.*)$/.exec(line) ?? null, numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line) ?? null;
    const entry = item ?? numbered;
    if (entry) {
      flushLines();
      const tag = item ? "ul" : "ol";
      if (list?.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list!.items.push(<li key={index}>{inline(entry[1]!, `${id}-${index}`)}</li>);
    } else {
      flushList();
      if (lines.length) lines.push(<br key={`br${index}`} />);
      lines.push(...inline(line, `${id}-${index}`));
    }
  });
  flushLines();
  flushList();
  return <>{nodes}</>;
}

export function AnnouncementBody({ announcement, language }: { announcement: Announcement; language: string }) {
  const text = localized(announcement, language);
  return (
    <div className="announcement-body">
      {parseBlocks(text.body).map((block, index) => {
        const key = `${announcement.id}-${index}`;
        if (block.type === "heading") { const H = block.level === 1 ? "h3" : "h4"; return <H key={key}>{inline(block.text, key)}</H>; }
        if (block.type === "image") return IMAGE_URL.test(block.url) ? <img key={key} src={block.url} alt={block.alt} loading="lazy" draggable={false} /> : null;
        if (block.type === "button") return HTTPS.test(block.url) ? <a key={key} className="btn announcement-button" href={block.url} target="_blank" rel="noreferrer">{block.text}</a> : null;
        if (block.type === "poll") { const poll = announcement.polls[block.n - 1]; return poll ? <Poll key={`${key}-${poll.id}`} announcement={announcement} poll={poll} language={language} /> : null; }
        return <Paragraph key={key} id={key} text={block.text} />;
      })}
    </div>
  );
}

function Poll({ announcement, poll, language }: { announcement: Announcement; poll: PollDef; language: string }) {
  const text = pollText(announcement, poll, language);
  const [state, setState] = useState<PollState | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [results, setResults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchPoll(announcement, poll).then((next) => {
      if (!active) return;
      setState(next);
      if (next.mine) { setSelection(next.mine); setResults(true); }
    }).catch((e: unknown) => active && setError(textForError(e)));
    return () => { active = false; };
  }, [announcement.id, announcement.revision, poll.id]);
  const open = state ? state.open : !poll.closesAt || new Date(poll.closesAt).getTime() > Date.now();
  const vote = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await sendVote(announcement, poll, selection);
      setState(next);
      setResults(true);
    } catch (e) { setError(textForError(e)); } finally { setBusy(false); }
  };
  const showing = results && state?.counts && state.total !== null;
  const canSeeResults = !!state && state.counts !== null && !state.mine;
  return (
    <section className="announcement-poll" aria-label={text.question}>
      <strong className="announcement-poll-question">{text.question}</strong>
      {!open && <span className="muted small">{translate("announcements.closed")}</span>}
      {showing ? (
        <ul className="announcement-results">
          {poll.options.map((option) => {
            const count = state.counts![option] ?? 0;
            const percent = state.total ? Math.round((count / state.total) * 100) : 0;
            return (
              <li key={option} className={state.mine?.includes(option) ? "mine" : undefined}>
                <div className="announcement-result-label"><span>{text.options[option]}</span><span className="muted">{percent}%</span></div>
                <div className="announcement-result-bar" aria-hidden><div style={{ width: `${percent}%` }} /></div>
              </li>
            );
          })}
        </ul>
      ) : poll.mode === "single" ? (
        <RadioGroup label={text.question} value={selection[0] ?? ""} onValueChange={(value) => setSelection([value])} options={poll.options.map((option) => ({ value: option, label: text.options[option], disabled: !open || busy }))} />
      ) : (
        <div className="announcement-checks">
          {poll.options.map((option) => (
            <label key={option} className="announcement-check">
              <Checkbox checked={selection.includes(option)} disabled={!open || busy} onChange={(e) => setSelection((s) => (e.target.checked ? [...s, option] : s.filter((o) => o !== option)))} />
              <span>{text.options[option]}</span>
            </label>
          ))}
        </div>
      )}
      <div className="announcement-poll-actions">
        {showing && <span className="muted small">{state.total === 0 ? translate("announcements.votes.other", { count: 0 }) : counted(state.total!, "announcements.votes.one", "announcements.votes.other")}</span>}
        {!showing && open && <Button size="sm" disabled={!selection.length || busy || !state} onClick={() => void vote()}>{translate("announcements.vote")}</Button>}
        {!showing && canSeeResults && <Button size="sm" variant="ghost" onClick={() => setResults(true)}>{translate("announcements.viewResults")}</Button>}
        {showing && open && state.mine && <Button size="sm" variant="ghost" onClick={() => setResults(false)}>{translate("announcements.changeVote")}</Button>}
        {showing && open && !state.mine && <Button size="sm" variant="ghost" onClick={() => setResults(false)}>{translate("announcements.vote")}</Button>}
      </div>
      {error && <p className="error small" role="alert">{error}</p>}
    </section>
  );
}

/** Steam-like: one tab per announcement, the body below, "Close" at the bottom. */
export function AnnouncementsDialog() {
  const dialog = useAnnouncementDialog();
  const all = useAnnouncements();
  const { language } = useLocalization();
  if (!dialog) return null;
  const list = dialog.ids.map((id) => all.find((a) => a.id === id)).filter((a): a is Announcement => !!a);
  const current = list.find((a) => a.id === dialog.selected) ?? list[0];
  if (!current) return null;
  const title = localized(current, language).title;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) closeAnnouncements(); }}>
      <DialogContent className="modal modal-wide announcements-modal" aria-describedby={undefined} showClose={false}>
        <DialogTitle className="sr-only">{translate("announcements.title")}</DialogTitle>
        <div className="announcement-tabs" role="tablist" aria-label={translate("announcements.title")}>
          {list.map((a) => (
            <button key={a.id} type="button" role="tab" id={`announcement-tab-${a.id}`} aria-selected={a.id === current.id} aria-controls="announcement-panel" className={`announcement-tab${a.id === current.id ? " active" : ""}`} onClick={() => selectAnnouncement(a.id)}>
              {localized(a, language).title}
            </button>
          ))}
        </div>
        <div className="announcement-panel" id="announcement-panel" role="tabpanel" aria-labelledby={`announcement-tab-${current.id}`}>
          <h2>{title}</h2>
          {current.shownAt && <p className="muted small">{date(current.shownAt, { dateStyle: "long" })}</p>}
          <AnnouncementBody key={`${current.id}:${current.revision}`} announcement={current} language={language} />
        </div>
        <div className="form-actions announcement-footer">
          <Button onClick={closeAnnouncements}>{translate("common.0f2bd88ef0ac")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Opens today's unseen announcements once per launch, after the Annoy account signs in. */
export function useDueAnnouncements(): void {
  // Not while the account still has to accept changed terms (that dialog comes first).
  const ready = useStore((s) => s.global !== null && !s.global.termsRequired);
  useEffect(() => { if (ready) void showDueAnnouncements(); }, [ready]);
}

/** Settings → Updates → Announcements: every published one, to read again. */
export function AnnouncementHistory() {
  const all = useAnnouncements();
  const { language } = useLocalization();
  useEffect(() => { void loadAnnouncements(); }, []);
  if (!all.length) return null;
  return (
    <section className="settings-section announcement-history">
      <h3>{translate("announcements.title")}</h3>
      <ul>
        {all.map((a) => (
          <li key={a.id}>
            <button type="button" className="announcement-history-item" onClick={() => openAnnouncements([a.id])}>
              <span>{localized(a, language).title}</span>
              {a.shownAt && <span className="muted small">{date(a.shownAt)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
