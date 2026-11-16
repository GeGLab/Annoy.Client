import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { EQ_BANDS, EQ_LIMIT, MIXER_PRESETS, type MixerPreset } from "../../../../shared/sound-mixer.ts";
import { Icon } from "../../components/ui.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog.tsx";
import { Slider } from "../../components/ui/slider.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { choosePreset, isSharp, NOTE_KEYS, NOTES, noteOn, PADS, playPad, setMixer, setPads, useMixer, useMixerReach, usePads, WAVES, type PadName, type Wave } from "./sound-studio.ts";

type Key = Parameters<typeof translate>[0];
const presetLabel = (preset: MixerPreset) => translate(`studio.preset.${preset}` as Key);
const padLabel = (pad: PadName) => translate(`studio.pad.${pad}` as Key);
const waveLabel = (wave: Wave) => translate(`studio.wave.${wave}` as Key);
const WHITE_KEYS = NOTES.filter((n) => !isSharp(n)).length;
const band = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

/**
 * The listener's studio in a song room: a mixer for how the music sounds to them, and pads and
 * a small keyboard to play along. All of it on this device; nobody else hears it.
 */
export function SoundStudio({ onClose, effectsHere }: { onClose: () => void; effectsHere: boolean }) {
  const [tab, setTab] = useState<"mixer" | "pads">("mixer");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="modal glass-dialog sound-studio" overlayClassName="glass-overlay" aria-describedby="sound-studio-note">
        <div className="modal-body">
          <DialogTitle asChild><h2><Icon name="sliders" size={20} /> {translate("studio.title")}</h2></DialogTitle>
          <DialogDescription id="sound-studio-note" className="muted small">{translate("studio.onlyYou")}</DialogDescription>
          <div className="tabs inline" role="tablist" aria-label={translate("studio.title")}>
            <button type="button" role="tab" className={`tab${tab === "mixer" ? " active" : ""}`} aria-selected={tab === "mixer"} onClick={() => setTab("mixer")}>{translate("studio.mixer")}</button>
            <button type="button" role="tab" className={`tab${tab === "pads" ? " active" : ""}`} aria-selected={tab === "pads"} onClick={() => setTab("pads")}>{translate("studio.pads")}</button>
          </div>
          {tab === "mixer" ? <MixerPanel effectsHere={effectsHere} /> : <PadsPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MixerPanel({ effectsHere }: { effectsHere: boolean }) {
  const mixer = useMixer();
  const reach = useMixerReach();
  const custom = (patch: Partial<typeof mixer>) => setMixer({ ...mixer, ...patch, on: true, preset: "custom" });
  return (
    <div className="studio-mixer" role="tabpanel">
      <label className="switch-setting">
        <span><strong>{translate("studio.mixerOn")}</strong><small>{translate("studio.mixerHint")}</small></span>
        <Switch aria-label={translate("studio.mixerOn")} checked={mixer.on} onCheckedChange={(on) => setMixer({ ...mixer, on })} />
      </label>
      {!effectsHere ? (
        <p className="studio-note" role="status"><Icon name="info" size={14} /> {translate("studio.notThisTrack")}</p>
      ) : mixer.on && reach === false ? (
        <p className="studio-note" role="status"><Icon name="info" size={14} /> {translate("studio.cannotRead")}</p>
      ) : null}
      <div className="studio-presets" role="group" aria-label={translate("studio.presets")}>
        {MIXER_PRESETS.map((preset) => (
          <button key={preset} type="button" className={`studio-chip${mixer.on && mixer.preset === preset ? " active" : ""}`} aria-pressed={mixer.on && mixer.preset === preset} onClick={() => choosePreset(preset)}>
            {presetLabel(preset)}
          </button>
        ))}
      </div>
      <div className={`studio-eq${mixer.on ? "" : " off"}`}>
        {EQ_BANDS.map((hz, i) => (
          <label key={hz} className="studio-slider">
            <span>{band(hz)}</span>
            <Slider
              min={-EQ_LIMIT} max={EQ_LIMIT} step={0.5} value={mixer.eq[i] ?? 0}
              aria-label={translate("studio.band", { p0: band(hz) })}
              aria-valuetext={`${mixer.eq[i] ?? 0} dB`}
              onChange={(e) => custom({ eq: mixer.eq.map((gain, j) => (j === i ? Number(e.target.value) : gain)) })}
            />
            <output>{(mixer.eq[i] ?? 0) > 0 ? "+" : ""}{mixer.eq[i] ?? 0} dB</output>
          </label>
        ))}
        <label className="studio-slider">
          <span>{translate("studio.reverb")}</span>
          <Slider min={0} max={100} value={Math.round(mixer.reverb * 100)} aria-label={translate("studio.reverb")} aria-valuetext={`${Math.round(mixer.reverb * 100)}%`} onChange={(e) => custom({ reverb: Number(e.target.value) / 100 })} />
          <output>{Math.round(mixer.reverb * 100)}%</output>
        </label>
        <label className="studio-slider">
          <span>{translate("studio.spin")}</span>
          <Slider min={0} max={100} value={Math.round(mixer.spin * 100)} aria-label={translate("studio.spin")} aria-valuetext={`${Math.round(mixer.spin * 100)}%`} onChange={(e) => custom({ spin: Number(e.target.value) / 100 })} />
          <output>{Math.round(mixer.spin * 100)}%</output>
        </label>
      </div>
    </div>
  );
}

function PadsPanel() {
  const settings = usePads();
  const [hit, setHit] = useState<string | null>(null);
  const held = useRef(new Map<number, () => void>());
  const flash = (id: string) => { setHit(id); window.setTimeout(() => setHit((current) => (current === id ? null : current)), 140); };
  const pad = (name: PadName) => { playPad(name); flash(name); };
  const press = (midi: number) => { if (!held.current.has(midi)) held.current.set(midi, noteOn(midi)); };
  const release = (midi: number) => { held.current.get(midi)?.(); held.current.delete(midi); };
  useEffect(() => () => { for (const stop of held.current.values()) stop(); held.current.clear(); }, []);
  // 1–8 play the pads; A W S E D F T G Y H U J K play the keyboard, while the board has focus.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = Number(event.key) - 1;
    if (index >= 0 && index < PADS.length) { event.preventDefault(); pad(PADS[index]!); return; }
    const note = NOTE_KEYS.indexOf(event.key.toLowerCase());
    if (note >= 0) { event.preventDefault(); press(NOTES[note]!); flash(`note-${NOTES[note]}`); }
  };
  const onKeyUp = (event: ReactKeyboardEvent) => {
    const note = NOTE_KEYS.indexOf(event.key.toLowerCase());
    if (note >= 0) release(NOTES[note]!);
  };
  return (
    <div className="studio-pads" role="tabpanel" tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} aria-label={translate("studio.padsHint")}>
      <p className="muted small">{translate("studio.padsHint")}</p>
      <div className="studio-pad-grid">
        {PADS.map((name, i) => (
          <button key={name} type="button" className={`studio-pad pad-${name}${hit === name ? " hit" : ""}`} onPointerDown={() => pad(name)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); pad(name); } }}>
            <strong>{padLabel(name)}</strong>
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
      {/* A real piano octave: white keys side by side, black keys on top between them. */}
      <div className="studio-keys" role="group" aria-label={translate("studio.keyboard")}>
        {NOTES.map((midi, i) => {
          const sharp = isSharp(midi);
          const whitesBefore = NOTES.slice(0, i).filter((n) => !isSharp(n)).length;
          return (
            <button
              key={midi} type="button" tabIndex={-1}
              className={`studio-key${sharp ? " sharp" : ""}${hit === `note-${midi}` ? " hit" : ""}`}
              style={sharp ? { left: `calc(${(whitesBefore / WHITE_KEYS) * 100}% - var(--black-key) / 2)` } : undefined}
              aria-label={translate("studio.note", { p0: NOTE_KEYS[i]!.toUpperCase() })}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(midi); flash(`note-${midi}`); }}
              onPointerUp={() => release(midi)}
              onPointerCancel={() => release(midi)}
            >
              <kbd>{NOTE_KEYS[i]!.toUpperCase()}</kbd>
            </button>
          );
        })}
      </div>
      <div className="studio-pad-options">
        <div className="studio-presets" role="radiogroup" aria-label={translate("studio.wave")}>
          {WAVES.map((wave) => (
            <button key={wave} type="button" role="radio" aria-checked={settings.wave === wave} className={`studio-chip${settings.wave === wave ? " active" : ""}`} onClick={() => setPads({ ...settings, wave })}>{waveLabel(wave)}</button>
          ))}
        </div>
        <label className="studio-slider">
          <span>{translate("studio.padVolume")}</span>
          <Slider min={0} max={100} value={Math.round(settings.volume * 100)} aria-label={translate("studio.padVolume")} aria-valuetext={`${Math.round(settings.volume * 100)}%`} onChange={(e) => setPads({ ...settings, volume: Number(e.target.value) / 100 })} />
          <output>{Math.round(settings.volume * 100)}%</output>
        </label>
      </div>
    </div>
  );
}
